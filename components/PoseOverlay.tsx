"use client";

import { useEffect, useRef } from "react";
import { MIN_VIS, sidesFor, type Handed } from "@/lib/metrics";
import { LM, type PoseFrame } from "@/lib/pose";

const LEAD = "#22d3ee";
const TRAIL = "#39ff14";
const TORSO = "#f8fafc";

interface Props {
  width: number;
  height: number;
  pose: PoseFrame | null;
  handed: Handed;
}

type Edge = [number, number, string];

function edgesFor(handed: Handed): Edge[] {
  const { lead, trail } = sidesFor(handed);
  // Hand/foot sub-landmarks for each body side.
  const hand = (s: "left" | "right") => (s === "left" ? [15, 17, 19, 21] : [16, 18, 20, 22]);
  const foot = (s: "left" | "right") => (s === "left" ? [27, 29, 31] : [28, 30, 32]);
  const leadName = lead.shoulder === LM.leftShoulder ? "left" : "right";
  const trailName = leadName === "left" ? "right" : "left";

  const limb = (side: typeof lead, name: "left" | "right", color: string): Edge[] => {
    const [w, pinky, index, thumb] = hand(name);
    const [ankle, heel, toe] = foot(name);
    return [
      [side.shoulder, side.elbow, color],
      [side.elbow, side.wrist, color],
      [w, pinky, color],
      [w, index, color],
      [w, thumb, color],
      [pinky, index, color],
      [side.hip, side.knee, color],
      [side.knee, side.ankle, color],
      [ankle, heel, color],
      [heel, toe, color],
      [ankle, toe, color],
    ];
  };

  return [
    ...limb(lead, leadName, LEAD),
    ...limb(trail, trailName, TRAIL),
    [LM.leftShoulder, LM.rightShoulder, TORSO],
    [LM.leftHip, LM.rightHip, TORSO],
    [LM.leftShoulder, LM.leftHip, TORSO],
    [LM.rightShoulder, LM.rightHip, TORSO],
  ];
}

/** Read-only skeleton layer. Sits between the video and the telestrator; never takes pointer input. */
export default function PoseOverlay({ width, height, pose, handed }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(width * dpr);
    const bh = Math.round(height * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!pose) return;

    const lm = pose.lm;
    const P = (i: number) => {
      const l = lm[i];
      return l && Number.isFinite(l.x) && Number.isFinite(l.y) ? { x: l.x * width, y: l.y * height, v: l.v } : null;
    };
    const scale = Math.max(0.7, Math.min(1.6, Math.min(width, height) / 400));

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Bones
    for (const [a, b, color] of edgesFor(handed)) {
      const p = P(a);
      const q = P(b);
      if (!p || !q) continue;
      const v = Math.min(p.v, q.v);
      if (v < MIN_VIS * 0.5) continue;
      ctx.globalAlpha = v < MIN_VIS ? 0.3 : 0.95; // Occluded/uncertain bones fade out.
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Spine: hip midpoint → shoulder midpoint (dashed white).
    const ls = P(LM.leftShoulder), rs = P(LM.rightShoulder), lh = P(LM.leftHip), rh = P(LM.rightHip);
    if (ls && rs && lh && rh && Math.min(ls.v, rs.v, lh.v, rh.v) >= MIN_VIS * 0.5) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = TORSO;
      ctx.lineWidth = 2 * scale;
      ctx.setLineDash([6 * scale, 5 * scale]);
      ctx.beginPath();
      ctx.moveTo((lh.x + rh.x) / 2, (lh.y + rh.y) / 2);
      ctx.lineTo((ls.x + rs.x) / 2, (ls.y + rs.y) / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Joints (body only — skip face mesh points except nose).
    const { lead } = sidesFor(handed);
    const leadIdx = new Set(lead.shoulder === LM.leftShoulder ? [11, 13, 15, 23, 25, 27] : [12, 14, 16, 24, 26, 28]);
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = P(i);
      if (!p || p.v < MIN_VIS) continue;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (i === 0 ? 4 : 3.2) * scale, 0, Math.PI * 2);
      ctx.fillStyle = "#020617";
      ctx.fill();
      ctx.lineWidth = 1.6 * scale;
      ctx.strokeStyle = i === 0 ? TORSO : leadIdx.has(i) ? LEAD : TRAIL;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [width, height, pose, handed]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
