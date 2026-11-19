/**
 * Client-side pose tracking with MediaPipe Pose Landmarker.
 *
 * The analysis runs on a private, hidden <video> element (same source as the stage video) so the
 * user's playback is untouched. Every frame at the chosen sample rate is seeked to, run through the
 * landmarker, and stored by frame index — scrubbing afterwards is a plain array lookup.
 */
import type { PoseLandmarker as PoseLandmarkerT } from "@mediapipe/tasks-vision";

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
const WASM_BASE = "/mediapipe/wasm";

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

export async function analyzeVideo(opts: AnalyzeOptions): Promise<PoseTrack> {
  const { lm: landmarker, delegate } = await loadPoseLandmarker(opts.model);
  opts.onModelReady?.(delegate);

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
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

/** Pose for a playback time, or null if none (or not analyzed). Constant-time lookup. */
export function poseAt(track: PoseTrack | null, t: number): PoseFrame | null {
  if (!track || track.frames.length === 0) return null;
  const i = Math.floor(t * track.fps + 1e-6);
  return track.frames[Math.max(0, Math.min(track.frames.length - 1, i))] ?? null;
}

export function detectedCount(track: PoseTrack | null): number {
  return track ? track.frames.reduce((n, f) => n + (f ? 1 : 0), 0) : 0;
}
