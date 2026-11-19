import type { CameraAngle, Point, ShapeKind } from "./types";

export interface PresetDef {
  id: string;
  angle: CameraAngle;
  name: string;
  description: string;
  kind: ShapeKind;
  color: string;
  /** Default placement in normalized video coordinates (tuned for a right-handed golfer centred in frame). */
  points: Point[];
}

export const PRESETS: PresetDef[] = [
  // ── Down-the-Line ──────────────────────────────────────────────
  {
    id: "dtl-spine",
    angle: "DTL",
    name: "Address Spine Line",
    description: "Tailbone to base of neck at address. Watch for early extension or standing up.",
    kind: "line",
    color: "#39ff14",
    points: [
      { x: 0.42, y: 0.58 },
      { x: 0.56, y: 0.32 },
    ],
  },
  {
    id: "dtl-shaft-plane",
    angle: "DTL",
    name: "Shaft Plane Line",
    description: "Ball through the hands along the shaft at address. Checks the club's plane in the backswing and downswing.",
    kind: "line",
    color: "#22d3ee",
    points: [
      { x: 0.74, y: 0.93 },
      { x: 0.26, y: 0.2 },
    ],
  },
  {
    id: "dtl-hip-wall",
    angle: "DTL",
    name: "Butt/Hip Wall Line",
    description: "Vertical line touching the trail glute at address. Hips moving off it toward the ball signals early extension.",
    kind: "line",
    color: "#facc15",
    points: [
      { x: 0.37, y: 0.38 },
      { x: 0.37, y: 0.92 },
    ],
  },
  // ── Face-On ────────────────────────────────────────────────────
  {
    id: "fo-head",
    angle: "FO",
    name: "Head Stability Circle",
    description: "Circle around the head at address. Tracks lateral and vertical head movement.",
    kind: "circle",
    color: "#22d3ee",
    points: [
      { x: 0.5, y: 0.22 },
      { x: 0.565, y: 0.22 },
    ],
  },
  {
    id: "fo-lead-hip",
    angle: "FO",
    name: "Lead Hip Sway Line",
    description: "Vertical line on the outside of the lead hip. Checks for hip slide past it in the downswing.",
    kind: "line",
    color: "#39ff14",
    points: [
      { x: 0.585, y: 0.4 },
      { x: 0.585, y: 0.78 },
    ],
  },
  {
    id: "fo-trail-hip",
    angle: "FO",
    name: "Trail Hip Box",
    description: "Box around the trail hip at address. Hip moving outside it in the backswing indicates sway.",
    kind: "rect",
    color: "#ff3b5c",
    points: [
      { x: 0.37, y: 0.44 },
      { x: 0.47, y: 0.62 },
    ],
  },
];

export function presetsFor(angle: CameraAngle): PresetDef[] {
  return PRESETS.filter((p) => p.angle === angle);
}
