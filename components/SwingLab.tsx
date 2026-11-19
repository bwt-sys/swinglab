"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AngleToggle from "./AngleToggle";
import DrawingToolbar from "./DrawingToolbar";
import PosePanel, { type AnalysisState } from "./PosePanel";
import Sidebar from "./Sidebar";
import { computeMetrics, type Handed } from "@/lib/metrics";
import { detectPhases } from "@/lib/phases";
import { analyzeVideo, detectedCount, poseAt, type PoseModel, type PoseTrack } from "@/lib/pose";
import TransportControls from "./TransportControls";
import VideoStage from "./VideoStage";
import { NEON_COLORS, SAMPLE_VIDEO_URL, SUPPORTED_EXTENSIONS, TOOLS } from "@/lib/constants";
import { newId } from "@/lib/geometry";
import { PRESETS } from "@/lib/presets";
import type { Bookmarks, CameraAngle, CheckpointKey, Fps, Shape, Tool, VideoMeta } from "@/lib/types";

const MAX_HISTORY = 100;

export default function SwingLab() {
  // ── Session state ────────────────────────────────────────────────
  const [angle, setAngle] = useState<CameraAngle>("DTL");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingNameRef = useRef<string>("");
  const [src, setSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Playback ─────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [fps, setFps] = useState<Fps>(30);
  const [bookmarks, setBookmarks] = useState<Bookmarks>({});

  // ── Telestrator ──────────────────────────────────────────────────
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>("line");
  const [color, setColor] = useState<string>(NEON_COLORS[0].value);
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

  // ── AI pose ──────────────────────────────────────────────────────
  const [poseTrack, setPoseTrack] = useState<PoseTrack | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: "idle", done: 0, total: 0, message: null });
  const [poseModel, setPoseModel] = useState<PoseModel>("full");
  const [handed, setHanded] = useState<Handed>("R");
  const [showSkeleton, setShowSkeleton] = useState(true);
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
    pendingNameRef.current = "Sample swing (face-on)";
    resetSession();
    setError(null);
    setLoading(true);
    setAngle("FO");
    setSrc(SAMPLE_VIDEO_URL);
  }, []);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const finish = () => {
      const w = v.videoWidth || 1920;
      const h = v.videoHeight || 1080;
      setAspect(w / h);
      setMeta({ name: pendingNameRef.current, width: w, height: h, duration: v.duration });
      setLoading(false);
      v.playbackRate = rate;
      // Nudge to the first frame so it paints in every browser.
      if (v.currentTime === 0) v.currentTime = 0.5 / fps;
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
  }, [rate, fps]);

  const onVideoError = useCallback(() => {
    const isSample = src === SAMPLE_VIDEO_URL;
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
  }, [src]);

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

  const duration = meta?.duration ?? 0;
  const ready = !!src && !!meta;

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !ready) return;
    if (v.paused) {
      if (v.ended || v.currentTime >= v.duration - 0.01) v.currentTime = 0;
      v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, [ready]);

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

  const step = useCallback(
    (frames: number) => {
      const v = videoRef.current;
      if (!v || !ready) return;
      v.pause();
      const lastFrame = Math.max(0, Math.floor(duration * fps) - 1);
      const cur = Math.floor(v.currentTime * fps + 1e-6);
      const target = Math.max(0, Math.min(lastFrame, cur + frames));
      // Seek to the middle of the target frame so the decoder lands on it reliably.
      const t = Math.min(duration - 0.0005, (target + 0.5) / fps);
      v.currentTime = t;
      setCurrentTime(t);
    },
    [ready, duration, fps],
  );

  const changeRate = useCallback((r: number) => {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  }, []);

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
      videoRef.current?.pause();
      seek(t);
    },
    [bookmarks, seek],
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
    const started = performance.now();
    try {
      const track = await analyzeVideo({
        src,
        fps,
        duration: meta.duration,
        model: poseModel,
        signal: ac.signal,
        onModelReady: () => {
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
  useEffect(() => () => abortRef.current?.abort(), []);

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
    videoRef.current?.pause();
    seek(b.A);
  }, [poseTrack, meta, seek]);

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

  // ── Global keyboard shortcuts ────────────────────────────────────
  const keyHandlers = useRef({ togglePlay, step, undo, checkpointButton, setCheckpointAt });
  keyHandlers.current = { togglePlay, step, undo, checkpointButton, setCheckpointAt };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const h = keyHandlers.current;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        h.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          h.togglePlay();
          return;
        case "ArrowLeft":
          e.preventDefault();
          h.step(e.shiftKey ? -10 : -1);
          return;
        case "ArrowRight":
          e.preventDefault();
          h.step(e.shiftKey ? 10 : 1);
          return;
      }

      const toolIdx = ["1", "2", "3", "4", "5"].indexOf(e.key);
      if (toolIdx >= 0) {
        setTool(TOOLS[toolIdx].id);
        return;
      }

      const k = e.key.toUpperCase();
      if (k === "A" || k === "T" || k === "I" || k === "F") {
        e.preventDefault();
        if (e.shiftKey) h.setCheckpointAt(k);
        else h.checkpointButton(k);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const headerFileRef = useRef<HTMLInputElement>(null);

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
  const coverage = useMemo(
    () =>
      poseTrack
        ? { detected: detectedCount(poseTrack), total: poseTrack.frames.length, fps: poseTrack.fps, delegate: poseTrack.delegate }
        : null,
    [poseTrack],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-slate-800 bg-slate-950/80 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-lg shadow-emerald-500/20">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-950" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="18" r="2.5" fill="currentColor" stroke="none" />
              <path d="M7 3l7.5 12.5" />
            </svg>
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-bold tracking-tight">
              Swing<span className="text-emerald-400">Lab</span>
            </h1>
            <p className="hidden text-[11px] text-slate-500 sm:block">Golf swing analyzer</p>
          </div>
        </div>

        <AngleToggle value={angle} onChange={setAngle} />

        <div className="flex items-center justify-end gap-2">
          {meta && (
            <span className="hidden max-w-[16rem] truncate text-xs text-slate-500 xl:inline" title={meta.name}>
              {meta.name}
            </span>
          )}
          <button
            type="button"
            onClick={loadSample}
            className="hidden rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 md:block"
          >
            Sample
          </button>
          <button
            type="button"
            onClick={() => headerFileRef.current?.click()}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            Open video
          </button>
          <input
            ref={headerFileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          angle={angle}
          shapes={shapes}
          onTogglePreset={togglePreset}
          bookmarks={bookmarks}
          onSetCheckpoint={setCheckpointAt}
          onJumpCheckpoint={jumpCheckpoint}
          onClearCheckpoint={clearCheckpoint}
          meta={meta}
          fps={fps}
          hasVideo={ready}
          selectedId={selectedId}
          onSelect={setSelectedId}
          aiPanel={
            <PosePanel
              angle={angle}
              hasVideo={ready}
              analysis={analysis}
              coverage={coverage}
              model={poseModel}
              onModel={setPoseModel}
              onAnalyze={analyze}
              onCancel={cancelAnalysis}
              showSkeleton={showSkeleton}
              onShowSkeleton={setShowSkeleton}
              handed={handed}
              onHanded={setHanded}
              onAutoDetect={autoDetect}
              phaseMessage={phaseMessage}
              metrics={metrics}
              poseVisible={!!currentPose}
            />
          }
        />

        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <DrawingToolbar
            tool={tool}
            onTool={setTool}
            color={color}
            onColor={(c) => {
              setColor(c);
              // Recolor the selected shape too.
              if (selectedId) {
                checkpoint();
                setShapes((prev) => prev.map((s) => (s.id === selectedId ? { ...s, color: c } : s)));
              }
            }}
            canUndo={historyLen > 0}
            onUndo={undo}
            onClear={clearAll}
            hasShapes={shapes.length > 0}
          />

          <VideoStage
            videoRef={videoRef}
            src={src}
            aspect={aspect}
            loading={loading}
            error={error}
            onFile={loadFile}
            onLoadSample={loadSample}
            onLoadedMetadata={onLoadedMetadata}
            onVideoError={onVideoError}
            shapes={shapes}
            setShapes={setShapes}
            checkpoint={checkpoint}
            tool={tool}
            color={color}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            pose={currentPose}
            handed={handed}
            showSkeleton={showSkeleton && !!poseTrack}
          />

          <TransportControls
            enabled={ready}
            playing={playing}
            onTogglePlay={togglePlay}
            rate={rate}
            onRate={changeRate}
            fps={fps}
            onFps={setFps}
            currentTime={currentTime}
            duration={duration}
            onSeek={seek}
            onStep={step}
            bookmarks={bookmarks}
            onCheckpoint={checkpointButton}
          />
        </main>
      </div>
    </div>
  );
}
