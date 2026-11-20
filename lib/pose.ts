/**
 * Client-side pose tracking with MediaPipe Pose Landmarker.
 *
 * The analysis runs on a private, hidden <video> element (same source as the stage video) so the
 * user's playback is untouched. Every frame at the chosen sample rate is seeked to, run through the
 * landmarker, and stored by frame index — scrubbing afterwards is a plain array lookup.
 */
import type { PoseLandmarker as PoseLandmarkerT } from "@mediapipe/tasks-vision";
import { asset } from "./basePath";

/** Normalized image landmark: x/y in 0..1 of the video frame, v = visibility (0..1). */
export interface Lm {
  x: number;
  y: number;
  z: number;
  v: number;
}

/** World landmark in meters, origin at the hip center (x right, y down, z toward camera). */
export interface WLm {
  x: number;
  y: number;
  z: number;
}

export interface PoseFrame {
  lm: Lm[];
  world: WLm[] | null;
}

export interface PoseTrack {
  /** Frames per second the video was sampled at; frame i covers [i/fps, (i+1)/fps). */
  fps: number;
  /** One entry per sampled frame; null when no person was detected. */
  frames: (PoseFrame | null)[];
  delegate: "GPU" | "CPU";
  model: PoseModel;
}

export type PoseModel = "lite" | "full";

export const MODEL_URLS: Record<PoseModel, string> = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
};

/** WASM runtime is copied into public/ by scripts/copy-mediapipe.mjs (postinstall). */
const WASM_BASE = asset("/mediapipe/wasm");

// ── Landmark indices (MediaPipe BlazePose, subject's own left/right) ──
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

// ── Landmarker singleton (one per model) ──────────────────────────────
interface Loaded {
  lm: PoseLandmarkerT;
  delegate: "GPU" | "CPU";
}
const cache: Partial<Record<PoseModel, Promise<Loaded>>> = {};
/** detectForVideo needs strictly increasing timestamps across the landmarker's lifetime. */
let tsCursor = 0;

export function loadPoseLandmarker(model: PoseModel): Promise<Loaded> {
  if (!cache[model]) {
    cache[model] = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const make = (delegate: "GPU" | "CPU") =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URLS[model], delegate },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        return { lm: await make("GPU"), delegate: "GPU" as const };
      } catch (err) {
        console.warn("[pose] GPU delegate unavailable, falling back to CPU:", err);
        return { lm: await make("CPU"), delegate: "CPU" as const };
      }
    })();
    // Allow a retry after a failed load (e.g. offline).
    cache[model]!.catch(() => delete cache[model]);
  }
  return cache[model]!;
}

// ── Video helpers ─────────────────────────────────────────────────────
function waitFor(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(); // Don't stall the whole analysis on a single slow seek.
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("The video could not be decoded for analysis."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fail);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", fail, { once: true });
  });
}

async function seekTo(el: HTMLVideoElement, t: number) {
  if (Math.abs(el.currentTime - t) < 1e-6) return;
  const done = waitFor(el, "seeked", 3000);
  el.currentTime = t;
  await done;
}

export interface AnalyzeOptions {
  src: string;
  fps: number;
  duration: number;
  model: PoseModel;
  onProgress?: (done: number, total: number) => void;
  /** Called once the model is ready and frames start processing. */
  onModelReady?: (delegate: "GPU" | "CPU") => void;
  signal?: AbortSignal;
}

/**
 * Runs are serialized: VIDEO mode smooths landmarks across consecutive calls, so interleaving two
 * videos (compare mode) through one landmarker would blend their poses.
 */
let queue: Promise<unknown> = Promise.resolve();

export function analyzeVideo(opts: AnalyzeOptions): Promise<PoseTrack> {
  const run = queue.then(
    () => runAnalysis(opts),
    () => runAnalysis(opts),
  );
  queue = run.catch(() => undefined);
  return run;
}

