"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisState } from "./PosePanel";
import { SAMPLE_VIDEO_URL, SUPPORTED_EXTENSIONS } from "@/lib/constants";
import { newId } from "@/lib/geometry";
import { computeMetrics, keyNumbers, type Handed } from "@/lib/metrics";
import { detectPhases } from "@/lib/phases";
import { analyzeVideo, detectedCount, poseAt, type PoseModel, type PoseTrack } from "@/lib/pose";
import { PRESETS } from "@/lib/presets";
import type { Bookmarks, CameraAngle, CheckpointKey, Fps, Shape, VideoMeta } from "@/lib/types";

const MAX_HISTORY = 100;

export interface SideOptions {
  angle: CameraAngle;
  fps: Fps;
  rate: number;
  poseModel: PoseModel;
  /** Called when this side loads the bundled sample (the sample is face-on). */
  onSampleLoaded?: () => void;
  /**
   * When set, "navigation" seeks made by this side (jump to checkpoint, auto-detect) are routed
   * here instead, so a sync-locked partner video can follow.
   */
  navigate?: React.RefObject<((t: number) => void) | null>;
  sampleName?: string;
}

/**
 * Everything that belongs to one video: file, playback, checkpoints, telestrator shapes + undo,
 * pose track, analysis status and the derived per-frame metrics.
 */
