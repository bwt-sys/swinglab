/**
 * Biomechanical metrics derived from pose landmarks.
 *
 * All 2D angles are computed in *video pixel* space (normalized coords × video width/height) so
 * non-square frames (vertical phone video) don't skew them. Every function returns null instead of
 * throwing when a required landmark is missing or poorly visible.
 */
import { LM, type Lm, type PoseFrame } from "./pose";
import type { CameraAngle } from "./types";

export type Handed = "R" | "L";

/** Landmarks below this visibility are treated as missing. */
export const MIN_VIS = 0.4;
/** Typical adult shoulder width (MediaPipe shoulder joints), used to convert px → inches. */
export const SHOULDER_WIDTH_IN = 16;

interface Pt {
  x: number;
  y: number;
}

export interface Side {
  ear: number;
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
}

const LEFT: Side = {
  ear: LM.leftEar,
  shoulder: LM.leftShoulder,
  elbow: LM.leftElbow,
  wrist: LM.leftWrist,
  hip: LM.leftHip,
  knee: LM.leftKnee,
  ankle: LM.leftAnkle,
};
const RIGHT: Side = {
  ear: LM.rightEar,
  shoulder: LM.rightShoulder,
  elbow: LM.rightElbow,
  wrist: LM.rightWrist,
  hip: LM.rightHip,
  knee: LM.rightKnee,
  ankle: LM.rightAnkle,
};

/** A right-handed golfer's lead side is their left. */
export function sidesFor(h: Handed): { lead: Side; trail: Side } {
  return h === "R" ? { lead: LEFT, trail: RIGHT } : { lead: RIGHT, trail: LEFT };
}

// ── Low-level helpers ─────────────────────────────────────────────────
const deg = (r: number) => (r * 180) / Math.PI;

function ok(l: Lm | undefined): l is Lm {
  return !!l && Number.isFinite(l.x) && Number.isFinite(l.y) && l.v >= MIN_VIS;
}

function pt(f: PoseFrame | null, i: number, W: number, H: number): Pt | null {
  const l = f?.lm[i];
  return ok(l) ? { x: l.x * W, y: l.y * H } : null;
}

/** Midpoint of two landmarks; falls back to whichever one is visible (useful DTL, where the far side is occluded). */
function mid(f: PoseFrame | null, a: number, b: number, W: number, H: number, allowSingle = true): Pt | null {
  const p = pt(f, a, W, H);
  const q = pt(f, b, W, H);
  if (p && q) return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  if (!allowSingle) return null;
  return p ?? q;
}

function interior(a: Pt, b: Pt, c: Pt): number | null {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n < 1e-6) return null;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))));
}

// ── Individual measurements ───────────────────────────────────────────
export function hipMid(f: PoseFrame | null, W: number, H: number) {
  return mid(f, LM.leftHip, LM.rightHip, W, H);
}
export function shoulderMid(f: PoseFrame | null, W: number, H: number) {
  return mid(f, LM.leftShoulder, LM.rightShoulder, W, H);
}

/** Forward bend: angle of hip-mid → shoulder-mid from vertical, 0 = upright. */
export function spineAngle(f: PoseFrame | null, W: number, H: number): number | null {
  const h = hipMid(f, W, H);
  const s = shoulderMid(f, W, H);
  if (!h || !s) return null;
  const dx = s.x - h.x;
  const dy = h.y - s.y; // up is positive
  if (Math.hypot(dx, dy) < 2) return null;
  return deg(Math.atan2(Math.abs(dx), dy));
}

/** Lead shoulder → lead wrist, degrees above horizontal (negative = wrist below shoulder). */
export function leadArmAngle(f: PoseFrame | null, W: number, H: number, s: Side): number | null {
  const sh = pt(f, s.shoulder, W, H);
  const wr = pt(f, s.wrist, W, H);
  if (!sh || !wr) return null;
  return deg(Math.atan2(sh.y - wr.y, Math.abs(wr.x - sh.x)));
}

/** Nose, or ear midpoint if the nose is hidden. */
export function headPoint(f: PoseFrame | null, W: number, H: number): Pt | null {
  return pt(f, LM.nose, W, H) ?? mid(f, LM.leftEar, LM.rightEar, W, H);
}

export function shoulderWidthPx(f: PoseFrame | null, W: number, H: number): number | null {
  const a = pt(f, LM.leftShoulder, W, H);
  const b = pt(f, LM.rightShoulder, W, H);
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
}