async function runAnalysis(opts: AnalyzeOptions): Promise<PoseTrack> {
  if (opts.signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  const { lm: landmarker, delegate } = await loadPoseLandmarker(opts.model);
  opts.onModelReady?.(delegate);

  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  // Attribute forms too: older iOS Safari only honours the attributes.
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = opts.src;
  try {
    if (video.readyState < 2) await waitFor(video, "loadeddata", 15000);

    const total = Math.max(1, Math.floor(opts.duration * opts.fps));
    const frames: (PoseFrame | null)[] = new Array(total).fill(null);
    let lastYield = performance.now();
    const runBase = tsCursor;
    let lastTs = tsCursor;

    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
      // Middle of the frame, same convention as the stage's frame stepping.
      const t = Math.min(opts.duration - 0.0005, (i + 0.5) / opts.fps);
      await seekTo(video, t);

      const ts = Math.max(lastTs + 1, runBase + Math.round(t * 1000));
      lastTs = ts;
      tsCursor = ts; // Survives cancellation so the next run keeps increasing.
      try {
        const res = landmarker.detectForVideo(video, ts);
        const lms = res.landmarks?.[0];
        if (lms && lms.length >= 33) {
          frames[i] = {
            lm: lms.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 })),
            world: res.worldLandmarks?.[0]?.map((p) => ({ x: p.x, y: p.y, z: p.z })) ?? null,
          };
        }
      } catch (err) {
        // A single bad frame shouldn't kill the run; leave it as "no pose".
        console.warn(`[pose] frame ${i} failed`, err);
      }

      opts.onProgress?.(i + 1, total);
      // Yield to the UI so the progress bar paints.
      if (performance.now() - lastYield > 32) {
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
    // Keep future timestamps well clear of this run.
    tsCursor = lastTs + 10_000;
    return { fps: opts.fps, frames, delegate, model: opts.model };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

// ── Single-frame scan (preset fitting) ─────────────────────────────────
/** A grayscale or 0..1 float raster; (x, y) map to normalized frame coords via x / w, y / h. */
export interface Raster<T extends ArrayLike<number>> {
  w: number;
  h: number;
  data: T;
}

export interface FrameScan {
  pose: PoseFrame | null;
  /** Person segmentation: 1 = body, 0 = background. */
  mask: Raster<Float32Array> | null;
  /** Frame luminance, for finding the club shaft. */
  lum: Raster<Uint8ClampedArray>;
}

let segLoader: Promise<PoseLandmarkerT> | null = null;
function loadSegmenter(): Promise<PoseLandmarkerT> {
  if (!segLoader) {
    segLoader = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      return PoseLandmarker.createFromOptions(fileset, {
        // CPU keeps the mask readback simple and is plenty fast for one frame.
        baseOptions: { modelAssetPath: MODEL_URLS.full, delegate: "CPU" },
        runningMode: "IMAGE",
        numPoses: 1,
        outputSegmentationMasks: true,
      });
    })();
    segLoader.catch(() => (segLoader = null));
  }
  return segLoader;
}

/**
 * Pose + body outline + pixels for one moment of a video (e.g. Address). Runs on a private hidden
 * video so the user's playback isn't disturbed, and through the same queue as full analyses.
 */
export function scanFrame(src: string, t: number): Promise<FrameScan> {
  const run = queue.then(
    () => runScan(src, t),
    () => runScan(src, t),
  );
  queue = run.catch(() => undefined);
  return run;
}

async function runScan(src: string, t: number): Promise<FrameScan> {
  const seg = await loadSegmenter();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = src;
  try {
    if (video.readyState < 2) await waitFor(video, "loadeddata", 15000);
    await seekTo(video, Math.max(0, t));
    // Work at ≤ 1280 px on the long side: enough detail for a thin shaft, cheap to scan.
    const k = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * k));
    const h = Math.max(1, Math.round(video.videoHeight * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(video, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];

    const res = seg.detect(canvas);
    const lms = res.landmarks?.[0];
    const pose: PoseFrame | null =
      lms && lms.length >= 33 ? { lm: lms.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 })), world: null } : null;
    let mask: Raster<Float32Array> | null = null;
    const m = res.segmentationMasks?.[0];
    if (m) {
      mask = { w: m.width, h: m.height, data: new Float32Array(m.getAsFloat32Array()) };
      m.close();
    }
    return { pose, mask, lum: { w, h, data: gray } };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/** Pose for a playback time, or null if none (or not analyzed). Constant-time lookup. */
export function poseAt(track: PoseTrack | null, t: number): PoseFrame | null {
  if (!track || track.frames.length === 0) return null;
  const i = Math.floor(t * track.fps + 1e-6);
  return track.frames[Math.max(0, Math.min(track.frames.length - 1, i))] ?? null;
}

export function detectedCount(track: PoseTrack | null): number {
  return track ? track.frames.reduce((n, f) => n + (f ? 1 : 0), 0) : 0;
}
