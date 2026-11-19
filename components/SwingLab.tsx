"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AngleToggle from "./AngleToggle";
import CoachPanel from "./CoachPanel";
import ComparePanel, { tempoOf, type SideKey } from "./ComparePanel";
import DrawingToolbar from "./DrawingToolbar";
import PosePanel from "./PosePanel";
import Sidebar from "./Sidebar";
import SyncBar from "./SyncBar";
import TransportControls, { formatTime } from "./TransportControls";
import { useSwingSide, type SwingSide } from "./useSwingSide";
import VideoStage from "./VideoStage";
import { coach } from "@/lib/coach";
import { CHECKPOINTS, NEON_COLORS, TOOLS } from "@/lib/constants";
import type { PoseModel } from "@/lib/pose";
import { exportSnapshot, type SnapshotPanel } from "@/lib/snapshot";
import type { Bookmarks, CameraAngle, CheckpointKey, Fps, Tool } from "@/lib/types";

type Mode = "single" | "compare";

const SIDE_LABEL: Record<SideKey, string> = { L: "Your Swing", R: "Reference / Pro Swing" };
const ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v";

/** Where the current frame sits relative to the tagged checkpoints, for the snapshot data bar. */
function checkpointLabel(s: SwingSide): string {
  const t = s.videoRef.current?.currentTime ?? s.currentTime;
  const f = s.frameOf(t);
  const marks = CHECKPOINTS.filter((c) => s.bookmarks[c.key] !== undefined)
    .map((c) => ({ c, f: s.frameOf(s.bookmarks[c.key]!) }))
    .sort((a, b) => a.f - b.f);
  const hit = marks.find((m) => m.f === f);
  if (hit) return `${hit.c.name} (${hit.c.key})`;
  const before = [...marks].reverse().find((m) => m.f < f);
  const after = marks.find((m) => m.f > f);
  if (before && after) return `Between ${before.c.name} and ${after.c.name}`;
  if (before) return `After ${before.c.name}`;
  if (after) return `Before ${after.c.name}`;
  return "No checkpoint tagged";
}

