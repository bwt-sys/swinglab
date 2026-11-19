"use client";

import type { CameraAngle } from "@/lib/types";

const OPTIONS: { id: CameraAngle; label: string; short: string }[] = [
  { id: "DTL", label: "Down-the-Line", short: "DTL" },
  { id: "FO", label: "Face-On", short: "FO" },
];

export default function AngleToggle({ value, onChange }: { value: CameraAngle; onChange: (a: CameraAngle) => void }) {
  const idx = OPTIONS.findIndex((o) => o.id === value);
  return (
    <div
      role="radiogroup"
      aria-label="Camera angle"
      className="relative grid grid-cols-2 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-inner"
    >
      <span
        aria-hidden
        className="absolute bottom-1 top-1 w-[calc(50%_-_4px)] rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 shadow-lg shadow-emerald-500/20 transition-transform duration-300 ease-out"
        style={{ transform: `translateX(${idx * 100}%)`, left: 4 }}
      />
      {OPTIONS.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={`relative z-10 whitespace-nowrap px-4 py-2 text-sm font-semibold transition-colors sm:px-6 ${
              active ? "text-slate-950" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {o.label} <span className={active ? "text-slate-900/70" : "text-slate-500"}>({o.short})</span>
          </button>
        );
      })}
    </div>
  );
}