export function useSwingSide(o: SideOptions) {
  const { angle, fps, rate, poseModel } = o;
  const optsRef = useRef(o);
  optsRef.current = o;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingNameRef = useRef<string>("");
  const [src, setSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);

  // ── Playback ─────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmarks>({});

  // ── Telestrator ──────────────────────────────────────────────────
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shapesRef = useRef<Shape[]>(shapes);
  shapesRef.current = shapes;
  const historyRef = useRef<Shape[][]>([]);
  const [historyLen, setHistoryLen] = useState(0);

  const checkpoint = useCallback(() => {
    historyRef.current.push(shapesRef.current);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    setHistoryLen(historyRef.current.length);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev !== undefined) {
      setShapes(prev);
      setSelectedId(null);
    }
    setHistoryLen(historyRef.current.length);
  }, []);

  const clearAll = useCallback(() => {
    if (shapesRef.current.length === 0) return;
    checkpoint();
    setShapes([]);
    setSelectedId(null);
  }, [checkpoint]);

  const recolorSelected = useCallback(
    (c: string) => {
      if (!selectedId) return;
      checkpoint();
      setShapes((prev) => prev.map((s) => (s.id === selectedId ? { ...s, color: c } : s)));
    },
    [selectedId, checkpoint],
  );

  // ── AI pose ──────────────────────────────────────────────────────
  const [poseTrack, setPoseTrack] = useState<PoseTrack | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: "idle", done: 0, total: 0, message: null });
  const [handed, setHanded] = useState<Handed>("R");
  const [phaseMessage, setPhaseMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetSession = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPoseTrack(null);
    setAnalysis({ status: "idle", done: 0, total: 0, message: null });
    setPhaseMessage(null);
    setShapes([]);
    historyRef.current = [];
    setHistoryLen(0);
    setSelectedId(null);
    setBookmarks({});
    setCurrentTime(0);
    setPlaying(false);
    setMeta(null);
  };

  // ── Loading video ────────────────────────────────────────────────
  const loadFile = useCallback((file: File) => {
    const lower = file.name.toLowerCase();
    const ok = file.type.startsWith("video/") || SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    if (!ok) {
      setError(`"${file.name}" isn't a supported video. Use .mp4, .mov or .webm.`);
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    pendingNameRef.current = file.name;
    resetSession();
    setError(null);
    setLoading(true);
    setSrc(url);
  }, []);

  const loadSample = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    pendingNameRef.current = optsRef.current.sampleName ?? "Sample swing (face-on)";
    resetSession();
    setError(null);
    setLoading(true);
    optsRef.current.onSampleLoaded?.();
    // Same URL twice (e.g. sample on both sides) still needs a fresh load event on this side.
    setSrc(SAMPLE_VIDEO_URL + (src === SAMPLE_VIDEO_URL ? "?r=1" : ""));
  }, [src]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const onLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const finish = () => {
      const w = v.videoWidth || 1920;
      const h = v.videoHeight || 1080;
      setAspect(w / h);
      setMeta({ name: pendingNameRef.current, width: w, height: h, duration: v.duration });
      setLoading(false);
      v.playbackRate = optsRef.current.rate;
      // Nudge to the first frame so it paints in every browser.
      if (v.currentTime === 0) v.currentTime = 0.5 / optsRef.current.fps;
    };
    // Some WebM files (e.g. MediaRecorder output) report Infinity until the end has been seeked.
    if (!isFinite(v.duration)) {
      const onDur = () => {
        if (isFinite(v.duration)) {
          v.removeEventListener("durationchange", onDur);
          v.currentTime = 0;
          finish();
        }
      };
      v.addEventListener("durationchange", onDur);
      v.currentTime = 1e101;
      return;
    }
    finish();
  }, []);

  const onVideoError = useCallback(() => {
    const isSample = !!src?.startsWith(SAMPLE_VIDEO_URL);
    setLoading(false);
    setSrc(null);
    setMeta(null);
    setError(
      isSample
        ? "The sample video couldn't be loaded. Make sure public/sample-swing.mp4 exists."
        : "This browser can't play that file. iPhone .mov files recorded in HEVC may not play in Chrome or Firefox. Try Safari, or export as H.264 MP4.",
    );
  }, [src]);

  // ── Playback state sync ──────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
  }, [src, meta]);

  // Smooth time readout: poll currentTime every animation frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime;
        setCurrentTime((prev) => (Math.abs(prev - t) > 1e-4 ? t : prev));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  const duration = meta?.duration ?? 0;
  const ready = !!src && !!meta;

  const play = useCallback(() => {
    const v = videoRef.current;
    if (!v || !ready) return;
    if (v.ended || v.currentTime >= v.duration - 0.01) v.currentTime = 0;
    v.playbackRate = optsRef.current.rate;
    v.play().catch(() => undefined);
  }, [ready]);

  const pause = useCallback(() => videoRef.current?.pause(), []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !ready) return;
    if (v.paused) play();
    else v.pause();
  }, [ready, play]);

  const clampTime = useCallback((t: number) => Math.max(0, Math.min(duration - 0.0005, t)), [duration]);

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v || !ready) return;
      const clamped = Math.max(0, Math.min(duration, t));
      v.currentTime = clamped;
      setCurrentTime(clamped);
    },
    [ready, duration],
  );

  const frameOf = useCallback((t: number) => Math.floor(t * fps + 1e-6), [fps]);
  const lastFrame = Math.max(0, Math.floor(duration * fps) - 1);

  /** Seek to the middle of a frame so the decoder lands on it reliably. */
  const seekFrame = useCallback(
    (frame: number) => {
      const v = videoRef.current;
      if (!v || !ready) return;
      const target = Math.max(0, Math.min(lastFrame, frame));
      const t = Math.min(duration - 0.0005, (target + 0.5) / fps);
      v.currentTime = t;
      setCurrentTime(t);
    },
    [ready, lastFrame, duration, fps],
  );

  const step = useCallback(
    (frames: number) => {
      const v = videoRef.current;
      if (!v || !ready) return;
      v.pause();
      seekFrame(frameOf(v.currentTime) + frames);
    },
    [ready, seekFrame, frameOf],
  );

  /** Seek used for navigation; routed to the sync controller when one is attached. */
  const navigate = useCallback(
    (t: number) => {
      const nav = optsRef.current.navigate?.current;
      videoRef.current?.pause();
      if (nav) nav(t);
      else seek(t);
    },
    [seek],
  );

  // ── Checkpoints ──────────────────────────────────────────────────
  const setCheckpointAt = useCallback(
    (k: CheckpointKey) => {
      const v = videoRef.current;
      if (!v || !ready) return;
      const t = v.currentTime;
      setBookmarks((b) => ({ ...b, [k]: t }));
    },
    [ready],
  );

  const jumpCheckpoint = useCallback(
    (k: CheckpointKey) => {
      const t = bookmarks[k];
      if (t === undefined) return;
      navigate(t);
    },
    [bookmarks, navigate],
  );

  const clearCheckpoint = useCallback((k: CheckpointKey) => {
    setBookmarks((b) => {
      const next = { ...b };
      delete next[k];
      return next;
    });
  }, []);

  /** One-click: jump if tagged, otherwise tag the current frame. */
  const checkpointButton = useCallback(
    (k: CheckpointKey) => {
      if (bookmarks[k] !== undefined) jumpCheckpoint(k);
      else setCheckpointAt(k);
    },
    [bookmarks, jumpCheckpoint, setCheckpointAt],
  );

  // ── AI analysis ──────────────────────────────────────────────────
  const analyze = useCallback(async () => {
    if (!src || !meta || !isFinite(meta.duration) || meta.duration <= 0) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    videoRef.current?.pause();
    setPhaseMessage(null);
    setAnalysis({ status: "loading-model", done: 0, total: 0, message: null });
    let started = performance.now();
    try {
      const track = await analyzeVideo({
        src,
        fps,
        duration: meta.duration,
        model: poseModel,
        signal: ac.signal,
        onModelReady: () => {
          started = performance.now();
          if (!ac.signal.aborted) setAnalysis((a) => ({ ...a, status: "running" }));
        },
        onProgress: (done, total) => {
          if (!ac.signal.aborted) setAnalysis((a) => ({ ...a, status: "running", done, total }));
        },
      });
      if (ac.signal.aborted) return;
      const found = detectedCount(track);
      setPoseTrack(track);
      setAnalysis({
        status: "done",
        done: track.frames.length,
        total: track.frames.length,
        message:
          found === 0
            ? "No golfer was detected. Make sure the whole body is in frame and reasonably lit."
            : `Pose found in ${found} of ${track.frames.length} frames (${fps} fps, ${track.delegate}) in ${((performance.now() - started) / 1000).toFixed(1)}s.`,
      });
    } catch (err) {
      if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        setAnalysis({ status: "idle", done: 0, total: 0, message: "Analysis cancelled." });
        return;
      }
      console.error(err);
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setAnalysis({
        status: "error",
        done: 0,
        total: 0,
        message: offline
          ? "You're offline. The pose model is downloaded from Google's MediaPipe storage the first time; connect and try again."
          : `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [src, meta, fps, poseModel]);

  const cancelAnalysis = useCallback(() => abortRef.current?.abort(), []);

  const autoDetect = useCallback(() => {
    if (!poseTrack) return;
    const r = detectPhases(poseTrack, meta ? meta.width / meta.height : 1);
    if ("error" in r) {
      setPhaseMessage({ ok: false, text: r.error });
      return;
    }
    const b = r.bookmarks;
    setBookmarks(b);
    const tempo = (b.T - b.A) / (b.I - b.T);
    setPhaseMessage({
      ok: true,
      text: `Set A/T/I/F · backswing ${(b.T - b.A).toFixed(2)}s, downswing ${(b.I - b.T).toFixed(2)}s, tempo ${tempo.toFixed(1)} : 1. Check each with Go and re-tag if needed.`,
    });
    navigate(b.A);
  }, [poseTrack, meta, navigate]);

  // ── Presets ──────────────────────────────────────────────────────
  const togglePreset = useCallback(
    (presetId: string) => {
      const existing = shapesRef.current.find((s) => s.presetId === presetId);
      checkpoint();
      if (existing) {
        setShapes((prev) => prev.filter((s) => s.presetId !== presetId));
        if (selectedId === existing.id) setSelectedId(null);
        return;
      }
      const def = PRESETS.find((p) => p.id === presetId);
      if (!def) return;
      const shape: Shape = {
        id: newId(),
        kind: def.kind,
        color: def.color,
        points: def.points.map((p) => ({ ...p })),
        presetId: def.id,
        label: def.name,
      };
      setShapes((prev) => [...prev, shape]);
      setSelectedId(shape.id);
    },
    [checkpoint, selectedId],
  );

  // ── Current-frame pose + metrics (pure lookups, no inference) ───
  const currentPose = poseAt(poseTrack, currentTime);
  const posesAtBookmarks = useMemo(
    () => ({
      A: bookmarks.A !== undefined ? poseAt(poseTrack, bookmarks.A) : null,
      T: bookmarks.T !== undefined ? poseAt(poseTrack, bookmarks.T) : null,
      I: bookmarks.I !== undefined ? poseAt(poseTrack, bookmarks.I) : null,
    }),
    [poseTrack, bookmarks],
  );
  const metrics = useMemo(
    () =>
      poseTrack && meta
        ? computeMetrics({
            angle,
            handed,
            width: meta.width,
            height: meta.height,
            cur: currentPose,
            at: posesAtBookmarks,
            hasA: bookmarks.A !== undefined,
          })
        : [],
    [poseTrack, meta, angle, handed, currentPose, posesAtBookmarks, bookmarks.A],
  );
  const numbers = useMemo(
    () =>
      poseTrack && meta
        ? keyNumbers({ angle, handed, width: meta.width, height: meta.height, cur: currentPose, at: posesAtBookmarks })
        : null,
    [poseTrack, meta, angle, handed, currentPose, posesAtBookmarks],
  );
  const coverage = useMemo(
    () =>
      poseTrack
        ? { detected: detectedCount(poseTrack), total: poseTrack.frames.length, fps: poseTrack.fps, delegate: poseTrack.delegate }
        : null,
    [poseTrack],
  );

  return {
    // video
    videoRef,
    src,
    meta,
    aspect,
    loading,
    error,
    ready,
    duration,
    flip,
    setFlip,
    loadFile,
    loadSample,
    onLoadedMetadata,
    onVideoError,
    // playback
    playing,
    currentTime,
    play,
    pause,
    togglePlay,
    seek,
    seekFrame,
    step,
    frameOf,
    lastFrame,
    clampTime,
    // checkpoints
    bookmarks,
    setCheckpointAt,
    jumpCheckpoint,
    clearCheckpoint,
    checkpointButton,
    // telestrator
    shapes,
    setShapes,
    selectedId,
    setSelectedId,
    checkpoint,
    undo,
    clearAll,
    recolorSelected,
    canUndo: historyLen > 0,
    togglePreset,
    // pose
    poseTrack,
    analysis,
    analyze,
    cancelAnalysis,
    handed,
    setHanded,
    autoDetect,
    phaseMessage,
    currentPose,
    metrics,
    numbers,
    coverage,
  };
}

export type SwingSide = ReturnType<typeof useSwingSide>;
