"use client";

import { useEffect, useState } from "react";
import { pixelReadbackScrambled } from "@/lib/canvasCheck";
import type { Handed, MetricRow } from "@/lib/metrics";
import type { PoseModel } from "@/lib/pose";
import type { CameraAngle } from "@/lib/types";
import Section from "./Section";

export interface AnalysisState {
  status: "idle" | "loading-model" | "running" | "done" | "error";
  done: number;
  total: number;
  message: string | null;
}

interface Props {
  angle: CameraAngle;
  hasVideo: boolean;
  analysis: AnalysisState;
  /** Frames with a detected pose / total sampled frames, when a track exists. */
  coverage: { detected: number; total: number; fps: number; delegate: string } | null;
  model: PoseModel;
  onModel: (m: PoseModel) => void;
  onAnalyze: () => void;
  onCancel: () => void;
  showSkeleton: boolean;
  onShowSkeleton: (v: boolean) => void;
  handed: Handed;
  onHanded: (h: Handed) => void;
  onAutoDetect: () => void;
  phaseMessage: { ok: boolean; text: string } | null;
  metrics: MetricRow[];
  poseVisible: boolean;
  /** Coach Tips tab content, shown alongside Live metrics. */
  coach: React.ReactNode;
  /** Number of flagged tips (badge on the tab). */
  coachCount: number;
}

type Tab = "metrics" | "coach";

function Seg<T extends string>({ value, options, onChange, disabled }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex rounded-lg bg-slate-800/80 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition disabled:opacity-50 ${
            value === v ? "bg-slate-200 text-slate-900" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const TONE: Record<string, string> = {
  warn: "text-amber-300",
  good: "text-emerald-300",
  neutral: "text-slate-100",
};

export default function PosePanel(p: Props) {
  const busy = p.analysis.status === "loading-model" || p.analysis.status === "running";
  const pct = p.analysis.total ? (p.analysis.done / p.analysis.total) * 100 : 0;
  const hasTrack = !!p.coverage;
  const [tab, setTab] = useState<Tab>("metrics");
  // Checked after mount: it needs a real document, and the static export renders without one.
  const [scrambled, setScrambled] = useState(false);
  useEffect(() => setScrambled(pixelReadbackScrambled()), []);

  return (
    <>
      <Section
        title="AI pose analysis"
        aside={
          hasTrack ? (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
              {p.coverage!.detected}/{p.coverage!.total} frames
            </span>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2.5">
          {scrambled && (
            <div data-testid="scrambled-warning" role="alert" className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-200">
              <p className="font-semibold text-amber-100">This browser is scrambling image data, so the AI will get it wrong.</p>
              <p className="mt-1">
                Its anti-fingerprinting protection adds noise to the pixels the pose model reads back. That throws the skeleton off and
                makes frames and phases go undetected. Firefox Focus does this, and so does Firefox with strict tracking protection.
              </p>
              <p className="mt-1">
                Fix: turn off tracking protection for this site (the shield icon next to the address), then reload. Or open SwingLab in
                regular Chrome, Firefox or Safari.
              </p>
            </div>
          )}
          {busy ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-slate-300">
                  {p.analysis.status === "loading-model" ? "Loading pose model…" : `Analyzing frame ${p.analysis.done} / ${p.analysis.total}`}
                </span>
                <button type="button" onClick={p.onCancel} className="rounded px-1.5 py-0.5 font-semibold text-slate-400 hover:bg-slate-800 hover:text-rose-300">
                  Cancel
                </button>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-[width] ${p.analysis.status === "loading-model" ? "w-1/4 animate-pulse" : ""}`}
                  style={p.analysis.status === "running" ? { width: `${pct}%` } : undefined}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!p.hasVideo}
              onClick={p.onAnalyze}
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-3 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="4.5" r="2" />
                <path d="M12 7v6m0 0l-4 7m4-7l4 7M6 10l6-1 6 1" />
              </svg>
              {hasTrack ? "Re-analyze Swing (AI)" : "Analyze Swing (AI)"}
            </button>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Model</span>
            <Seg value={p.model} onChange={p.onModel} disabled={busy} options={[["lite", "Lite (fast)"], ["full", "Full (accurate)"]]} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Golfer</span>
            <Seg value={p.handed} onChange={p.onHanded} options={[["R", "Right-handed"], ["L", "Left-handed"]]} />
          </div>
          <label className="flex cursor-pointer items-center justify-between text-xs">
            <span className="text-slate-400">Show Skeleton Overlay</span>
            <span className="relative inline-flex">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={p.showSkeleton}
                onChange={(e) => p.onShowSkeleton(e.target.checked)}
              />
              <span className="h-5 w-9 rounded-full bg-slate-700 transition peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-400" />
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
            </span>
          </label>

          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-cyan-400" />Lead</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-[#39ff14]" />Trail</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-slate-100" />Torso / spine</span>
          </div>

          <button
            type="button"
            disabled={!hasTrack || busy}
            onClick={p.onAutoDetect}
            className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            title={hasTrack ? "Set A / T / I / F from wrist height" : "Analyze the swing first"}
          >
            Auto-Detect Phases
          </button>

          {p.phaseMessage && (
            <p className={`text-xs ${p.phaseMessage.ok ? "text-emerald-300" : "text-amber-300"}`}>{p.phaseMessage.text}</p>
          )}
          {p.analysis.message && (
            <p className={`text-xs ${p.analysis.status === "error" ? "text-rose-400" : "text-slate-500"}`}>{p.analysis.message}</p>
          )}
          {!hasTrack && !busy && !p.analysis.message && (
            <p className="text-xs text-slate-500">
              Runs MediaPipe in your browser. The video never leaves this device; only the model file is downloaded.
            </p>
          )}
        </div>
      </Section>

      <section className="border-b border-slate-800/80 px-5 py-4 last:border-b-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex rounded-lg bg-slate-800/80 p-0.5" role="tablist" aria-label="Metrics or coach tips">
            {([
              ["metrics", p.angle === "DTL" ? "Live metrics · DTL" : "Live metrics · FO"],
              ["coach", "Coach Tips"],
            ] as [Tab, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                data-testid={`tab-${k}`}
                onClick={() => setTab(k)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition pointer-coarse:py-2 ${
                  tab === k ? "bg-slate-200 text-slate-900" : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {label}
                {k === "coach" && p.coachCount > 0 && (
                  <span className={`rounded-full px-1.5 text-[10px] font-bold ${tab === k ? "bg-amber-500 text-slate-950" : "bg-amber-400/20 text-amber-300"}`}>
                    {p.coachCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          {tab === "metrics" && hasTrack && (
            <span className={`text-[10px] font-semibold ${p.poseVisible ? "text-emerald-400" : "text-amber-300"}`}>
              {p.poseVisible ? "● Pose" : "○ No pose"}
            </span>
          )}
        </div>
        {tab === "coach" ? (
          p.coach
        ) : !hasTrack ? (
          <p className="text-xs text-slate-500">Run Analyze Swing to see angle-specific metrics for every frame.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {p.metrics.map((m) => (
              <li key={m.key} className="rounded-lg bg-slate-900/60 px-3 py-2" title={m.hint}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-slate-400">{m.label}</span>
                  <span className={`font-mono text-sm font-semibold tabular-nums ${TONE[m.tone ?? "neutral"]}`}>{m.value ?? "—"}</span>
                </div>
                {m.sub && <div className="mt-0.5 text-right font-mono text-[11px] tabular-nums text-slate-500">{m.sub}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
