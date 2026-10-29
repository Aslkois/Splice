// Small, allocation-light vector math shared by the simulation and the mechanic runtime.

export interface Vec {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a: Vec, fallback: Vec = { x: 1, y: 0 }): Vec {
  const l = len(a);
  if (l < 1e-9 || !Number.isFinite(l)) return { ...fallback };
  return { x: a.x / l, y: a.y / l };
}

export function rotate(a: Vec, radians: number): Vec {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Replace NaN/Infinity with a safe value so user-authored math can never poison the physics engine. */
export function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

export function finiteVec(v: Vec, fallback: Vec = { x: 0, y: 0 }): Vec {
  return { x: finite(v.x, fallback.x), y: finite(v.y, fallback.y) };
}

export function clampLen(v: Vec, maxLen: number): Vec {
  const l = len(v);
  if (l <= maxLen || l === 0) return v;
  return scale(v, maxLen / l);
}

/** Deterministic PRNG (mulberry32). The simulation never calls Math.random. */
export class Rng {
  private s: number;
  constructor(seed = 0x5eed) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
}
