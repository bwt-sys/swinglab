"use client";

import { CHECKPOINTS } from "@/lib/constants";
import { angleAt, distPx, tiltFromVertical } from "@/lib/geometry";
import { presetsFor } from "@/lib/presets";
import type { Bookmarks, CameraAngle, CheckpointKey, Fps, Shape, VideoMeta } from "@/lib/types";
import Section from "./Section";
import { formatTime } from "./TransportControls";

interface Props {
  angle: CameraAngle;
  shapes: Shape[];
  onTogglePreset: (presetId: string) => void;
  bookmarks: Bookmarks;
  onSetCheckpoint: (k: CheckpointKey) => void;
  onJumpCheckpoint: (k: CheckpointKey) => void;
  onClearCheckpoint: (k: CheckpointKey) => void;
  meta: VideoMeta | null;
  fps: Fps;
  hasVideo: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** AI pose analysis + live metrics, rendered at the top of the sidebar. */
  aiPanel?: React.ReactNode;
  /** Rendered above everything (compare mode: You vs Pro table). */
  topPanel?: React.ReactNode;
  /** Compare mode: which video the per-video sections below refer to. */
  sideLabel?: string;
  /** Below the lg breakpoint the sidebar is an off-canvas drawer. */
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
}

function describeShape(s: Shape, w: number, h: number): { name: string; value: string } {
  switch (s.kind) {
    case "angle":
      return { name: s.label ?? "Angle", value: `${angleAt(s.points[0], s.points[1], s.points[2], w, h).toFixed(1)}°` };
    case "line":
      return {
        name: s.label ?? "Line",
        value: `${tiltFromVertical(s.points[0], s.points[1], w, h).toFixed(1)}° from vert.`,
      };
    case "circle":
      return { name: s.label ?? "Circle", value: `r ${((distPx(s.points[0], s.points[1], w, h) / w) * 100).toFixed(1)}% W` };
    case "rect":
      return {
        name: s.label ?? "Box",
        value: `${((Math.abs(s.points[1].x - s.points[0].x)) * 100).toFixed(0)}×${(Math.abs(s.points[1].y - s.points[0].y) * 100).toFixed(0)}%`,
      };
    case "pen":
      return { name: "Freehand", value: `${s.points.length} pts` };
  }
}

