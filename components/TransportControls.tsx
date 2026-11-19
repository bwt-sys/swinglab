"use client";

import { useRef } from "react";
import { CHECKPOINTS, PLAYBACK_RATES } from "@/lib/constants";
import type { Bookmarks, CheckpointKey, Fps } from "@/lib/types";

interface Props {
  enabled: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  rate: number;
  onRate: (r: number) => void;
  fps: Fps;
  onFps: (f: Fps) => void;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
  onStep: (frames: number) => void;
  bookmarks: Bookmarks;
  onCheckpoint: (key: CheckpointKey) => void;
}

export function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  const { label, className = "", ...rest } = props;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...rest}
    />
  );
}

export default function TransportControls(p: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const frame = Math.floor(p.currentTime * p.fps + 1e-6);
  const totalFrames = Math.max(0, Math.floor(p.duration * p.fps));
  const pct = p.duration > 0 ? Math.min(100, (p.currentTime / p.duration) * 100) : 0;

  const seekFromEvent = (clientX: number) => {
    const el = trackRef.current;
    if (!el || p.duration <= 0) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    p.onSeek(ratio * p.duration);
  };

  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/70 px-4 pb-3 pt-4 ${p.enabled ? "" : "opacity-50"}`}>
      {/* Timeline */}
      <div className="relative">
        {/* Checkpoint markers */}
        <div className="pointer-events-none relative mb-1 h-5">
          {CHECKPOINTS.map((c) => {
            const t = p.bookmarks[c.key];
            if (t === undefined || p.duration <= 0) return null;
            return (
              <button
                key={c.key}
                type="button"
                title={`Jump to ${c.name}`}
                onClick={() => p.onSeek(t)}
                className="pointer-events-auto absolute top-0 -translate-x-1/2 rounded px-1.5 text-[10px] font-bold leading-5 text-slate-950"
                style={{ left: `${(t / p.duration) * 100}%`, background: c.color }}
              >
                {c.key}
              </button>
            );
          })}
        </div>
        <div
          ref={trackRef}
          role="slider"
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={totalFrames}
          aria-valuenow={frame}
          tabIndex={0}
          data-testid="timeline"
          className="group relative h-7 cursor-pointer touch-none select-none"
          onPointerDown={(e) => {
            if (!p.enabled) return;
            scrubbing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seekFromEvent(e.clientX);
          }}
          onPointerMove={(e) => scrubbing.current && seekFromEvent(e.clientX)}
          onPointerUp={(e) => {
            scrubbing.current = false;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-700" />
          <div
            className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
            style={{ width: `${pct}%` }}
          />
          {CHECKPOINTS.map((c) => {
            const t = p.bookmarks[c.key];
            if (t === undefined || p.duration <= 0) return null;
            return (
              <div
                key={c.key}
                className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2"
                style={{ left: `${(t / p.duration) * 100}%`, background: c.color }}
              />
            );
          })}
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-400 shadow-lg shadow-emerald-500/40 transition-transform group-hover:scale-110"
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>

      {/* Controls row */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <IconButton label="Step back 1 frame (←)" disabled={!p.enabled} onClick={() => p.onStep(-1)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M6 5h2v14H6zM20 5v14L9.5 12z" />
            </svg>
          </IconButton>
          <button
            type="button"
            disabled={!p.enabled}
            onClick={p.onTogglePlay}
            aria-label={p.playing ? "Pause (Space)" : "Play (Space)"}
            title={p.playing ? "Pause (Space)" : "Play (Space)"}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed"
          >
            {p.playing ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor">
                <path d="M7 4.5v15l12.5-7.5z" />
              </svg>
            )}
          </button>
          <IconButton label="Step forward 1 frame (→)" disabled={!p.enabled} onClick={() => p.onStep(1)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M16 5h2v14h-2zM4 5v14l10.5-7z" />
            </svg>
          </IconButton>
        </div>

        <div className="font-mono text-sm tabular-nums text-slate-300" data-testid="time-readout">
          {formatTime(p.currentTime)} <span className="text-slate-600">/</span> {formatTime(p.duration)}
          <span className="ml-3 text-slate-500">
            Frame <span className="text-slate-200">{frame}</span> / {totalFrames}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* Speed */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-800/80 p-1" role="group" aria-label="Playback speed">
            {PLAYBACK_RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => p.onRate(r)}
                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                  p.rate === r ? "bg-slate-200 text-slate-900" : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {r}x
              </button>
            ))}
          </div>

          {/* FPS */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-800/80 p-1" role="group" aria-label="Frame rate for stepping">
            {([30, 60] as Fps[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => p.onFps(f)}
                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                  p.fps === f ? "bg-slate-200 text-slate-900" : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {f} fps
              </button>
            ))}
          </div>

          {/* Checkpoints */}
          <div className="flex items-center gap-1" role="group" aria-label="Swing checkpoints">
            {CHECKPOINTS.map((c) => {
              const set = p.bookmarks[c.key] !== undefined;
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={!p.enabled}
                  onClick={() => p.onCheckpoint(c.key)}
                  title={set ? `Jump to ${c.name} (${c.key})` : `Tag ${c.name} at current frame (${c.key})`}
                  className="h-8 w-8 rounded-lg border text-xs font-bold transition disabled:cursor-not-allowed"
                  style={
                    set
                      ? { background: c.color, borderColor: c.color, color: "#020617" }
                      : { borderColor: "#334155", color: c.color }
                  }
                >
                  {c.key}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