/** Positive when the lead shoulder sits lower than the trail shoulder. */
export function shoulderTilt(f: PoseFrame | null, W: number, H: number, s: { lead: Side; trail: Side }) {
  const l = pt(f, s.lead.shoulder, W, H);
  const t = pt(f, s.trail.shoulder, W, H);
  if (!l || !t) return null;
  return deg(Math.atan2(l.y - t.y, Math.abs(l.x - t.x)));
}

/** Heading of the lead→trail segment in the horizontal (x–z) plane using 3D world landmarks. */
function heading(f: PoseFrame | null, lead: number, trail: number): number | null {
  const w = f?.world;
  const vl = f?.lm[lead];
  const vt = f?.lm[trail];
  if (!w || !vl || !vt || vl.v < MIN_VIS * 0.5 || vt.v < MIN_VIS * 0.5) return null;
  const a = w[lead];
  const b = w[trail];
  if (!a || !b) return null;
  return Math.atan2(a.z - b.z, a.x - b.x);
}

function turnBetween(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return deg(d);
}

/** Estimated shoulder rotation relative to a reference frame (Address), 0–180°. */
export function shoulderTurn(f: PoseFrame | null, ref: PoseFrame | null, s: { lead: Side; trail: Side }) {
  return turnBetween(heading(f, s.lead.shoulder, s.trail.shoulder), heading(ref, s.lead.shoulder, s.trail.shoulder));
}

/** Estimated pelvis rotation relative to a reference frame (Address), 0–180°. */
export function hipTurn(f: PoseFrame | null, ref: PoseFrame | null, s: { lead: Side; trail: Side }) {
  return turnBetween(heading(f, s.lead.hip, s.trail.hip), heading(ref, s.lead.hip, s.trail.hip));
}

export function leadKneeAngle(f: PoseFrame | null, W: number, H: number, s: Side): number | null {
  const h = pt(f, s.hip, W, H);
  const k = pt(f, s.knee, W, H);
  const a = pt(f, s.ankle, W, H);
  return h && k && a ? interior(h, k, a) : null;
}

/** +1 if the target is toward image-right, −1 if toward image-left (face-on). */
export function targetDir(f: PoseFrame | null, W: number, H: number, s: { lead: Side; trail: Side }): number | null {
  const l = pt(f, s.lead.shoulder, W, H) ?? pt(f, s.lead.hip, W, H);
  const t = pt(f, s.trail.shoulder, W, H) ?? pt(f, s.trail.hip, W, H);
  if (!l || !t || Math.abs(l.x - t.x) < 1) return null;
  return Math.sign(l.x - t.x);
}

/** +1 if the ball is toward image-right, −1 if image-left (down-the-line: hands hang toward the ball). */
export function ballDir(f: PoseFrame | null, W: number, H: number): number | null {
  const w = mid(f, LM.leftWrist, LM.rightWrist, W, H);
  const h = hipMid(f, W, H);
  if (!w || !h || Math.abs(w.x - h.x) < 1) return null;
  return Math.sign(w.x - h.x);
}

// ── Numeric key positions (compare mode) ──────────────────────────────
export interface KeyNumbers {
  /** DTL */
  spineNow: number | null;
  spineA: number | null;
  spineI: number | null;
  /** Spine angle change Address → Impact (negative = standing up / early extension). */
  spineLossI: number | null;
  armT: number | null;
  /** FO (inches, + = toward target; each golfer calibrated by their own shoulder width) */
  headNow: number | null;
  headT: number | null;
  headI: number | null;
  hipT: number | null;
  hipI: number | null;
  tiltI: number | null;
  /** Estimated pelvis rotation vs Address (degrees, from 3D world landmarks; approximate). */
  hipTurnT: number | null;
  hipTurnI: number | null;
}

/**
 * Raw numbers for one golfer. Everything is relative to that golfer's own lead/trail sides,
 * target direction and shoulder width, so values are comparable between two different videos
 * (camera distance, handedness and a mirrored display don't change them).
 */
