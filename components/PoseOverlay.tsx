"use client";

import { useEffect, useRef } from "react";
import { drawPose } from "@/lib/drawPose";
import type { Handed } from "@/lib/metrics";
import type { PoseFrame } from "@/lib/pose";

interface Props {
  width: number;
  height: number;
  pose: PoseFrame | null;
  handed: Handed;
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
    drawPose(ctx, pose, width, height, handed);
  }, [width, height, pose, handed]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
