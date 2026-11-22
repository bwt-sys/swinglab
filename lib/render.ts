import { angleAt, tiltFromVertical, toPx } from "./geometry";
import type { Point, Shape } from "./types";

export interface RenderOptions {
  /** CSS pixel size of the canvas (equals the displayed video size). */
  width: number;
  height: number;
  draft: Shape | null;
  selectedId: string | null;
  /** Show the "° from vertical" pill on drawn lines (default true). */
  showLineTilt?: boolean;
}

/** Hit radius (CSS px) for grabbing a shape's endpoint with a finger. */
export const TOUCH_GRIP_RADIUS = 20;

const FONT = "600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, w: number, h: number) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.font = FONT;
  const tw = ctx.measureText(text).width;
  const bw = tw + 12;
  const bh = 20;
  // Keep labels inside the frame.
  const bx = Math.max(4, Math.min(w - bw - 4, x - bw / 2));
  const by = Math.max(4, Math.min(h - bh - 4, y - bh / 2));
  ctx.fillStyle = "rgba(2, 6, 23, 0.82)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + 6, by + bh / 2 + 0.5);
  ctx.restore();
}

function strokeShape(ctx: CanvasRenderingContext2D, s: Shape, w: number, h: number) {
  const pts = s.points.map((p) => toPx(p, w, h));
  ctx.beginPath();
  switch (s.kind) {
    case "line":
    case "angle":
    case "pen": {
      if (pts.length === 0) return;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
      break;
    }
    case "circle": {
      const r = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      ctx.arc(pts[0].x, pts[0].y, Math.max(1, r), 0, Math.PI * 2);
      break;
    }
    case "rect": {
      const x = Math.min(pts[0].x, pts[1].x);
      const y = Math.min(pts[0].y, pts[1].y);
      ctx.rect(x, y, Math.abs(pts[1].x - pts[0].x), Math.abs(pts[1].y - pts[0].y));
      break;
    }
  }
  ctx.stroke();
}

function drawLabels(ctx: CanvasRenderingContext2D, s: Shape, w: number, h: number, showTilt: boolean) {
  const pts = s.points.map((p) => toPx(p, w, h));
  if (s.kind === "angle" && s.points.length === 3) {
    const deg = angleAt(s.points[0], s.points[1], s.points[2], w, h);
    const [a, b, c] = pts;
    // Draw a small arc at the vertex.
    const a1 = Math.atan2(a.y - b.y, a.x - b.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let diff = a2 - a1;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const arcR = Math.min(28, Math.hypot(a.x - b.x, a.y - b.y) * 0.4, Math.hypot(c.x - b.x, c.y - b.y) * 0.4);
    if (arcR > 4) {
      ctx.save();
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(b.x, b.y, arcR, a1, a1 + diff, diff < 0);
      ctx.stroke();
      ctx.restore();
    }
    // Label along the bisector, outside the arc.
    const mid = a1 + diff / 2;
    const off = arcR + 22;
    pill(ctx, `${deg.toFixed(1)}°`, b.x + Math.cos(mid) * off, b.y + Math.sin(mid) * off, s.color, w, h);
    return;
  }
  if (s.kind === "line" && s.points.length === 2) {
    const tilt = tiltFromVertical(s.points[0], s.points[1], w, h).toFixed(1);
    const text = showTilt ? (s.label ? `${s.label} · ${tilt}°` : `${tilt}° from vertical`) : s.label;
    if (!text) return;
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    pill(ctx, text, mx + 14, my - 18, s.color, w, h);
    return;
  }
  if (s.label && (s.kind === "circle" || s.kind === "rect")) {
    if (s.kind === "circle") {
      const r = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pill(ctx, s.label, pts[0].x, pts[0].y - r - 16, s.color, w, h);
    } else {
      const x = (pts[0].x + pts[1].x) / 2;
      const y = Math.min(pts[0].y, pts[1].y) - 16;
      pill(ctx, s.label, x, y, s.color, w, h);
    }
  }
}

export function renderScene(ctx: CanvasRenderingContext2D, shapes: Shape[], opts: RenderOptions) {
  const { width: w, height: h } = opts;
  ctx.clearRect(0, 0, w, h);
  const all = opts.draft ? [...shapes, opts.draft] : shapes;

  for (const s of all) {
    const selected = s.id === opts.selectedId;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.shadowColor = s.color;

    // Selection halo
    if (selected) {
      ctx.save();
      ctx.lineWidth = 9;
      ctx.globalAlpha = 0.25;
      ctx.shadowBlur = 0;
      strokeShape(ctx, s, w, h);
      ctx.restore();
    }

    ctx.shadowBlur = 10;
    ctx.lineWidth = s.kind === "pen" ? 3 : 2.5;
    if (s.presetId && s.kind === "line") ctx.setLineDash([10, 6]);
    strokeShape(ctx, s, w, h);
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // Reference presets stay clean: just the guide line/shape, no measurement pill.
    if (!s.presetId) drawLabels(ctx, s, w, h, opts.showLineTilt ?? true);
    ctx.restore();
  }
}

/** Remove points closer than `minPx` to the previous point, keeping freehand paths light. */
export function simplifyPath(points: Point[], w: number, h: number, minPx = 2): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot((points[i].x - prev.x) * w, (points[i].y - prev.y) * h) >= minPx) out.push(points[i]);
  }
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