export function keyNumbers(m: Omit<MetricInput, "hasA">): KeyNumbers {
  const { width: W, height: H, cur, at } = m;
  const sides = sidesFor(m.handed);
  const A = at.A;

  const spineA = spineAngle(A, W, H);
  const spineI = spineAngle(at.I, W, H);

  const swA = shoulderWidthPx(A, W, H) ?? shoulderWidthPx(cur, W, H);
  const tdir = targetDir(A, W, H, sides) ?? targetDir(cur, W, H, sides);
  const hdA = headPoint(A, W, H);
  const hpA = hipMid(A, W, H);
  const along = (p: Pt | null, ref: Pt | null) =>
    p && ref && swA && tdir !== null ? ((p.x - ref.x) * tdir * SHOULDER_WIDTH_IN) / swA : null;

  return {
    spineNow: spineAngle(cur, W, H),
    spineA,
    spineI,
    spineLossI: spineA !== null && spineI !== null ? spineI - spineA : null,
    armT: leadArmAngle(at.T, W, H, sides.lead),
    headNow: along(headPoint(cur, W, H), hdA),
    headT: along(headPoint(at.T, W, H), hdA),
    headI: along(headPoint(at.I, W, H), hdA),
    hipT: along(hipMid(at.T, W, H), hpA),
    hipI: along(hipMid(at.I, W, H), hpA),
    tiltI: shoulderTilt(at.I, W, H, sides),
    hipTurnT: A ? hipTurn(at.T, A, sides) : null,
    hipTurnI: A ? hipTurn(at.I, A, sides) : null,
  };
}

// ── Sidebar rows ──────────────────────────────────────────────────────
export type Tone = "neutral" | "good" | "warn";

export interface MetricRow {
  key: string;
  label: string;
  value: string | null;
  /** Comparison against Address, or extra context. */
  sub?: string;
  tone?: Tone;
  hint: string;
}

export interface MetricInput {
  angle: CameraAngle;
  handed: Handed;
  width: number;
  height: number;
  cur: PoseFrame | null;
  /** Poses at the bookmarked checkpoints (null if unset or undetected). */
  at: { A: PoseFrame | null; T: PoseFrame | null; I: PoseFrame | null };
  hasA: boolean;
}

