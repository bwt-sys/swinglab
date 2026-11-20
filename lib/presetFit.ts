/**
 * Snap reference presets to the golfer's body using the pose at Address (or the current frame).
 * All geometry is done in video pixels so vertical phone video isn't distorted, then converted back
 * to normalized 0..1 coordinates. Returns null when the needed landmarks aren't visible, in which
 * case the caller keeps the preset's default placement.
 */
import { ballDir, MIN_VIS, sidesFor, targetDir, type Handed } from "./metrics";
import { LM, type PoseFrame, type Raster } from "./pose";
import type { PresetDef } from "./presets";
import type { Point } from "./types";

interface Px {
  x: number;
  y: number;
}

/** Liang–Barsky: the part of segment a→b inside [0,W]×[0,H], or null if none. */
function clipToFrame(a: Px, b: Px, W: number, H: number): [Px, Px] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x], [dx, W - a.x], [-dy, a.y], [dy, H - a.y]] as [number, number][]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

const HEEL = { left: 29, right: 30 };
const TOE = { left: 31, right: 32 };

/** Back of the butt sits this far (× torso length) behind MediaPipe's hip point, horizontally. Measured 0.29–0.37 on real address photos. */
const BUTT_BEHIND_HIP = 0.33;
/** Apparent shaft angle from horizontal when the club can't be found (real DTL address photos: 48–52°). */
const DEFAULT_SHAFT_DEG = 47;

/** Optional single-frame extras: body outline and pixels (see scanFrame in pose.ts). */
export interface FitScan {
  mask: Raster<Float32Array> | null;
  lum: Raster<Uint8ClampedArray> | null;
}

function maskInside(m: Raster<Float32Array>, W: number, H: number, x: number, y: number): boolean {
  const mx = Math.round((x / W) * m.w);
  const my = Math.round((y / H) * m.h);
  return mx >= 0 && my >= 0 && mx < m.w && my < m.h && m.data[my * m.w + mx] > 0.5;
}

/** Most-posterior body pixel per row, scanning from well behind the golfer toward the ball. */
function backEdge(m: Raster<Float32Array>, W: number, H: number, hip: Px, torso: number, dir: number, y0: number, y1: number): Px[] {
  const pts: Px[] = [];
  const step = Math.max(1, (H / m.h) * 1.5);
  const xStep = Math.max(1, W / m.w);
  for (let y = y0; y <= y1; y += step) {
    let x = hip.x - dir * 1.5 * torso;
    for (let k = 0; k < (3 * torso) / xStep; k++, x += dir * xStep) {
      if (maskInside(m, W, H, x, y)) {
        pts.push({ x, y });
        break;
      }
    }
  }
  return pts;
}

/**
 * Line along the back: the support line touching the butt and the upper back, with the whole torso
 * on the ball side of it. Returns [lower point, upper point] or null if the outline is unusable.
 */
function backTangent(m: Raster<Float32Array>, W: number, H: number, hip: Px, sh: Px, torso: number, dir: number): [Px, Px] | null {
  const pts = backEdge(m, W, H, hip, torso, dir, sh.y - 0.1 * torso, hip.y + 0.15 * torso);
  const lower = pts.filter((p) => p.y >= hip.y - 0.25 * torso);
  const upper = pts.filter((p) => p.y <= hip.y - 0.5 * torso);
  if (lower.length < 3 || upper.length < 3) return null;
  // Sanity: the outline should start behind the hip point, not on the far side of the body.
  let butt = lower.reduce((a, b) => ((b.x - a.x) * dir < 0 ? b : a));
  if ((hip.x - butt.x) * dir < 0.05 * torso || (hip.x - butt.x) * dir > 0.9 * torso) return null;
  let up = upper[0];
  for (let it = 0; it < 3; it++) {
    up = upper.reduce((best, p) => (((butt.x - p.x) * dir) / (butt.y - p.y) > ((butt.x - best.x) * dir) / (butt.y - best.y) ? p : best));
    butt = lower.reduce((best, p) => (((p.x - up.x) * dir) / (p.y - up.y) < ((best.x - up.x) * dir) / (best.y - up.y) ? p : best));
  }
  return [butt, up];
}

/** x of the most-posterior point of the butt (for the hip wall line). */
function buttX(m: Raster<Float32Array>, W: number, H: number, hip: Px, torso: number, dir: number): number | null {
  const pts = backEdge(m, W, H, hip, torso, dir, hip.y - 0.25 * torso, hip.y + 0.2 * torso);
  if (!pts.length) return null;
  return pts.reduce((a, b) => ((b.x - a.x) * dir < 0 ? b : a)).x;
}