export default function Sidebar(p: Props) {
  const presets = presetsFor(p.angle);
  const activePresetIds = new Set(p.shapes.map((s) => s.presetId).filter(Boolean));
  const w = p.meta?.width ?? 1920;
  const h = p.meta?.height ?? 1080;

  const { A, T, I, F } = p.bookmarks;
  const backswing = A !== undefined && T !== undefined && T > A ? T - A : null;
  const downswing = T !== undefined && I !== undefined && I > T ? I - T : null;
  const tempo = backswing && downswing ? backswing / downswing : null;
  const total = A !== undefined && F !== undefined && F > A ? F - A : null;

  return (
    <>
    {/* Drawer backdrop (mobile / tablet only) */}
    <div
      aria-hidden
      onClick={p.onCloseDrawer}
      className={`fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm transition-opacity lg:hidden ${
        p.drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    />
    <aside
      data-testid="sidebar"
      aria-label="Analysis panel"
      className={`fixed inset-y-0 left-0 z-40 flex w-[min(22rem,88vw)] flex-col overflow-y-auto overscroll-contain border-r border-slate-800 bg-slate-950 shadow-2xl shadow-black max-lg:transition-transform max-lg:duration-200 lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:translate-x-0 lg:bg-slate-950/60 lg:shadow-none ${
        p.drawerOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur lg:hidden">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Analysis</span>
        <button
          type="button"
          onClick={p.onCloseDrawer}
          aria-label="Close panel"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {p.topPanel}
      {p.sideLabel && (
        <div className="sticky top-[57px] z-10 border-b lg:top-0 border-slate-800 bg-slate-950/95 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 backdrop-blur">
          Below: {p.sideLabel}
        </div>
      )}
      {p.aiPanel}
      <Section
        title={p.angle === "DTL" ? "DTL reference presets" : "Face-on reference presets"}
        aside={<span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">{p.angle}</span>}
      >
        <div className="flex flex-col gap-2">
          {presets.map((pr) => {
            const active = activePresetIds.has(pr.id);
            return (
              <button
                key={pr.id}
                type="button"
                disabled={!p.hasVideo}
                onClick={() => p.onTogglePreset(pr.id)}
                className={`group flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  active ? "border-slate-500 bg-slate-800/80" : "border-slate-800 bg-slate-900/50 hover:border-slate-600"
                }`}
                aria-pressed={active}
              >
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: pr.color, boxShadow: active ? `0 0 10px ${pr.color}` : undefined }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-100">{pr.name}</span>
                    <span className={`text-[10px] font-bold uppercase ${active ? "text-emerald-400" : "text-slate-600"}`}>
                      {active ? "On" : "Add"}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-slate-400">{pr.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Presets assume a right-handed golfer. Drag the handles to fit your setup.
        </p>
      </Section>

      <Section title={p.sideLabel ? `Swing checkpoints · ${p.sideLabel}` : "Swing checkpoints"}>
        <div className="flex flex-col gap-1.5">
          {CHECKPOINTS.map((c) => {
            const t = p.bookmarks[c.key];
            const set = t !== undefined;
            return (
              <div key={c.key} className="flex items-center gap-2 rounded-lg bg-slate-900/50 px-2 py-1.5">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-slate-950"
                  style={{ background: c.color }}
                >
                  {c.key}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm text-slate-200">{c.name}</span>
                  <span className="block font-mono text-[11px] tabular-nums text-slate-500">
                    {set ? `${formatTime(t!)} · frame ${Math.floor(t! * p.fps + 1e-6)}` : "Not tagged"}
                  </span>
                </span>
                <div className="flex items-center">
                  <button
                    type="button"
                    disabled={!p.hasVideo}
                    onClick={() => p.onSetCheckpoint(c.key)}
                    title={`Tag ${c.name} at current frame (Shift+${c.key})`}
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                  >
                    Set
                  </button>
                  <button
                    type="button"
                    disabled={!set}
                    onClick={() => p.onJumpCheckpoint(c.key)}
                    title={`Jump to ${c.name} (${c.key})`}
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
                  >
                    Go
                  </button>
                  <button
                    type="button"
                    disabled={!set}
                    onClick={() => p.onClearCheckpoint(c.key)}
                    title="Clear"
                    aria-label={`Clear ${c.name}`}
                    className="rounded px-1 py-0.5 text-[11px] text-slate-500 hover:bg-slate-800 hover:text-rose-300 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-900/60 px-2 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Backswing</div>
            <div className="font-mono text-sm text-slate-100">{backswing ? `${backswing.toFixed(2)}s` : "—"}</div>
          </div>
          <div className="rounded-lg bg-slate-900/60 px-2 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Downswing</div>
            <div className="font-mono text-sm text-slate-100">{downswing ? `${downswing.toFixed(2)}s` : "—"}</div>
          </div>
          <div className="rounded-lg bg-emerald-500/10 px-2 py-2 ring-1 ring-emerald-500/30">
            <div className="text-[10px] uppercase tracking-wide text-emerald-400/80">Tempo</div>
            <div className="font-mono text-sm font-semibold text-emerald-300">{tempo ? `${tempo.toFixed(1)} : 1` : "—"}</div>
          </div>
        </div>
        {total && <p className="mt-2 text-xs text-slate-500">Address → Finish: {total.toFixed(2)}s</p>}
      </Section>

      <Section title="Measurements" aside={<span className="text-[11px] text-slate-500">{p.shapes.length}</span>}>
        {p.shapes.length === 0 ? (
          <p className="text-xs text-slate-500">Draw lines and angles on the video to see live measurements here.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {p.shapes.map((s) => {
              const d = describeShape(s, w, h);
              const sel = s.id === p.selectedId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => p.onSelect(sel ? null : s.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition ${
                      sel ? "bg-slate-800" : "hover:bg-slate-900"
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="flex-1 truncate text-slate-300">{d.name}</span>
                    <span className="font-mono tabular-nums text-slate-100">{d.value}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Video">
        {p.meta ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-slate-500">File</dt>
            <dd className="truncate text-right text-slate-300" title={p.meta.name}>{p.meta.name}</dd>
            <dt className="text-slate-500">Resolution</dt>
            <dd className="text-right font-mono text-slate-300">{p.meta.width}×{p.meta.height}</dd>
            <dt className="text-slate-500">Orientation</dt>
            <dd className="text-right text-slate-300">
              {p.meta.height > p.meta.width ? "Vertical" : p.meta.height === p.meta.width ? "Square" : "Horizontal"}
            </dd>
            <dt className="text-slate-500">Duration</dt>
            <dd className="text-right font-mono text-slate-300">{formatTime(p.meta.duration)}</dd>
          </dl>
        ) : (
          <p className="text-xs text-slate-500">No video loaded.</p>
        )}
      </Section>

      <Section title="Shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {[
            ["Space", "Play / pause"],
            ["← →", "Step 1 frame (Shift = 10)"],
            ["A T I F", "Jump to checkpoint (tags it if unset)"],
            ["Shift+A…F", "Re-tag checkpoint at current frame"],
            ["1–5", "Move, Line, Circle, Angle, Pen"],
            ["Ctrl/⌘+Z", "Undo"],
            ["Del", "Delete selected shape"],
            ["Esc", "Cancel / deselect"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{k}</kbd>
              </dt>
              <dd className="text-slate-400">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </aside>
    </>
  );
}
