import type { Vec } from './math';

export interface Poly {
  vertices: readonly Vec[];
}

/** Squared distance from point p to segment ab, plus the closest point. */
export function closestOnSegment(p: Vec, a: Vec, b: Vec): { d2: number; x: number; y: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a.x + abx * t;
  const y = a.y + aby * t;
  return { d2: (p.x - x) ** 2 + (p.y - y) ** 2, x, y };
}

/** Point-in-convex-polygon test (winding-agnostic). */
export function pointInConvex(p: Vec, verts: readonly Vec[]): boolean {
  let sign = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/**
 * Circle vs convex polygon. Returns the contact normal (pointing from the polygon toward the circle)
 * and the contact point, or null when they do not touch.
 */
export function circleVsConvex(c: Vec, r: number, verts: readonly Vec[]): { normal: Vec; point: Vec } | null {
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let i = 0; i < verts.length; i++) {
    const q = closestOnSegment(c, verts[i], verts[(i + 1) % verts.length]);
    if (q.d2 < best) {
      best = q.d2;
      bx = q.x;
      by = q.y;
    }
  }
  const inside = pointInConvex(c, verts);
  if (!inside && best > r * r) return null;
  let nx = c.x - bx;
  let ny = c.y - by;
  let l = Math.hypot(nx, ny);
  if (l < 1e-6) {
    nx = 0;
    ny = -1;
    l = 1;
  }
  const s = inside ? -1 : 1;
  return { normal: { x: (nx / l) * s, y: (ny / l) * s }, point: { x: bx, y: by } };
}

/** Segment vs convex polygon; returns the entry fraction t in [0,1] or null. */
export function segmentVsConvex(a: Vec, b: Vec, verts: readonly Vec[]): number | null {
  let tEnter = 0;
  let tExit = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Determine winding to orient edge normals outward.
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    area += p.x * q.y - q.x * p.y;
  }
  const w = area >= 0 ? 1 : -1;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    // outward normal
    const nx = (q.y - p.y) * w;
    const ny = -(q.x - p.x) * w;
    const num = nx * (p.x - a.x) + ny * (p.y - a.y);
    const den = nx * dx + ny * dy;
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return null;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > tEnter) tEnter = t;
    } else if (t < tExit) tExit = t;
    if (tEnter > tExit) return null;
  }
  return tEnter;
}