/**
 * Find the club shaft at address: the angle (degrees below horizontal, toward the ball) of the
 * straightest thin line running from the hands down to ground level. Returns null when nothing
 * stands out clearly from the background.
 */
function findShaftAngle(lum: Raster<Uint8ClampedArray>, W: number, H: number, hands: Px, groundY: number, dir: number): number | null {
  const sx = lum.w / W;
  const sy = lum.h / H;
  const at = (x: number, y: number): number | null => {
    const mx = Math.round(x * sx);
    const my = Math.round(y * sy);
    return mx < 0 || my < 0 || mx >= lum.w || my >= lum.h ? null : lum.data[my * lum.w + mx];
  };
  const side = 5 / Math.min(sx, sy); // ~5 px in the scanned image, either side of the line
  const stepPx = 2 / Math.min(sx, sy);
  const scores: { deg: number; s: number }[] = [];
  for (let deg = 20; deg <= 75; deg += 0.5) {
    const a = (deg * Math.PI) / 180;
    const ux = dir * Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = (groundY - hands.y) / uy;
    let sum = 0;
    let n = 0;
    for (let s = 0.15 * L; s <= 0.95 * L; s += stepPx) {
      const x = hands.x + ux * s;
      const y = hands.y + uy * s;
      const c = at(x, y);
      const l1 = at(x + nx * side, y + ny * side);
      const l2 = at(x - nx * side, y - ny * side);
      if (c === null || l1 === null || l2 === null) continue;
      // A thin line differs from BOTH sides (dark or bright shaft against grass, mat or carpet).
      sum += Math.min(Math.abs(c - l1), Math.abs(c - l2));
      n++;
    }
    if (n > 10) scores.push({ deg, s: sum / n });
  }
  if (scores.length < 20) return null;
  const sorted = [...scores].sort((a, b) => a.s - b.s);
  const median = sorted[Math.floor(sorted.length / 2)].s;
  const best = sorted[sorted.length - 1];
  // Must clearly beat the background (real photos: 2–5× the median).
  return best.s >= 12 && best.s >= median * 1.8 ? best.deg : null;
}

