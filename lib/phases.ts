/**
 * Automatic swing checkpoint detection from wrist height over time.
 *
 * Image y grows downward, so "highest hands" = smallest y.
 *   1. Fastest downward wrist motion → somewhere in the downswing (the anchor).
 *   2. Top     = highest wrist point before the anchor.
 *   3. Impact  = lowest wrist point shortly after the anchor.
 *   4. Address = last moment before Top where the hands were still near their low starting height
 *      (then pinned to the exact frame from the club pixels, see takeaway.ts).
 *   5. Finish  = first moment after Impact when the hands reach (close to) their highest follow-through point.
 */
import { LM, type PoseTrack } from "./pose";
import { MIN_VIS } from "./metrics";
import type { Bookmarks } from "./types";

export interface PhaseResult {
  bookmarks: Required<Bookmarks>;
  coverage: number;
}

/**
 * Mean wrist position per frame, in units of frame height (x is scaled by the aspect ratio so
 * horizontal and vertical motion are comparable).
 */
function wristXY(track: PoseTrack, aspect: number): { x: (number | null)[]; y: (number | null)[] } {
  const x: (number | null)[] = [];
  const y: (number | null)[] = [];
  for (const f of track.frames) {
    const ls = f
      ? [LM.leftWrist, LM.rightWrist]
          .map((i) => f.lm[i])
          .filter((l) => l && l.v >= MIN_VIS && Number.isFinite(l.x) && Number.isFinite(l.y))
      : [];
    if (ls.length === 0) {
      x.push(null);
      y.push(null);
    } else {
      x.push((ls.reduce((a, l) => a + l.x, 0) / ls.length) * aspect);
      y.push(ls.reduce((a, l) => a + l.y, 0) / ls.length);
    }
  }
  return { x, y };
}

function median(s: number[]): number {
  if (s.length === 0) return 0;
  const a = [...s].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Linearly fill gaps; leading/trailing gaps take the nearest value. */
function fillGaps(s: (number | null)[]): number[] | null {
  const idx = s.flatMap((v, i) => (v === null ? [] : [i]));
  if (idx.length === 0) return null;
  const out = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== null) {
      out[i] = s[i]!;
      continue;
    }
    let lo = -1;
    let hi = -1;
    for (let j = i - 1; j >= 0; j--) if (s[j] !== null) { lo = j; break; }
    for (let j = i + 1; j < s.length; j++) if (s[j] !== null) { hi = j; break; }
    if (lo < 0) out[i] = s[hi]!;
    else if (hi < 0) out[i] = s[lo]!;
    else out[i] = s[lo]! + ((s[hi]! - s[lo]!) * (i - lo)) / (hi - lo);
  }
  return out;
}

function smooth(s: number[], radius: number): number[] {
  if (radius < 1) return s;
  return s.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(s.length - 1, i + radius); j++) {
      sum += s[j];
      n++;
    }
    return sum / n;
  });
}

const argmin = (s: number[], a: number, b: number) => {
  let k = a;
  for (let i = a; i <= b; i++) if (s[i] < s[k]) k = i;
  return k;
};
const argmax = (s: number[], a: number, b: number) => {
  let k = a;
  for (let i = a; i <= b; i++) if (s[i] > s[k]) k = i;
  return k;
};

/**
 * Last still frame before the takeaway. `coarse` is a frame already inside the early takeaway.
 * Fits displacement d(i) from the setup position with: d = b for i ≤ k, d = b + a·(i−k)² after.
 */
