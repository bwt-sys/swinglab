/**
 * One-click annotated snapshot: composites the current video frame(s), the pose skeleton(s), the
 * telestrator drawings and a data bar onto an offscreen canvas, then downloads it as a PNG.
 * Everything happens in the browser; nothing is uploaded.
 */
import { drawPose } from "./drawPose";
import type { Handed } from "./metrics";
import type { PoseFrame } from "./pose";
import { renderScene } from "./render";
import type { CameraAngle, Shape } from "./types";

export interface SnapshotStat {
  label: string;
  value: string;
}

export interface SnapshotPanel {
  video: HTMLVideoElement;
  /** Compare mode heading ("Your Swing" / "Reference"). */
  title?: string;
  accent: string;
  flip: boolean;
  pose: PoseFrame | null;
  handed: Handed;
  showSkeleton: boolean;
  shapes: Shape[];
  /** Show the "° from vertical" pill on drawn lines (default true). */
  showLineTilt?: boolean;
  /** e.g. "Top (T)" or "Between Address and Top". */
  checkpoint: string;
  /** e.g. "0:01.23 · frame 37". */
  position: string;
  stats: SnapshotStat[];
}

export interface SnapshotOptions {
  angle: CameraAngle;
  filename?: string;
}

/** Logical height of each video panel; the output is rendered at SCALE× for crisp text. */
const PANEL_H = 720;
const SCALE = 2;
const GAP = 12;
const TITLE_H = 34;
const BAR_H = 112;
const PAD = 14;
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const BG = "#020617";

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Truncate `text` with an ellipsis so it fits in `max` px at the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  p: SnapshotPanel,
  x: number,
  y: number,
  w: number,
  /** Width of the actual video box (≤ w); centred in the panel so nothing is stretched. */
  vw: number,
  angle: CameraAngle,
  withTitle: boolean,
) {
  let top = y;
  const vx = x + (w - vw) / 2;

  // ── Title strip (compare mode) ──
  if (withTitle) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(x, top, w, TITLE_H);
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(x + PAD + 5, top + TITLE_H / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f1f5f9";
    ctx.font = `700 15px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText(fit(ctx, (p.title ?? "") + (p.flip ? "  (mirrored)" : ""), w - PAD * 2 - 16), x + PAD + 16, top + TITLE_H / 2 + 1);
    top += TITLE_H;
  }

  // ── Video frame + skeleton (mirrored together when flipped) ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, w, PANEL_H);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(x, top, w, PANEL_H);
  ctx.translate(vx, top);
  if (p.flip) {
    ctx.translate(vw, 0);
    ctx.scale(-1, 1);
  }
  const v = p.video;
  if (v.readyState >= 2 && v.videoWidth > 0) ctx.drawImage(v, 0, 0, vw, PANEL_H);
  if (p.showSkeleton) drawPose(ctx, p.pose, vw, PANEL_H, p.handed);
  ctx.restore();

  // ── Telestrator drawings (screen space: never mirrored, exactly like the live view) ──
  if (p.shapes.length) {
    const layer = document.createElement("canvas");
    layer.width = Math.round(vw * SCALE);
    layer.height = Math.round(PANEL_H * SCALE);
    const lctx = layer.getContext("2d");
    if (lctx) {
      lctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      renderScene(lctx, p.shapes, { width: vw, height: PANEL_H, draft: null, selectedId: null, hoverHandle: null, showHandles: false, showLineTilt: p.showLineTilt });
      ctx.drawImage(layer, vx, top, vw, PANEL_H);
    }
  }
  top += PANEL_H;

  // ── Data bar ──
  const grad = ctx.createLinearGradient(x, top, x, top + BAR_H);
  grad.addColorStop(0, "#0b1222");
  grad.addColorStop(1, "#050a18");
  ctx.fillStyle = grad;
  ctx.fillRect(x, top, w, BAR_H);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x, top, w, 2);

  // Row 1: angle badge · checkpoint · position
  let cx = x + PAD;
  const r1 = top + 24;
  ctx.textBaseline = "middle";
  ctx.font = `800 12px ${FONT}`;
  const badge = angle === "DTL" ? "DTL" : "FACE-ON";
  const bw = ctx.measureText(badge).width + 14;
  rounded(ctx, cx, r1 - 11, bw, 22, 6);
  ctx.fillStyle = angle === "DTL" ? "#34d399" : "#22d3ee";
  ctx.fill();
  ctx.fillStyle = BG;
  ctx.fillText(badge, cx + 7, r1 + 1);
  cx += bw + 10;

  ctx.font = `600 12px ${MONO}`;
  const posW = Math.min(ctx.measureText(p.position).width, w * 0.42);
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "right";
  ctx.fillText(fit(ctx, p.position, posW), x + w - PAD, r1 + 1);
  ctx.textAlign = "left";

  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(fit(ctx, p.checkpoint, x + w - PAD - posW - 12 - cx), cx, r1 + 1);

  // Rows 2–3: stat chips, wrapping
  const stats = p.stats.length ? p.stats : [{ label: "Metrics", value: "Analyze the swing to add numbers" }];
  let sx = x + PAD;
  let sy = top + 50;
  const chipH = 24;
  for (const s of stats) {
    ctx.font = `600 11px ${FONT}`;
    const lw = ctx.measureText(s.label).width;
    ctx.font = `700 13px ${MONO}`;
    const vw = ctx.measureText(s.value).width;
    let cw = lw + vw + 22;
    const maxW = w - PAD * 2;
    if (sx + cw > x + w - PAD && sx > x + PAD) {
      sx = x + PAD;
      sy += chipH + 6;
    }
    if (sy + chipH > top + BAR_H - 4) break; // out of room
    cw = Math.min(cw, maxW);
    rounded(ctx, sx, sy, cw, chipH, 7);
    ctx.fillStyle = "rgba(30, 41, 59, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(71, 85, 105, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(s.label, sx + 8, sy + chipH / 2 + 1);
    ctx.font = `700 13px ${MONO}`;
    ctx.fillStyle = "#f1f5f9";
    ctx.fillText(fit(ctx, s.value, cw - lw - 22), sx + 14 + lw, sy + chipH / 2 + 1);
    sx += cw + 6;
  }

  // Brand watermark
  ctx.font = `800 11px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(52, 211, 153, 0.55)";
  ctx.fillText("SwingLab", x + w - PAD, top + BAR_H - 12);
  ctx.textAlign = "left";
}

/** Build the PNG for the given panels (1 = single, 2 = compare). */
export async function renderSnapshot(panels: SnapshotPanel[], opts: SnapshotOptions): Promise<Blob> {
  if (!panels.length) throw new Error("Nothing to export");
  const withTitle = panels.length > 1;
  const videoW = panels.map((p) => {
    const a = p.video.videoWidth > 0 && p.video.videoHeight > 0 ? p.video.videoWidth / p.video.videoHeight : 16 / 9;
    return Math.round(PANEL_H * a);
  });
  // Keep very narrow vertical videos' panels wide enough for the data bar (video is centred, not stretched).
  const widths = videoW.map((vw) => Math.max(vw, 420));
  const W = widths.reduce((s, w) => s + w, 0) + GAP * (panels.length + 1);
  const H = GAP * 2 + (withTitle ? TITLE_H : 0) + PANEL_H + BAR_H;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  let x = GAP;
  panels.forEach((p, i) => {
    drawPanel(ctx, p, x, GAP, widths[i], videoW[i], opts.angle, withTitle);
    x += widths[i] + GAP;
  });

  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode PNG"))), "image/png");
    } catch (e) {
      // A cross-origin video without CORS would taint the canvas.
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportSnapshot(panels: SnapshotPanel[], opts: SnapshotOptions): Promise<void> {
  const blob = await renderSnapshot(panels, opts);
  downloadBlob(blob, opts.filename ?? "swinglab-analysis.png");
}
