/**
 * Pixel-accurate takeaway start (the Address checkpoint).
 *
 * The pose-based estimate in phases.ts watches the wrists, but the clubhead moves first and fastest,
 * the hands barely move for the first few frames, and the landmarker smooths joints over time — so
 * it lands a few frames into the takeaway. Here we look at the actual pixels around the club (hands
 * down to the ground) and walk back from clear takeaway motion to the last frame where nothing there
 * changed.
 */
import { LM, type PoseTrack, type Raster, type Roi } from "./pose";
import { MIN_VIS } from "./metrics";

/** Frame index for a checkpoint time (the stage and the track use frame-centre times). */
export const frameOf = (t: number, fps: number) => Math.max(0, Math.round(t * fps - 0.5));

/**
 * Club region at Address: from just above the hands down past the feet (where the ball is), and wide
 * enough either side of the hands to hold the clubhead in DTL and FO. Null if the pose is too unclear.
 */
export function clubRoi(track: PoseTrack, frame: number, aspect: number): Roi | null {
  // Use the nearest detected frame to Address.
  let f = null;
  for (let d = 0; d < 10 && !f; d++) f = track.frames[frame - d] ?? track.frames[frame + d] ?? null;
  if (!f) return null;
  const pt = (i: number) => (f.lm[i] && f.lm[i].v >= MIN_VIS ? f.lm[i] : null);
  const avg = (ids: number[]) => {
    const ps = ids.map(pt).filter((p) => p !== null);
    return ps.length ? { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length } : null;
  };
  const hands = avg([LM.leftWrist, LM.rightWrist]);
  const shoulders = avg([LM.leftShoulder, LM.rightShoulder]);
  const feet = avg([LM.leftAnkle, LM.rightAnkle]);
  if (!hands || !shoulders) return null;
  const ground = feet ? feet.y : Math.min(1, hands.y + 2 * (hands.y - shoulders.y));
  const body = Math.max(0.1, ground - shoulders.y); // shoulder-to-ankle height, in frame heights
  const y0 = Math.max(0, hands.y - 0.15 * body);
  const y1 = Math.min(1, ground + 0.12 * body);
  const halfW = (0.7 * body) / aspect; // frame-height units → frame-width units
  const x0 = Math.max(0, hands.x - halfW);
  const x1 = Math.min(1, hands.x + halfW);
  if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Fraction of pixels that changed by more than `thresh` between two equal-size crops. */
function changed(a: Raster<Uint8ClampedArray>, b: Raster<Uint8ClampedArray>, thresh: number): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i] - b.data[i]) > thresh) n++;
  return n / a.data.length;
}

const quantile = (s: number[], q: number) => {
  if (!s.length) return 0;
  const a = [...s].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))];
};

/**
 * Index (into `crops`) of the last still frame before the takeaway, or null if no clear start.
 * `guess` is the pose-based Address index within `crops`; the takeaway must be under way soon after it.
 * `fps` is the frame rate of `crops`.
 */
export function takeawayStart(crops: Raster<Uint8ClampedArray>[], guess: number, fps: number): number | null {
  const n = crops.length;
  if (n < 6) return null;
  // Per-pixel threshold above sensor/compression noise: well clear of the typical frame-to-frame change.
  const sample: number[] = [];
  for (let i = 1; i < n; i++) {
    const a = crops[i - 1].data;
    const b = crops[i].data;
    for (let j = 0; j < a.length; j += 7) sample.push(Math.abs(a[j] - b[j]));
  }
  const thresh = Math.max(14, 4 * quantile(sample, 0.5));
  // m[i] = how much of the club region changed from frame i−1 to frame i.
  const m = [0];
  for (let i = 1; i < n; i++) m.push(changed(crops[i - 1], crops[i], thresh));

  const peak = Math.max(...m.slice(Math.max(1, guess)));
  const floor = quantile(m.slice(1), 0.25);
  const lo = Math.max(0.0015, 2 * floor); // "still": at or near the noise floor
  const hi = Math.max(0.006, floor + 0.3 * (peak - floor)); // "clearly moving"
  if (peak < hi) return null;

  // First clearly-moving step at or after the guess (the takeaway), then back to where motion began.
  // Sustained: a takeaway keeps moving, while a jiggle or a compression blip is a one-frame spike.
  const run = Math.max(2, Math.round(0.05 * fps));
  let j = -1;
  for (let i = Math.max(1, guess - 2); i + run - 1 < n; i++) {
    let ok = true;
    for (let r = 0; r < run && ok; r++) ok = m[i + r] >= hi;
    if (ok) {
      j = i;
      break;
    }
  }
  if (j < 0) return null;
  let k = j;
  while (k > 1 && m[k - 1] > lo) k--;
  if (k <= 1) return null; // never still in the window: can't tell where the takeaway began

  // Frame-to-frame change misses the first sub-pixel creep of a slow takeaway, so finish with the
  // distance from a reference frame over a short window before the motion. Real clips drift while
  // the golfer is set (camera wobble, breathing, the clubhead jiggling as it hovers), and that drift
  // also grows the distance — roughly linearly — whereas the takeaway accelerates. So fit
  // "straight-line drift, then drift + a·(i−t)²" and take the bend t as the last still frame.
  // The window is short (≈0.2 s) so drift can't add up into a false early start.
  const w0 = Math.max(0, k - 1 - Math.max(4, Math.round(0.2 * fps)));
  if (j - w0 < 6) return k - 1;
  const ref = medianFrame(crops.slice(w0, w0 + 3));
  const D: number[] = [];
  for (let i = w0; i <= j; i++) D.push(changed(ref, crops[i], thresh));
  const bend = fitBend(D, 3, k - w0);
  return bend === null ? k - 1 : w0 + bend;
}