export function fitPreset(def: PresetDef, pose: PoseFrame | null, W: number, H: number, handed: Handed, scan?: FitScan): Point[] | null {
  if (!pose || W <= 0 || H <= 0) return null;
  const lm = pose.lm;
  // Slightly more lenient than the metrics threshold: a rough fit beats the generic default.
  const P = (i: number): Px | null => {
    const l = lm[i];
    return l && Number.isFinite(l.x) && Number.isFinite(l.y) && l.v >= MIN_VIS * 0.6 ? { x: l.x * W, y: l.y * H } : null;
  };
  const mid = (a: number, b: number): Px | null => {
    const p = P(a);
    const q = P(b);
    if (p && q) return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    return p ?? q;
  };
  const norm = (p: Px): Point => ({ x: Math.min(1, Math.max(0, p.x / W)), y: Math.min(1, Math.max(0, p.y / H)) });
  const lerp = (a: Px, b: Px, t: number): Px => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  const sides = sidesFor(handed);
  const hip = mid(LM.leftHip, LM.rightHip);
  const sh = mid(LM.leftShoulder, LM.rightShoulder);
  const torso = hip && sh ? Math.hypot(sh.x - hip.x, sh.y - hip.y) : null;
  // Ground: lowest visible foot point.
  const feet = [HEEL.left, HEEL.right, TOE.left, TOE.right, LM.leftAnkle, LM.rightAnkle].map(P).filter((p): p is Px => !!p);
  const groundY = feet.length ? Math.max(...feet.map((p) => p.y)) : null;

  switch (def.id) {
    // ── Down-the-Line ──
    case "dtl-spine": {
      // Coaching spine line: along the BACK, touching the butt and the upper back. MediaPipe's hip
      // points sit inside the pelvis, so a hip→shoulder line runs through the body, not along the spine.
      const dir = ballDir(pose, W, H);
      if (!hip || !sh || !torso || dir === null) return null;
      const traced = scan?.mask ? backTangent(scan.mask, W, H, hip, sh, torso, dir) : null;
      let a: Px;
      let b: Px;
      if (traced) {
        [a, b] = traced;
      } else {
        // No outline: the back runs roughly parallel to the joint line, ~1/3 torso behind the hip point
        // (measured on real address photos).
        const off = { x: -dir * torso * BUTT_BEHIND_HIP, y: 0 };
        a = { x: hip.x + off.x, y: hip.y + off.y };
        b = { x: sh.x + off.x, y: sh.y + off.y };
      }
      // Extend from just below the butt to above the shoulders (base of the neck).
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const lo = { x: a.x - ux * torso * 0.15, y: a.y - uy * torso * 0.15 };
      // Top end level with the shoulder joints, a little past them.
      const tTop = uy !== 0 ? (sh.y - torso * 0.1 - a.y) / uy : len;
      const hi = { x: a.x + ux * tTop, y: a.y + uy * tTop };
      const seg = clipToFrame(lo, hi, W, H);
      return seg ? [norm(seg[0]), norm(seg[1])] : null;
    }
    case "dtl-shaft-plane": {
      // Ball → hands along the actual club shaft, found in the frame's pixels when possible.
      const hands = mid(LM.leftWrist, LM.rightWrist);
      const dir = ballDir(pose, W, H);
      if (!hands || dir === null || groundY === null || groundY <= hands.y) return null;
      const deg = (scan?.lum && findShaftAngle(scan.lum, W, H, hands, groundY, dir)) ?? DEFAULT_SHAFT_DEG;
      const a = (deg * Math.PI) / 180;
      const ux = dir * Math.cos(a);
      const uy = Math.sin(a);
      const down = (groundY - hands.y) / uy; // hands → ground along the shaft
      const ball = { x: hands.x + ux * down, y: groundY };
      // Up through the hands to about head height.
      const top = sh ? Math.max(0, sh.y - (torso ?? 0) * 0.6) : hands.y - (groundY - hands.y);
      const up = (hands.y - top) / uy;
      const seg = clipToFrame(ball, { x: hands.x - ux * up, y: hands.y - uy * up }, W, H);
      return seg ? [norm(seg[0]), norm(seg[1])] : null;
    }
    case "dtl-hip-wall": {
      // Vertical line touching the back of the butt.
      const dir = ballDir(pose, W, H);
      if (!hip || !sh || !torso || dir === null) return null;
      const traced = scan?.mask ? buttX(scan.mask, W, H, hip, torso, dir) : null;
      // Accept the outline only if it lands plausibly behind the hip point.
      const ok = traced !== null && (hip.x - traced) * dir > 0.05 * torso && (hip.x - traced) * dir < 0.9 * torso;
      const x = ok ? traced! : hip.x - dir * torso * BUTT_BEHIND_HIP;
      const bottom = groundY ?? hip.y + torso * 1.6;
      return [norm({ x, y: hip.y - torso * 0.4 }), norm({ x, y: bottom })];
    }

    // ── Face-On ──
    case "fo-head": {
      const head = P(LM.nose) ?? mid(LM.leftEar, LM.rightEar);
      const ls = P(LM.leftShoulder);
      const rs = P(LM.rightShoulder);
      if (!head) return null;
      const sw = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : torso ? torso * 0.7 : null;
      if (!sw) return null;
      const r = sw * 0.38;
      return [norm(head), norm({ x: head.x + r, y: head.y })];
    }
    case "fo-lead-hip": {
      // Vertical line at the outside of the lead hip (hip joints sit inside the pelvis outline).
      const lead = P(sides.lead.hip);
      const trail = P(sides.trail.hip);
      const tdir = targetDir(pose, W, H, sides);
      if (!lead || !trail || tdir === null) return null;
      const hw = Math.abs(lead.x - trail.x);
      const x = lead.x + tdir * hw * 0.45;
      const knee = P(sides.lead.knee);
      const bottom = knee ? knee.y : lead.y + (torso ?? hw * 3) * 0.8;
      return [norm({ x, y: lead.y - (torso ?? hw * 3) * 0.25 }), norm({ x, y: bottom })];
    }
    case "fo-trail-hip": {
      // Box around the trail hip, from just inside the joint to the outside of the pelvis.
      const lead = P(sides.lead.hip);
      const trail = P(sides.trail.hip);
      const tdir = targetDir(pose, W, H, sides);
      if (!lead || !trail || tdir === null) return null;
      const hw = Math.abs(lead.x - trail.x);
      const t = torso ?? hw * 3;
      const inner = trail.x + tdir * hw * 0.25;
      const outer = trail.x - tdir * hw * 0.6;
      return [norm({ x: Math.min(inner, outer), y: trail.y - t * 0.22 }), norm({ x: Math.max(inner, outer), y: trail.y + t * 0.35 })];
    }
  }
  return null;
}
