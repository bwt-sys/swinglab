import type { Point, Shape } from "./types";

/** Convert a normalized point to pixel space for a frame of size w×h. */
export function toPx(p: Point, w: number, h: number): Point {
  return { x: p.x * w, y: p.y * h };
}

export function distPx(a: Point, b: Point, w: number, h: number): number {
  return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
}

/** Interior angle ABC in degrees (0–180), measured in pixel space so the aspect ratio is respected. */
export function angleAt(a: Point, b: Point, c: Point, w: number, h: number): number {
  const v1x = (a.x - b.x) * w;
  const v1y = (a.y - b.y) * h;
  const v2x = (c.x - b.x) * w;
  const v2y = (c.y - b.y) * h;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 0;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Tilt of a line from vertical, 0° = perfectly vertical, 90° = horizontal. */
export function tiltFromVertical(a: Point, b: Point, w: number, h: number): number {
  const dx = Math.abs((b.x - a.x) * w);
  const dy = Math.abs((b.y - a.y) * h);
  if (dx < 1e-6 && dy < 1e-6) return 0;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Distance (px) from point p to segment ab. All inputs in pixel space. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether a shape exposes draggable handles at its points. */
export function hasHandles(shape: Shape): boolean {
  return shape.kind !== "pen";
}

/** Find the top-most handle within `radius` px of p. */
export function hitHandle(
  shapes: Shape[],
  p: Point,
  w: number,
  h: number,
  radius = 12,
): { shapeId: string; index: number } | null {
  const pp = toPx(p, w, h);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (!hasHandles(s)) continue;
    for (let j = s.points.length - 1; j >= 0; j--) {
      const hp = toPx(s.points[j], w, h);
      if (Math.hypot(hp.x - pp.x, hp.y - pp.y) <= radius) return { shapeId: s.id, index: j };
    }
  }
  return null;
}

/** Find the top-most shape whose body is within `tol` px of p. */
export function hitShape(shapes: Shape[], p: Point, w: number, h: number, tol = 8): string | null {
  const pp = toPx(p, w, h);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const pts = s.points.map((q) => toPx(q, w, h));
    switch (s.kind) {
      case "line":
      case "angle":
      case "pen": {
        for (let j = 0; j < pts.length - 1; j++) {
          if (distToSegment(pp, pts[j], pts[j + 1]) <= tol) return s.id;
        }
        break;
      }
      case "circle": {
        const r = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const d = Math.hypot(pp.x - pts[0].x, pp.y - pts[0].y);
        if (d <= r + tol) return s.id;
        break;
      }
      case "rect": {
        const x0 = Math.min(pts[0].x, pts[1].x) - tol;
        const x1 = Math.max(pts[0].x, pts[1].x) + tol;
        const y0 = Math.min(pts[0].y, pts[1].y) - tol;
        const y1 = Math.max(pts[0].y, pts[1].y) + tol;
        if (pp.x >= x0 && pp.x <= x1 && pp.y >= y0 && pp.y <= y1) return s.id;
        break;
      }
    }
  }
  return null;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `s${Date.now().toString(36)}${idCounter}`;
}
