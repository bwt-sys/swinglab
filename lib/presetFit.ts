/**
 * Snap reference presets to the golfer's body using the pose at Address (or the current frame).
 * All geometry is done in video pixels so vertical phone video isn't distorted, then converted back
 * to normalized 0..1 coordinates. Returns null when the needed landmarks aren't visible, in which
 * case the caller keeps the preset's default placement.
 */
import { ballDir, MIN_VIS, sidesFor, targetDir, type Handed } from "./metrics";
import { LM, type PoseFrame } from "./pose";
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

export function fitPreset(def: PresetDef, pose: PoseFrame | null, W: number, H: number, handed: Handed): Point[] | null {
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
      // Tailbone (hip midpoint) to base of neck (shoulder midpoint), extended a little past each end.
      if (!hip || !sh || !torso) return null;
      return [norm(lerp(sh, hip, 1.12)), norm(lerp(hip, sh, 1.12))];
    }
    case "dtl-shaft-plane": {
      // Ball → hands along the shaft. The club itself isn't tracked, so the ball is estimated at ground
      // level with a typical ~50° apparent shaft angle; drag the bottom end onto the ball to refine.
      const hands = mid(LM.leftWrist, LM.rightWrist);
      const dir = ballDir(pose, W, H);
      if (!hands || dir === null || groundY === null || groundY <= hands.y) return null;
      const drop = groundY - hands.y;
      const ball = { x: hands.x + (dir * drop) / Math.tan((50 * Math.PI) / 180), y: groundY };
      // Extend from the ball up through the hands to about head height.
      const top = sh ? Math.max(0, sh.y - (torso ?? 0) * 0.6) : hands.y - drop;
      const t = (ball.y - top) / (ball.y - hands.y);
      // Clip to the frame along the line itself (clamping the ends separately would bend it).
      const seg = clipToFrame(ball, lerp(ball, hands, t), W, H);
      return seg ? [norm(seg[0]), norm(seg[1])] : null;
    }
    case "dtl-hip-wall": {
      // Vertical line touching the glutes: behind the hip joint (away from the ball) by ~22% of torso length.
      const dir = ballDir(pose, W, H);
      if (!hip || !torso || dir === null) return null;
      const x = hip.x - dir * torso * 0.22;
      const bottom = groundY ?? hip.y + torso * 1.6;
      return [norm({ x, y: hip.y - torso * 0.3 }), norm({ x, y: bottom })];
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