function refineTakeaway(x: number[], y: number[], coarse: number, top: number, range: number, fps: number): number {
  // Window end: last frame before Top where the hands are still within the early takeaway
  // (≤ 12% of the backswing height away from where they were at `coarse`'s start region).
  const lo = Math.max(0, coarse - Math.round(1.0 * fps));
  if (coarse - lo < 3) return coarse;

  // Setup position = median of the first half of the window (before any motion).
  const half = lo + Math.max(2, Math.floor((coarse - lo) / 2));
  const bx = median(x.slice(lo, half));
  const by = median(y.slice(lo, half));
  const d = (i: number) => Math.hypot(x[i] - bx, y[i] - by);

  let end = coarse;
  while (end < top && d(end) < 0.12 * range) end++;
  if (end - lo < 4) return coarse;

  let bestK = coarse;
  let bestSSE = Infinity;
  for (let k = lo + 1; k < end - 1; k++) {
    // Flat part: mean of d (jitter floor).
    let b = 0;
    for (let i = lo; i <= k; i++) b += d(i);
    b /= k - lo + 1;
    // Rising part: least-squares a for d − b = a·(i−k)².
    let num = 0;
    let den = 0;
    for (let i = k + 1; i <= end; i++) {
      const q = (i - k) * (i - k);
      num += (d(i) - b) * q;
      den += q * q;
    }
    const a = den > 0 ? Math.max(0, num / den) : 0;
    let sse = 0;
    for (let i = lo; i <= end; i++) {
      const pred = i <= k ? b : b + a * (i - k) * (i - k);
      sse += (d(i) - pred) ** 2;
    }
    if (sse < bestSSE) {
      bestSSE = sse;
      bestK = k;
    }
  }
  // The first frames of motion are partly hidden in jitter, so the fit can still land ~1 frame
  // late. Any frame before the takeaway is a valid Address but a late one is not, so step back
  // ~33 ms as a safety margin.
  const margin = Math.max(1, Math.round(fps / 30));
  return Math.max(lo, Math.min(bestK, coarse) - margin);
}

export function detectPhases(track: PoseTrack, aspect = 1): PhaseResult | { error: string } {
  const pos = wristXY(track, aspect);
  const raw = pos.y;
  const n = raw.length;
  const valid = raw.filter((v) => v !== null).length;
  const coverage = n ? valid / n : 0;
  if (n < 10 || valid < 10) return { error: "Not enough frames with visible wrists. Run Analyze Swing first." };
  if (coverage < 0.4) return { error: `Wrists were only visible in ${(coverage * 100).toFixed(0)}% of frames — too few to detect phases.` };

  const filled = fillGaps(raw)!;
  const fps = track.fps;
  const y = smooth(filled, Math.max(1, Math.round(fps / 30)));

  // 1. Anchor: peak downward wrist velocity.
  let anchor = 1;
  let best = -Infinity;
  for (let i = 1; i < n; i++) {
    const v = y[i] - y[i - 1];
    if (v > best) {
      best = v;
      anchor = i;
    }
  }

  // 2. Top: highest hands before the anchor.
  const top = argmin(y, 0, Math.max(0, anchor - 1));

  // 3. Impact: lowest hands within ~0.4s after the anchor.
  const impact = argmax(y, anchor, Math.min(n - 1, anchor + Math.round(0.4 * fps)));

  const lowPre = Math.max(...y.slice(0, top + 1));
  const range = lowPre - y[top];
  if (top >= impact || range < 0.05) {
    return { error: "Couldn't find a clear backswing (hands didn't rise enough). Check the clip contains a full swing." };
  }

  // 4. Address.
  //   a) Coarse: walking back from Top, the first frame with hands within 5% of their low point.
  //      Early takeaway is mostly horizontal, so this lands a few frames *into* the takeaway.
  let coarse = 0;
  for (let i = top; i >= 0; i--) {
    if (y[i] >= lowPre - 0.05 * range) {
      coarse = i;
      break;
    }
  }
  //   b) Refine with a change-point fit on 2D hand displacement (x + y) from the setup position.
  //      Hands start the takeaway from rest and accelerate, so the first frames of motion are
  //      smaller than tracking jitter — a per-frame speed threshold always fires late. Instead fit
  //      "flat, then d = a·(i−k)²" over the early takeaway and take the best k as the last still frame.
  const address = refineTakeaway(fillGaps(pos.x)!, filled, coarse, top, range, fps);

  // 5. Finish: first frame after Impact within 5% of the highest follow-through point.
  let finish = n - 1;
  if (impact < n - 1) {
    const hi = argmin(y, impact + 1, n - 1);
    const thresh = y[hi] + 0.05 * range;
    finish = hi;
    for (let i = impact + 1; i <= hi; i++) {
      if (y[i] <= thresh) {
        finish = i;
        break;
      }
    }
  }

  const t = (i: number) => (i + 0.5) / fps;
  return { bookmarks: { A: t(address), T: t(top), I: t(impact), F: t(finish) }, coverage };
}
