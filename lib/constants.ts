import type { CheckpointKey, Tool } from "./types";

export const NEON_COLORS = [
  { name: "Neon Green", value: "#39ff14" },
  { name: "Cyan", value: "#22d3ee" },
  { name: "Yellow", value: "#facc15" },
  { name: "Red", value: "#ff3b5c" },
] as const;

export const PLAYBACK_RATES = [0.1, 0.25, 0.5, 1] as const;

export const CHECKPOINTS: { key: CheckpointKey; name: string; color: string }[] = [
  { key: "A", name: "Address", color: "#39ff14" },
  { key: "T", name: "Top of Backswing", color: "#22d3ee" },
  { key: "I", name: "Impact", color: "#ff3b5c" },
  { key: "F", name: "Finish", color: "#facc15" },
];

export const TOOLS: { id: Tool; label: string; shortcut: string; hint: string }[] = [
  { id: "move", label: "Move", shortcut: "1", hint: "Drag shapes or their handles. Click a shape, then press Delete to remove it." },
  { id: "line", label: "Line", shortcut: "2", hint: "Click and drag to draw a straight line." },
  { id: "circle", label: "Circle", shortcut: "3", hint: "Click the center and drag outward to set the radius." },
  { id: "angle", label: "Angle", shortcut: "4", hint: "Click 3 points: arm end, vertex, other arm end. Esc cancels." },
  { id: "pen", label: "Pen", shortcut: "5", hint: "Click and drag to draw freehand." },
];

export const SUPPORTED_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"];

export const SAMPLE_VIDEO_URL = "/sample-swing.mp4";