const sgn = (n: number, d = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;
const fmtDeg = (n: number | null) => (n === null ? null : `${n.toFixed(1)}°`);

export function computeMetrics(m: MetricInput): MetricRow[] {
  const { width: W, height: H, cur, at } = m;
  const sides = sidesFor(m.handed);
  const A = at.A;
  const needA = m.hasA ? "No pose at Address frame" : "Tag Address (A) to compare";

  if (m.angle === "DTL") {
    // Spine angle
    const sp = spineAngle(cur, W, H);
    const spA = spineAngle(A, W, H);
    let spSub: string | undefined = needA;
    let spTone: Tone = "neutral";
    if (sp !== null && spA !== null) {
      const d = sp - spA;
      spSub = `${sgn(d)}° vs Address`;
      if (d <= -5) {
        spSub += " · standing up (early extension)";
        spTone = "warn";
      } else if (Math.abs(d) <= 3) spTone = "good";
    }

    // Lead arm plane
    const arm = leadArmAngle(cur, W, H, sides.lead);
    const armT = leadArmAngle(at.T, W, H, sides.lead);
    const armI = leadArmAngle(at.I, W, H, sides.lead);
    const armSub = `Top ${armT === null ? "—" : `${armT.toFixed(1)}°`} · Impact ${armI === null ? "—" : `${armI.toFixed(1)}°`}`;

    // Hip thrust
    const hp = hipMid(cur, W, H);
    const hpA = hipMid(A, W, H);
    const dir = ballDir(A, W, H) ?? ballDir(cur, W, H);
    let thrust: string | null = null;
    let thrustSub: string | undefined = needA;
    let thrustTone: Tone = "neutral";
    if (hp && hpA && dir !== null) {
      const dxPx = (hp.x - hpA.x) * dir; // + = toward the ball
      const pct = (dxPx / W) * 100;
      thrust = `${sgn(pct)}% W`;
      thrustSub = `${sgn(dxPx, 0)} px ${dxPx >= 0 ? "toward ball" : "away from ball"}`;
      if (pct > 3) {
        thrustTone = "warn";
        thrustSub += " · hips moving in";
      } else if (Math.abs(pct) <= 1.5) thrustTone = "good";
    }

    return [
      { key: "spine", label: "Spine Angle", value: fmtDeg(sp), sub: spSub, tone: spTone, hint: "Hip-midpoint → shoulder-midpoint, degrees from vertical. A drop of 5°+ vs Address suggests early extension / posture loss." },
      { key: "arm", label: "Lead Arm Plane", value: fmtDeg(arm), sub: armSub, hint: "Lead shoulder → lead wrist, degrees above horizontal. Compare Top vs Impact." },
      { key: "thrust", label: "Hip Thrust", value: thrust, sub: thrustSub, tone: thrustTone, hint: "Horizontal hip-midpoint movement vs Address, as % of frame width. Positive = toward the ball." },
    ];
  }

  // ── Face-On ──
  const swA = shoulderWidthPx(A, W, H) ?? shoulderWidthPx(cur, W, H);
  const inPerPx = swA ? SHOULDER_WIDTH_IN / swA : null;
  const tdir = targetDir(A, W, H, sides) ?? targetDir(cur, W, H, sides);
  const toIn = (px: number) => (inPerPx ? px * inPerPx : null);
  const pctSW = (px: number) => (swA ? (px / swA) * 100 : null);

  // Head sway
  const hd = headPoint(cur, W, H);
  const hdA = headPoint(A, W, H);
  let head: string | null = null;
  let headSub: string | undefined = needA;
  let headTone: Tone = "neutral";
  if (hd && hdA && tdir !== null) {
    const dx = (hd.x - hdA.x) * tdir; // + toward target
    const dy = hdA.y - hd.y; // + up
    const ix = toIn(dx), iy = toIn(dy);
    const px = pctSW(dx), py = pctSW(dy);
    head = ix !== null && iy !== null ? `↔ ${sgn(ix)}″  ↕ ${sgn(iy)}″` : null;
    headSub = px !== null && py !== null ? `${sgn(px, 0)}% / ${sgn(py, 0)}% shoulder width` : undefined;
    const worst = Math.max(Math.abs(ix ?? 0), Math.abs(iy ?? 0));
    headTone = worst > 3 ? "warn" : worst <= 1.5 ? "good" : "neutral";
  }

  // Hip sway / slide
  const hp = hipMid(cur, W, H);
  const hpA = hipMid(A, W, H);
  const swayIn = (f: PoseFrame | null) => {
    const p = hipMid(f, W, H);
    return p && hpA && tdir !== null ? toIn((p.x - hpA.x) * tdir) : null;
  };
  let hip: string | null = null;
  let hipTone: Tone = "neutral";
  if (hp && hpA && tdir !== null) {
    const v = toIn((hp.x - hpA.x) * tdir);
    if (v !== null) {
      hip = `${Math.abs(v).toFixed(1)}″ ${v >= 0 ? "toward target" : "away"}`;
      hipTone = v < -3 ? "warn" : "neutral";
    }
  }
  const sT = swayIn(at.T);
  const sI = swayIn(at.I);
  const hipSub = hpA
    ? `Top ${sT === null ? "—" : `${Math.abs(sT).toFixed(1)}″ ${sT >= 0 ? "toward" : "away"}`} · Impact ${sI === null ? "—" : `${Math.abs(sI).toFixed(1)}″ ${sI >= 0 ? "toward" : "away"}`}`
    : needA;

  // Shoulders
  const tilt = shoulderTilt(cur, W, H, sides);
  const turn = A ? shoulderTurn(cur, A, sides) : null;

  // Lead knee
  const knee = leadKneeAngle(cur, W, H, sides.lead);
  const kneeA = leadKneeAngle(A, W, H, sides.lead);
  const kneeSub = knee !== null && kneeA !== null ? `${sgn(knee - kneeA)}° vs Address · flex ${(180 - knee).toFixed(0)}°` : knee !== null ? `flex ${(180 - knee).toFixed(0)}°` : needA;

  return [
    { key: "head", label: "Head Sway", value: head, sub: headSub, tone: headTone, hint: `Nose (or ear midpoint) movement vs Address. ↔ + = toward target, ↕ + = up. Inches assume a ${SHOULDER_WIDTH_IN}″ shoulder width.` },
    { key: "hip", label: "Lateral Hip Sway", value: hip, sub: hipSub, tone: hipTone, hint: "Pelvis-midpoint shift vs Address. Away from target in the backswing = sway; toward target at impact = slide." },
    { key: "tilt", label: "Shoulder Tilt", value: tilt === null ? null : `${sgn(tilt)}°`, sub: "+ = lead shoulder lower", hint: "Angle of the shoulder line from horizontal." },
    { key: "turn", label: "Shoulder Turn (est.)", value: fmtDeg(turn), sub: A ? "vs Address, from 3D landmarks" : needA, hint: "Rotation of the shoulder line in the horizontal plane, estimated from MediaPipe's 3D world landmarks. Treat as approximate." },
    { key: "knee", label: "Lead Knee Angle", value: fmtDeg(knee), sub: kneeSub, hint: "Interior hip–knee–ankle angle on the lead leg (180° = straight)." },
  ];
}
