"use client";

import type { KeyNumbers } from "@/lib/metrics";
import type { Bookmarks, CameraAngle } from "@/lib/types";
import Section from "./Section";

export type SideKey = "L" | "R";

interface SideInfo {
  numbers: KeyNumbers | null;
  bookmarks: Bookmarks;
  analyzed: boolean;
  hasVideo: boolean;
}

interface Props {
  angle: CameraAngle;
  you: SideInfo;
  pro: SideInfo;
  active: SideKey;
  onActive: (s: SideKey) => void;
}

type Kind = "deg" | "in" | "tempo";

interface Row {
  key: string;
  label: string;
  note?: string;
  you: number | null;
  pro: number | null;
  kind: Kind;
  /** |You − Pro| above this is highlighted. */
  threshold: number;
}

export function tempoOf(b: Bookmarks): number | null {
  const { A, T, I } = b;
  if (A === undefined || T === undefined || I === undefined || T <= A || I <= T) return null;
  return (T - A) / (I - T);
}

const sgn = (n: number, d = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;

function fmt(v: number | null, kind: Kind, signed = false): string {
  if (v === null || !Number.isFinite(v)) return "—";
  switch (kind) {
    case "deg":
      return `${signed ? sgn(v) : v.toFixed(1)}°`;
    case "in":
      return `${sgn(v)}″`;
    case "tempo":
      return signed ? sgn(v) : `${v.toFixed(1)}:1`;
  }
}

function rowsFor(angle: CameraAngle, y: KeyNumbers | null, p: KeyNumbers | null, ty: number | null, tp: number | null): Row[] {
  const g = (n: KeyNumbers | null, k: keyof KeyNumbers) => (n ? n[k] : null);
  const tempo: Row = { key: "tempo", label: "Tempo ratio", note: "backswing : downswing", you: ty, pro: tp, kind: "tempo", threshold: 0.5 };
  if (angle === "DTL") {
    return [
      { key: "spNow", label: "Spine angle", note: "current frame", you: g(y, "spineNow"), pro: g(p, "spineNow"), kind: "deg", threshold: 5 },
      { key: "spA", label: "Spine angle @ A", you: g(y, "spineA"), pro: g(p, "spineA"), kind: "deg", threshold: 5 },
      { key: "spI", label: "Spine angle @ I", you: g(y, "spineI"), pro: g(p, "spineI"), kind: "deg", threshold: 5 },
      { key: "spLoss", label: "Spine change A→I", note: "− = standing up (early extension)", you: g(y, "spineLossI"), pro: g(p, "spineLossI"), kind: "deg", threshold: 5 },
      { key: "armT", label: "Lead arm plane @ T", note: "° above horizontal", you: g(y, "armT"), pro: g(p, "armT"), kind: "deg", threshold: 5 },
      tempo,
    ];
  }
  return [
    { key: "hdNow", label: "Head sway", note: "current frame · + = toward target", you: g(y, "headNow"), pro: g(p, "headNow"), kind: "in", threshold: 2 },
    { key: "hdT", label: "Head sway @ T", you: g(y, "headT"), pro: g(p, "headT"), kind: "in", threshold: 2 },
    { key: "hdI", label: "Head sway @ I", you: g(y, "headI"), pro: g(p, "headI"), kind: "in", threshold: 2 },
    { key: "hipT", label: "Lateral hip shift @ T", note: "− = sway away from target", you: g(y, "hipT"), pro: g(p, "hipT"), kind: "in", threshold: 2 },
    { key: "hipI", label: "Lateral hip shift @ I", you: g(y, "hipI"), pro: g(p, "hipI"), kind: "in", threshold: 2 },
    { key: "tiltI", label: "Shoulder tilt @ I", note: "+ = lead shoulder lower", you: g(y, "tiltI"), pro: g(p, "tiltI"), kind: "deg", threshold: 5 },
    tempo,
  ];
}

export default function ComparePanel(p: Props) {
  const both = p.you.analyzed && p.pro.analyzed;
  const rows = rowsFor(p.angle, p.you.numbers, p.pro.numbers, tempoOf(p.you.bookmarks), tempoOf(p.pro.bookmarks));
  const flagged = rows.filter((r) => r.you !== null && r.pro !== null && Math.abs(r.you - r.pro) > r.threshold).length;

  return (
    <Section
      title={`You vs Pro · ${p.angle === "DTL" ? "DTL" : "Face-on"}`}
      aside={
        both && flagged > 0 ? (
          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
            {flagged} notable
          </span>
        ) : undefined
      }
    >
      {/* Which side the sidebar, toolbar and keyboard act on */}
      <div className="mb-3 flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-400">Editing</span>
        <div className="flex rounded-lg bg-slate-800/80 p-0.5" role="group" aria-label="Active video">
          {([
            ["L", "Your Swing"],
            ["R", "Reference"],
          ] as [SideKey, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => p.onActive(k)}
              aria-pressed={p.active === k}
              className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition ${
                p.active === k ? (k === "L" ? "bg-emerald-400 text-slate-950" : "bg-cyan-400 text-slate-950") : "text-slate-400 hover:text-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!both ? (
        <p className="text-xs text-slate-500">
          Run <span className="text-slate-300">Analyze Swing (AI)</span> on both videos (switch &ldquo;Editing&rdquo; to pick a side), then
          tag or auto-detect A / T / I on each to see a side-by-side comparison.
          <span className="mt-1 block">
            Analyzed: You {p.you.analyzed ? "✓" : "—"} · Pro {p.pro.analyzed ? "✓" : "—"}
          </span>
        </p>
      ) : (
        <>
          <table className="w-full table-fixed text-xs" data-testid="compare-table">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                <th className="w-[44%] pb-1 text-left font-semibold">Metric</th>
                <th className="pb-1 text-right font-semibold text-emerald-400/80">You</th>
                <th className="pb-1 text-right font-semibold text-cyan-400/80">Pro</th>
                <th className="pb-1 text-right font-semibold">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = r.you !== null && r.pro !== null ? r.you - r.pro : null;
                const hot = d !== null && Math.abs(d) > r.threshold;
                return (
                  <tr
                    key={r.key}
                    className={`border-t border-slate-800/80 ${hot ? "bg-amber-400/10" : ""}`}
                    title={hot ? `Notable difference (more than ${r.threshold}${r.kind === "deg" ? "°" : r.kind === "in" ? "″" : ""})` : undefined}
                  >
                    <td className="py-1.5 pr-1 align-top">
                      <span className={`block leading-tight ${hot ? "text-amber-200" : "text-slate-300"}`}>{r.label}</span>
                      {r.note && <span className="block text-[10px] leading-tight text-slate-500">{r.note}</span>}
                    </td>
                    <td className="py-1.5 text-right align-top font-mono tabular-nums text-slate-100">{fmt(r.you, r.kind)}</td>
                    <td className="py-1.5 text-right align-top font-mono tabular-nums text-slate-100">{fmt(r.pro, r.kind)}</td>
                    <td className={`py-1.5 text-right align-top font-mono font-semibold tabular-nums ${hot ? "text-amber-300" : "text-slate-500"}`}>
                      {d === null ? "—" : fmt(d, r.kind, true)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] leading-snug text-slate-500">
            Highlighted: differs by more than 5°, 2″ or 0.5 tempo. &ldquo;@ A/T/I&rdquo; values use each video&rsquo;s own
            checkpoints. Inches are scaled by each golfer&rsquo;s own shoulder width, so camera distance doesn&rsquo;t matter.
          </p>
        </>
      )}
    </Section>
  );
}
