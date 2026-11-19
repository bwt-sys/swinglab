"use client";

import { PLAYBACK_RATES } from "@/lib/constants";
import type { Bookmarks, CheckpointKey, Fps } from "@/lib/types";
import TransportControls from "./TransportControls";

interface Props {
  locked: boolean;
  canLock: boolean;
  onToggleLock: () => void;
  onSyncAt: (k: "T" | "I") => void;
  canSyncAt: { T: boolean; I: boolean };
  /** Reference minus yours, in frames (null when unlocked). */
  offsetFrames: number | null;
  rate: number;
  onRate: (r: number) => void;
  fps: Fps;
  onFps: (f: Fps) => void;
  // Master transport (in "linked" time, starting where both videos have footage)
  playing: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
  onStep: (frames: number) => void;
  bookmarks: Bookmarks;
  onCheckpoint: (k: CheckpointKey) => void;
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-slate-800/80 p-1" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
            value === v ? "bg-slate-200 text-slate-900" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export default function SyncBar(p: Props) {
  const off = p.offsetFrames;
  return (
    <div className="flex flex-col gap-2" data-testid="sync-bar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
        <button
          type="button"
          role="switch"
          aria-checked={p.locked}
          disabled={!p.canLock}
          onClick={p.onToggleLock}
          title={p.locked ? "Unlock: scrub each video on its own" : "Lock both videos together at their current frames"}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            p.locked ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400" : "border border-slate-600 text-slate-200 hover:border-slate-400 hover:bg-slate-800"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            {p.locked ? <path d="M8 11V7a4 4 0 018 0v4" /> : <path d="M8 11V7a4 4 0 017.5-2" />}
          </svg>
          Sync Lock {p.locked ? "On" : "Off"}
        </button>

        {(["T", "I"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={!p.canSyncAt[k]}
            onClick={() => p.onSyncAt(k)}
            title={
              p.canSyncAt[k]
                ? `Line up both videos at ${k === "I" ? "Impact" : "Top"} and lock them`
                : `Tag ${k === "I" ? "Impact (I)" : "Top (T)"} on both videos first`
            }
            className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sync at {k === "I" ? "Impact (I)" : "Top (T)"}
          </button>
        ))}

        <span className="text-xs text-slate-500" data-testid="sync-offset">
          {off === null
            ? "Unlocked · each video scrubs on its own"
            : off === 0
              ? "Locked · same frame on both"
              : `Locked · reference ${off > 0 ? "+" : "−"}${Math.abs(off)} frame${Math.abs(off) === 1 ? "" : "s"}`}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Seg label="Playback speed" value={p.rate} onChange={p.onRate} options={PLAYBACK_RATES.map((r) => [r, `${r}x`])} />
          <Seg label="Frame rate for stepping" value={p.fps} onChange={p.onFps} options={[[30, "30 fps"], [60, "60 fps"]] as [Fps, string][]} />
        </div>
      </div>

      {p.locked && (
        <TransportControls
          testId="master-transport"
          compact
          jumpOnly
          enabled
          leading={<span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">Master</span>}
          playing={p.playing}
          onTogglePlay={p.onTogglePlay}
          rate={p.rate}
          onRate={p.onRate}
          fps={p.fps}
          onFps={p.onFps}
          currentTime={p.currentTime}
          duration={p.duration}
          onSeek={p.onSeek}
          onStep={p.onStep}
          bookmarks={p.bookmarks}
          onCheckpoint={p.onCheckpoint}
        />
      )}
    </div>
  );
}