/**
 * Best bend t in [tMin, tMax] for d(i) ≈ c0 + c1·i, plus p·(i−t) + q·(i−t)² after t, with c1, p, q ≥ 0
 * (drift and motion only ever add distance; the motion may show up as a ramp, a curve or both).
 * Null if no bend fits better than a straight line.
 */
function fitBend(d: number[], tMin: number, tMax: number): number | null {
  const n = d.length;
  let best: number | null = null;
  let bestSSE = lineSSE(d);
  // Column subsets of [1, i, ramp, curve]: always the constant, at least one motion term.
  const subsets = [
    [0, 1, 2, 3],
    [0, 1, 2],
    [0, 1, 3],
    [0, 2, 3],
    [0, 2],
    [0, 3],
  ];
  for (let t = tMin; t <= Math.min(tMax, n - 3); t++) {
    const basis = (i: number) => {
      const u = i > t ? i - t : 0;
      return [1, i, u, u * u];
    };
    for (const cols of subsets) {
      const c = leastSquares(d, (i) => cols.map((k) => basis(i)[k]));
      if (!c || c.slice(1).some((v) => v < 0)) continue;
      let sse = 0;
      for (let i = 0; i < n; i++) {
        const f = basis(i);
        sse += (d[i] - cols.reduce((acc, k, x) => acc + c[x] * f[k], 0)) ** 2;
      }
      if (sse < bestSSE - 1e-15) {
        bestSSE = sse;
        best = t;
      }
    }
  }
  return best;
}

/** Least squares for d(i) ≈ Σ c·f(i) via the normal equations (Gaussian elimination); null if singular. */
function leastSquares(d: number[], f: (i: number) => number[]): number[] | null {
  const k = f(0).length;
  const M = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let i = 0; i < d.length; i++) {
    const v = f(i);
    for (let a = 0; a < k; a++) {
      M[a][k] += v[a] * d[i];
      for (let b = 0; b < k; b++) M[a][b] += v[a] * v[b];
    }
  }
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const g = M[r][col] / M[col][col];
      for (let c = col; c <= k; c++) M[r][c] -= g * M[col][c];
    }
  }
  return M.map((row, i) => row[k] / row[i]);
}

function lineSSE(d: number[]): number {
  const n = d.length;
  const mx = (n - 1) / 2;
  const my = d.reduce((a, v) => a + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (d[i] - my);
    sxx += (i - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (d[i] - (my + b * (i - mx))) ** 2;
  return sse;
}

/** Per-pixel median of a few equal-size crops (a low-noise reference frame). */
function medianFrame(fs: Raster<Uint8ClampedArray>[]): Raster<Uint8ClampedArray> {
  const { w, h } = fs[0];
  const out = new Uint8ClampedArray(w * h);
  const v = new Array<number>(fs.length);
  for (let p = 0; p < out.length; p++) {
    for (let f = 0; f < fs.length; f++) v[f] = fs[f].data[p];
    v.sort((x, y) => x - y);
    out[p] = v[v.length >> 1];
  }
  return { w, h, data: out };
}