export default function SwingLab() {
  // ── Shared settings ──────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>("single");
  const [angle, setAngle] = useState<CameraAngle>("DTL");
  const [rate, setRate] = useState(1);
  const [fps, setFps] = useState<Fps>(30);
  const [tool, setTool] = useState<Tool>("line");
  const [color, setColor] = useState<string>(NEON_COLORS[0].value);
  const [poseModel, setPoseModel] = useState<PoseModel>("full");
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [activeKey, setActiveKey] = useState<SideKey>("L");
  /** Mobile / tablet: the sidebar is an off-canvas drawer. */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Sync lock (compare mode) ─────────────────────────────────────
  /** Reference time minus your time at the locked alignment, in seconds. */
  const [sync, setSync] = useState<{ locked: boolean; offset: number }>({ locked: false, offset: 0 });
  const compare = mode === "compare";
  const locked = compare && sync.locked;

  // Navigation seeks (Go to checkpoint, auto-detect) are routed through the sync controller while locked.
  const navL = useRef<((t: number) => void) | null>(null);
  const navR = useRef<((t: number) => void) | null>(null);

  // ── The two videos ───────────────────────────────────────────────
  const L = useSwingSide({ angle, fps, rate, poseModel, onSampleLoaded: () => setAngle("FO"), navigate: navL });
  const R = useSwingSide({ angle, fps, rate, poseModel, onSampleLoaded: () => setAngle("FO"), navigate: navR, sampleName: "Sample swing (reference)" });
  const sides: Record<SideKey, SwingSide> = { L, R };
  const activeK: SideKey = compare ? activeKey : "L";
  const S = sides[activeK];

  const activate = useCallback(
    (k: SideKey) => {
      setActiveKey(k);
      // Only one side can hold a selection, so Delete/colour changes never hit the other video.
      (k === "L" ? R : L).setSelectedId(null);
    },
    [L, R],
  );

  // ── Linked (master) transport ────────────────────────────────────
  const offFrames = Math.round(sync.offset * fps);
  const bothReady = L.ready && R.ready;
  /** Range of *your* frames for which the reference also has footage. */
  const lo = Math.max(0, -offFrames);
  const hi = Math.min(L.lastFrame, R.lastFrame - offFrames);
  const linkedOk = bothReady && hi >= lo;

  const masterSeekFrame = useCallback(
    (fL: number) => {
      if (!linkedOk) return;
      const f = Math.max(lo, Math.min(hi, fL));
      L.seekFrame(f);
      R.seekFrame(f + offFrames);
    },
    [linkedOk, lo, hi, offFrames, L, R],
  );

  const masterSeekTime = useCallback((tL: number) => masterSeekFrame(L.frameOf(tL)), [masterSeekFrame, L]);

  const masterStep = useCallback(
    (n: number) => {
      const v = L.videoRef.current;
      if (!v) return;
      L.pause();
      R.pause();
      masterSeekFrame(L.frameOf(v.currentTime) + n);
    },
    [L, R, masterSeekFrame],
  );

  const masterPlaying = L.playing || R.playing;
  const lVideo = L.videoRef;
  const rVideo = R.videoRef;
  const masterToggle = useCallback(() => {
    const lv = L.videoRef.current;
    const rv = R.videoRef.current;
    if (!lv || !rv || !linkedOk) return;
    if (!lv.paused || !rv.paused) {
      lv.pause();
      rv.pause();
      masterSeekFrame(L.frameOf(lv.currentTime)); // re-align exactly on the frame
      return;
    }
    let f = L.frameOf(lv.currentTime);
    if (f >= hi || f < lo) f = lo;
    masterSeekFrame(f);
    lv.playbackRate = rate;
    rv.playbackRate = rate;
    lv.play().catch(() => undefined);
    rv.play().catch(() => undefined);
  }, [L, R, linkedOk, hi, lo, rate, masterSeekFrame]);

  // Keep the reference glued to your video while both play (gentle rate nudging, hard resync if far off).
  useEffect(() => {
    if (!locked || !masterPlaying) return;
    const lv = lVideo.current;
    const rv = rVideo.current;
    if (!lv || !rv) return;
    const off = offFrames / fps;
    let raf = 0;
    const tick = () => {
      if (lv.paused !== rv.paused || lv.ended || rv.ended || Math.floor(lv.currentTime * fps + 1e-6) > hi) {
        lv.pause();
        rv.pause();
        return;
      }
      const err = lv.currentTime + off - rv.currentTime;
      if (Math.abs(err) > 0.25) rv.currentTime = lv.currentTime + off;
      else rv.playbackRate = rate * (1 + Math.max(-0.25, Math.min(0.25, err * 3)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      rv.playbackRate = rate;
    };
  }, [locked, masterPlaying, offFrames, fps, hi, rate, lVideo, rVideo]);

  navL.current = locked ? (t) => masterSeekTime(t) : null;
  navR.current = locked ? (t) => masterSeekTime(t - offFrames / fps) : null;

  const toggleLock = useCallback(() => {
    if (sync.locked) {
      setSync((s) => ({ ...s, locked: false }));
      return;
    }
    const lv = L.videoRef.current;
    const rv = R.videoRef.current;
    if (!lv || !rv || !bothReady) return;
    lv.pause();
    rv.pause();
    // Lock at the current alignment.
    setSync({ locked: true, offset: (R.frameOf(rv.currentTime) - L.frameOf(lv.currentTime)) / fps });
  }, [sync.locked, L, R, bothReady, fps]);

  const syncAt = useCallback(
    (k: "T" | "I") => {
      const bl = L.bookmarks[k];
      const br = R.bookmarks[k];
      if (bl === undefined || br === undefined) return;
      L.pause();
      R.pause();
      const fl = L.frameOf(bl);
      const fr = R.frameOf(br);
      setSync({ locked: true, offset: (fr - fl) / fps });
      L.seekFrame(fl);
      R.seekFrame(fr);
    },
    [L, R, fps],
  );

  // Leaving compare mode: stop the reference.
  const pauseR = R.pause;
  useEffect(() => {
    if (!compare) pauseR();
  }, [compare, pauseR]);

  const changeRate = useCallback((r: number) => setRate(r), []);

  // Per-side transport handlers (routed to the master while locked).
  const sideHandlers = (k: SideKey) => {
    const s = sides[k];
    const shift = k === "R" ? offFrames / fps : 0;
    return {
      onTogglePlay: locked ? masterToggle : s.togglePlay,
      onSeek: locked ? (t: number) => masterSeekTime(t - shift) : s.seek,
      onStep: locked ? masterStep : s.step,
    };
  };

  // ── Global keyboard shortcuts ────────────────────────────────────
  const keyHandlers = useRef({ S, locked, masterToggle, masterStep, compare, activate, activeK });
  keyHandlers.current = { S, locked, masterToggle, masterStep, compare, activate, activeK };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const h = keyHandlers.current;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        h.S.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (h.locked) h.masterToggle();
          else h.S.togglePlay();
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const n = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1);
          if (h.locked) h.masterStep(n);
          else h.S.step(n);
          return;
        }
        case "Tab":
          if (h.compare) {
            e.preventDefault();
            h.activate(h.activeK === "L" ? "R" : "L");
          }
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
        if (e.shiftKey) h.S.setCheckpointAt(k);
        else h.S.checkpointButton(k);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const headerFileRef = useRef<HTMLInputElement>(null);
  const sideFileRefs = { L: useRef<HTMLInputElement>(null), R: useRef<HTMLInputElement>(null) };

  // Master timeline is expressed in "linked" time starting at the first shared frame.
  const loT = lo / fps;
  const masterBookmarks: Bookmarks = {};
  if (linkedOk) {
    for (const k of ["A", "T", "I", "F"] as CheckpointKey[]) {
      const t = L.bookmarks[k];
      if (t !== undefined) {
        const f = L.frameOf(t);
        if (f >= lo && f <= hi) masterBookmarks[k] = t - loT;
      }
    }
  }

  // ── Coach Tips (always about Your Swing; uses the reference too in compare mode) ──
  const proAnalyzed = compare && !!R.poseTrack;
  const coachResult = useMemo(
    () =>
      coach({
        angle,
        analyzed: !!L.poseTrack,
        you: L.numbers,
        youTempo: tempoOf(L.bookmarks),
        pro: proAnalyzed ? R.numbers : undefined,
        proTempo: proAnalyzed ? tempoOf(R.bookmarks) : undefined,
        tagged: { A: L.bookmarks.A !== undefined, T: L.bookmarks.T !== undefined, I: L.bookmarks.I !== undefined, F: L.bookmarks.F !== undefined },
      }),
    [angle, L.poseTrack, L.numbers, L.bookmarks, proAnalyzed, R.numbers, R.bookmarks],
  );

  const coachShow = useCallback(
    (k: CheckpointKey) => {
      if (compare) activate("L");
      L.jumpCheckpoint(k);
      setDrawerOpen(false); // on phones, reveal the video
    },
    [compare, activate, L],
  );

  // ── Snapshot export ──────────────────────────────────────────────
  const visibleSides: SideKey[] = compare ? ["L", "R"] : ["L"];
  const canExport = visibleSides.some((k) => sides[k].ready);

  const showToast = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    window.setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), 3500);
  }, []);

  const onExport = async () => {
    const panels: SnapshotPanel[] = [];
    for (const k of visibleSides) {
      const s = sides[k];
      const v = s.videoRef.current;
      if (!s.ready || !v) continue;
      const stats = s.metrics.filter((m) => m.value !== null).slice(0, 3).map((m) => ({ label: m.label, value: m.value! }));
      const tempo = tempoOf(s.bookmarks);
      if (tempo !== null) stats.push({ label: "Tempo", value: `${tempo.toFixed(1)}:1` });
      const t = v.currentTime;
      panels.push({
        video: v,
        title: SIDE_LABEL[k],
        accent: k === "L" ? "#34d399" : "#22d3ee",
        flip: compare && s.flip,
        pose: s.currentPose,
        handed: s.handed,
        showSkeleton: showSkeleton && !!s.poseTrack,
        shapes: s.shapes,
        checkpoint: checkpointLabel(s),
        position: `${formatTime(t)} · frame ${s.frameOf(t)}`,
        stats,
      });
    }
    if (!panels.length) return;
    setExporting(true);
    try {
      await exportSnapshot(panels, { angle, filename: "swinglab-analysis.png" });
      showToast(true, "Saved swinglab-analysis.png");
    } catch (e) {
      showToast(false, `Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Render helpers ───────────────────────────────────────────────
  const renderStage = (k: SideKey) => {
    const s = sides[k];
    return (
      <VideoStage
        videoRef={s.videoRef}
        src={s.src}
        aspect={s.aspect}
        loading={s.loading}
        error={s.error}
        onFile={s.loadFile}
        onLoadSample={s.loadSample}
        onLoadedMetadata={s.onLoadedMetadata}
        onVideoError={s.onVideoError}
        shapes={s.shapes}
        setShapes={s.setShapes}
        checkpoint={s.checkpoint}
        tool={tool}
        color={color}
        selectedId={s.selectedId}
        setSelectedId={s.setSelectedId}
        pose={s.currentPose}
        handed={s.handed}
        showSkeleton={showSkeleton && !!s.poseTrack}
        flip={compare && s.flip}
        compact={compare}
        emptyTitle={compare ? (k === "L" ? "Drop your swing here" : "Drop a reference / pro swing here") : undefined}
        onActivate={compare ? () => activate(k) : undefined}
        active={compare && activeK === k}
      />
    );
  };

  const renderSideHeader = (k: SideKey) => {
    const s = sides[k];
    const isActive = activeK === k;
    const accent = k === "L" ? "bg-emerald-400" : "bg-cyan-400";
    return (
      <div className="flex min-h-8 items-center gap-2" onPointerDownCapture={() => activate(k)}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${accent} ${isActive ? "" : "opacity-40"}`} />
        <span className={`text-sm font-bold ${isActive ? "text-slate-100" : "text-slate-400"}`}>{SIDE_LABEL[k]}</span>
        {s.meta && (
          <span className="min-w-0 truncate text-xs text-slate-500" title={s.meta.name}>
            {s.meta.name}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {k === "R" && (
            <button
              type="button"
              disabled={!s.src}
              onClick={() => s.setFlip(!s.flip)}
              aria-pressed={s.flip}
              title="Mirror the reference video (e.g. compare against an opposite-handed golfer). Display only: metrics are unchanged."
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition disabled:opacity-40 ${
                s.flip ? "bg-cyan-400 text-slate-950" : "border border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-800"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18M8 7l-5 5 5 5V7zM16 7l5 5-5 5V7z" />
              </svg>
              Flip Horizontal
            </button>
          )}
          <button
            type="button"
            onClick={() => sideFileRefs[k].current?.click()}
            className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800"
          >
            {s.src ? "Replace" : "Open"}
          </button>
          <input
            ref={sideFileRefs[k]}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) s.loadFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    );
  };

  const renderSideTransport = (k: SideKey) => {
    const s = sides[k];
    const h = sideHandlers(k);
    return (
      <TransportControls
        testId={`transport-${k}`}
        compact
        enabled={s.ready}
        playing={locked ? masterPlaying : s.playing}
        onTogglePlay={h.onTogglePlay}
        rate={rate}
        onRate={changeRate}
        fps={fps}
        onFps={setFps}
        currentTime={s.currentTime}
        duration={s.duration}
        onSeek={h.onSeek}
        onStep={h.onStep}
        bookmarks={s.bookmarks}
        onCheckpoint={(c) => {
          activate(k);
          s.checkpointButton(c);
        }}
      />
    );
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800 bg-slate-950/80 px-3 py-2 backdrop-blur sm:px-5 sm:py-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-4">
        <div className="order-1 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open analysis panel"
            data-testid="drawer-toggle"
            className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
            {coachResult.tips.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-950">
                {coachResult.tips.length}
              </span>
            )}
          </button>
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

        <div className="order-3 flex w-full items-center justify-center gap-2 sm:gap-3 lg:order-2 lg:w-auto">
          <div className="flex rounded-xl border border-slate-800 bg-slate-900/80 p-1" role="group" aria-label="View mode">
            {([
              ["single", "Single Swing", "Single"],
              ["compare", "Compare (Split-Screen)", "Compare"],
            ] as [Mode, string, string][]).map(([m, label, short]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                aria-label={label}
                onClick={() => setMode(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition pointer-coarse:py-2 ${
                  mode === m ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-100"
                }`}
              >
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{short}</span>
              </button>
            ))}
          </div>
          <AngleToggle value={angle} onChange={setAngle} />
        </div>

        <div className="order-2 ml-auto flex items-center justify-end gap-2 lg:order-3 lg:ml-0">
          {!compare && L.meta && (
            <span className="hidden max-w-[16rem] truncate text-xs text-slate-500 xl:inline" title={L.meta.name}>
              {L.meta.name}
            </span>
          )}
          <button
            type="button"
            onClick={S.loadSample}
            title={compare ? `Load the sample into ${SIDE_LABEL[activeK]}` : undefined}
            className="hidden rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 md:block"
          >
            Sample
          </button>
          <button
            type="button"
            onClick={() => headerFileRef.current?.click()}
            title={compare ? `Open into ${SIDE_LABEL[activeK]}` : undefined}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            Open video
          </button>
          <input
            ref={headerFileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) S.loadFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          angle={angle}
          shapes={S.shapes}
          onTogglePreset={S.togglePreset}
          bookmarks={S.bookmarks}
          onSetCheckpoint={S.setCheckpointAt}
          onJumpCheckpoint={S.jumpCheckpoint}
          onClearCheckpoint={S.clearCheckpoint}
          meta={S.meta}
          fps={fps}
          hasVideo={S.ready}
          selectedId={S.selectedId}
          onSelect={S.setSelectedId}
          sideLabel={compare ? SIDE_LABEL[activeK] : undefined}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          topPanel={
            compare ? (
              <ComparePanel
                angle={angle}
                active={activeK}
                onActive={activate}
                you={{ numbers: L.numbers, bookmarks: L.bookmarks, analyzed: !!L.poseTrack, hasVideo: L.ready }}
                pro={{ numbers: R.numbers, bookmarks: R.bookmarks, analyzed: !!R.poseTrack, hasVideo: R.ready }}
              />
            ) : undefined
          }
          aiPanel={
            <PosePanel
              angle={angle}
              hasVideo={S.ready}
              analysis={S.analysis}
              coverage={S.coverage}
              model={poseModel}
              onModel={setPoseModel}
              onAnalyze={S.analyze}
              onCancel={S.cancelAnalysis}
              showSkeleton={showSkeleton}
              onShowSkeleton={setShowSkeleton}
              handed={S.handed}
              onHanded={S.setHanded}
              onAutoDetect={S.autoDetect}
              phaseMessage={S.phaseMessage}
              metrics={S.metrics}
              poseVisible={!!S.currentPose}
              coachCount={coachResult.tips.length}
              coach={
                <>
                  {compare && activeK === "R" && (
                    <p className="mb-2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-400">
                      Coaching applies to <span className="font-semibold text-emerald-300">Your Swing</span>; the reference is the benchmark.
                    </p>
                  )}
                  <CoachPanel result={coachResult} comparing={proAnalyzed} onShow={L.ready ? coachShow : undefined} />
                </>
              }
            />
          }
        />

        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-2 sm:p-4 lg:overflow-hidden">
          <DrawingToolbar
            onExport={onExport}
            canExport={canExport}
            exporting={exporting}
            tool={tool}
            onTool={setTool}
            color={color}
            onColor={(c) => {
              setColor(c);
              S.recolorSelected(c);
            }}
            canUndo={S.canUndo}
            onUndo={S.undo}
            onClear={S.clearAll}
            hasShapes={S.shapes.length > 0}
          />

          {/* Stages. Your Swing keeps the same tree position in both modes so the video isn't reloaded. */}
          {/* Phones (< md): compare stacks vertically and the page scrolls; each stage keeps a usable height. */}
          <div
            data-testid="stages"
            className={`flex flex-none gap-3 lg:min-h-0 lg:flex-1 ${compare ? "flex-col md:flex-row md:max-lg:min-h-[60svh]" : "max-lg:min-h-[58svh]"}`}
          >
            <section className={`flex min-w-0 flex-1 flex-col gap-2 ${compare ? "max-md:min-h-[72svh]" : ""}`} data-testid="side-L">
              {compare ? renderSideHeader("L") : null}
              {renderStage("L")}
              {compare ? renderSideTransport("L") : null}
            </section>
            {compare && (
              <section className="flex min-w-0 flex-1 flex-col gap-2 max-md:min-h-[72svh]" data-testid="side-R">
                {renderSideHeader("R")}
                {renderStage("R")}
                {renderSideTransport("R")}
              </section>
            )}
          </div>

          {compare ? (
            <SyncBar
              locked={locked}
              canLock={bothReady}
              onToggleLock={toggleLock}
              onSyncAt={syncAt}
              canSyncAt={{
                T: bothReady && L.bookmarks.T !== undefined && R.bookmarks.T !== undefined,
                I: bothReady && L.bookmarks.I !== undefined && R.bookmarks.I !== undefined,
              }}
              offsetFrames={locked ? offFrames : null}
              rate={rate}
              onRate={changeRate}
              fps={fps}
              onFps={setFps}
              playing={masterPlaying}
              onTogglePlay={masterToggle}
              currentTime={Math.max(0, L.currentTime - loT)}
              duration={linkedOk ? (hi - lo + 1) / fps : 0}
              onSeek={(t) => masterSeekTime(t + loT)}
              onStep={masterStep}
              bookmarks={masterBookmarks}
              onCheckpoint={(k) => {
                const t = L.bookmarks[k];
                if (t !== undefined) masterSeekTime(t);
              }}
            />
          ) : (
            <TransportControls
              enabled={L.ready}
              playing={L.playing}
              onTogglePlay={L.togglePlay}
              rate={rate}
              onRate={changeRate}
              fps={fps}
              onFps={setFps}
              currentTime={L.currentTime}
              duration={L.duration}
              onSeek={L.seek}
              onStep={L.step}
              bookmarks={L.bookmarks}
              onCheckpoint={L.checkpointButton}
            />
          )}
        </main>
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" role="status" data-testid="toast">
          <p
            className={`rounded-xl px-4 py-2 text-sm font-semibold shadow-xl ring-1 ${
              toast.ok ? "bg-emerald-950/95 text-emerald-200 ring-emerald-700" : "bg-rose-950/95 text-rose-200 ring-rose-800"
            }`}
          >
            {toast.text}
          </p>
        </div>
      )}
    </div>
  );
}
