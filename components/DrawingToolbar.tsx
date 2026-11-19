"use client";

import { NEON_COLORS, TOOLS } from "@/lib/constants";
import type { Tool } from "@/lib/types";

const ICONS: Record<Tool, React.ReactNode> = {
  move: <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />,
  line: <path d="M4 20L20 4" />,
  circle: <circle cx="12" cy="12" r="8" />,
  angle: <path d="M4 20h16M4 20L16 5M9.5 20a6 6 0 00-2.2-4.7" />,
  pen: <path d="M3 21c3-1 4-3 6-6s4-7 8-9 4 1 2 3-6 5-9 7-4 3-7 5z" />,
};

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  color: string;
  onColor: (c: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  onClear: () => void;
  hasShapes: boolean;
}

export default function DrawingToolbar(p: Props) {
  const hint = TOOLS.find((t) => t.id === p.tool)?.hint;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
      <div className="flex items-center gap-1" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map((t) => {
          const active = p.tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => p.onTool(t.id)}
              title={`${t.label} (${t.shortcut})`}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[t.id]}
              </svg>
              <span className="hidden md:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="h-6 w-px bg-slate-700" />

      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Color">
        {NEON_COLORS.map((c) => {
          const active = p.color === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={c.name}
              aria-label={c.name}
              onClick={() => p.onColor(c.value)}
              className={`h-6 w-6 rounded-full transition ${active ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-slate-900" : "opacity-70 hover:opacity-100"}`}
              style={{ background: c.value, boxShadow: active ? `0 0 12px ${c.value}` : undefined }}
            />
          );
        })}
      </div>

      <div className="h-6 w-px bg-slate-700" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={p.onUndo}
          disabled={!p.canUndo}
          title="Undo (Ctrl/Cmd+Z)"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
          </svg>
          <span className="hidden md:inline">Undo</span>
        </button>
        <button
          type="button"
          onClick={p.onClear}
          disabled={!p.hasShapes}
          title="Clear all drawings"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-950/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
          <span className="hidden md:inline">Clear All</span>
        </button>
      </div>

      {hint && <p className="ml-auto hidden text-xs text-slate-500 lg:block">{hint}</p>}
    </div>
  );
}
