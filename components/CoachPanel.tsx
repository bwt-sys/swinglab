"use client";

import type { CoachResult, Severity } from "@/lib/coach";
import type { CheckpointKey } from "@/lib/types";

interface Props {
  result: CoachResult;
  /** Compare mode with an analyzed reference. */
  comparing: boolean;
  onShow?: (k: CheckpointKey) => void;
}

const SEV: Record<Severity, { label: string; cls: string; bar: string }> = {
  high: { label: "Priority", cls: "bg-rose-500/15 text-rose-300 ring-rose-500/30", bar: "bg-rose-400" },
  medium: { label: "Moderate", cls: "bg-amber-400/15 text-amber-300 ring-amber-400/30", bar: "bg-amber-300" },
  low: { label: "Minor", cls: "bg-sky-400/15 text-sky-300 ring-sky-400/30", bar: "bg-sky-300" },
};

const CP_NAME: Record<CheckpointKey, string> = { A: "Address", T: "Top", I: "Impact", F: "Finish" };

export default function CoachPanel({ result, comparing, onShow }: Props) {
  const { tips, passed, missing } = result;

  return (
    <div className="flex flex-col gap-3" data-testid="coach-panel">
      <p className="text-[11px] leading-snug text-slate-500">
        {comparing
          ? "Rule-based tips for Your Swing, checked against fixed limits and against the reference golfer."
          : "Rule-based tips for your swing, checked against fixed biomechanical limits."}
      </p>

      {tips.length === 0 && passed.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          <p className="font-semibold">No faults flagged on the checks that could run.</p>
          <p className="mt-1 text-emerald-200/70">
            {missing.length ? "More checks unlock below." : "Film the other camera angle (DTL / Face-on) for the remaining checks."}
          </p>
        </div>
      )}

      {tips.map((t, i) => {
        const s = SEV[t.severity];
        return (
          <article key={t.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60" data-testid={`coach-tip-${t.id}`}>
            <div className={`h-0.5 ${s.bar}`} />
            <div className="p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold leading-tight text-slate-100">{t.title}</h3>
                  <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${s.cls}`}>
                    {s.label}
                  </span>
                </div>
                {t.checkpoint && onShow && (
                  <button
                    type="button"
                    onClick={() => onShow(t.checkpoint!)}
                    title={`Jump to ${CP_NAME[t.checkpoint]}`}
                    className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:border-slate-500 hover:bg-slate-800 pointer-coarse:py-2"
                  >
                    Show {t.checkpoint}
                  </button>
                )}
              </div>

              <p className="mt-2 text-xs leading-relaxed text-slate-300">{t.observation}</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{t.why}</p>

              <table className="mt-2 w-full text-[11px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="text-left font-semibold" />
                    <th className="text-right font-semibold text-emerald-400/80">You</th>
                    {comparing && <th className="text-right font-semibold text-cyan-400/80">Pro</th>}
                    <th className="text-right font-semibold">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {t.evidence.map((e) => (
                    <tr key={e.label} className="border-t border-slate-800/70">
                      <td className="py-1 pr-1 text-slate-400">{e.label}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-slate-100">{e.you}</td>
                      {comparing && <td className="py-1 text-right font-mono tabular-nums text-slate-300">{e.pro ?? "—"}</td>}
                      <td className="py-1 pl-1 text-right text-slate-500">{e.target ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-2.5 flex flex-col gap-1.5">
                {t.drills.map((d, di) => (
                  <details key={d.name} className="group rounded-lg bg-slate-950/60 ring-1 ring-slate-800" open={i === 0 && di === 0}>
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs font-semibold text-cyan-200 pointer-coarse:py-3 [&::-webkit-details-marker]:hidden">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 transition group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                      <span className="flex-1">Drill: {d.name}</span>
                    </summary>
                    <div className="px-2.5 pb-2.5 text-[11px] leading-relaxed text-slate-400">
                      <p className="text-slate-300">{d.goal}</p>
                      <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                        {d.steps.map((st) => (
                          <li key={st}>{st}</li>
                        ))}
                      </ol>
                      <p className="mt-1.5 text-slate-500">
                        <span className="font-semibold text-slate-400">Reps:</span> {d.dose}
                      </p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </article>
        );
      })}

      {passed.length > 0 && (
        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Looks good</h3>
          <ul className="flex flex-col gap-1 text-[11px] text-slate-400">
            {passed.map((s) => (
              <li key={s} className="flex gap-1.5">
                <span className="text-emerald-400">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">To unlock more checks</h3>
          <ul className="flex flex-col gap-1 text-[11px] text-slate-500">
            {missing.map((s) => (
              <li key={s} className="flex gap-1.5">
                <span>•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] leading-snug text-slate-600">
        Estimates from 2D pose tracking on a single camera. Use them as a starting point, not a diagnosis.
      </p>
    </div>
  );
}
