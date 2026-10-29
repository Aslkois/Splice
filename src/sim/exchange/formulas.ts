import { V_UNIT } from '../config';
import type { Vec } from '../math';
import type { ExchangeTable } from './table';

/**
 * The exchange's pricing, as pure functions. The ledger (Exchange.perform), the Workshop's cost
 * previews and the documentation all call these, so a number shown anywhere is the number charged.
 *
 * Units: velocity px/s, mass kg, impulse kg·px/s, momentum mu = kg·100 px/s, energy E = ½·m·(v/100)².
 */

export interface PriceLine {
  label: string;
  value: number;
  unit: string;
}

export interface ImpulseQuote {
  /** Impulse actually delivered (after the engine's speed safety limit). */
  impulse: Vec;
  momentum: number;
  /** Change of the target's speed (px/s). */
  deltaV: number;
  /** Kinetic energy the target gains (≤ 0 when the push slows it down). */
  deltaKE: number;
  /** Momentum term + max(0, ΔKE), before efficiency and range. */
  work: number;
  efficiency: number;
  rangeFactor: number;
  energy: number;
}

/** Kinetic energy (E) of mass m (kg) moving at v (px/s). */
export function kineticEnergy(m: number, v: Vec | number): number {
  const s = typeof v === 'number' ? v : Math.hypot(v.x, v.y);
  return 0.5 * m * (s / V_UNIT) ** 2;
}

/**
 * Price of pushing a body. You pay for what the push actually does to it:
 *   E = (linearPerMu · |J|/100 + max(0, ΔKE)) / efficiency × rangeFactor
 * ΔKE is measured in the world frame from the body's velocity at that moment, so
 *   - the cost does not depend on how the push is split up (two half-pushes cost the same as one),
 *     which keeps force-over-time and one-off impulses on the same scale;
 *   - lifting yourself costs the same per pixel of height however you do it;
 *   - slowing a body (or turning its existing momentum) only costs the momentum term.
 * Pushing your own body has no transmission loss (selfEfficiency); remote pushes do (efficiency)
 * and get dearer beyond freeRange.
 */
export function quoteImpulse(
  t: ExchangeTable,
  o: { mass: number; velocity: Vec; impulse: Vec; self: boolean; distance: number; maxSpeed: number },
): ImpulseQuote {
  const m = Math.max(o.mass, 0.01);
  let j = { x: finiteOr0(o.impulse.x), y: finiteOr0(o.impulse.y) };
  const jl = Math.hypot(j.x, j.y);
  if (jl / m > o.maxSpeed) j = { x: (j.x / jl) * o.maxSpeed * m, y: (j.y / jl) * o.maxSpeed * m };
  const p = Math.hypot(j.x, j.y) / V_UNIT;
  const v0 = o.velocity;
  const v1 = { x: v0.x + j.x / m, y: v0.y + j.y / m };
  const deltaKE = kineticEnergy(m, v1) - kineticEnergy(m, v0);
  const work = t.impulse.linearPerMu * p + Math.max(0, deltaKE);
  const efficiency = o.self ? t.impulse.selfEfficiency : t.impulse.efficiency;
  const d = o.self ? 0 : o.distance;
  const rangeFactor = d > t.impulse.freeRange ? 1 + ((d - t.impulse.freeRange) / t.impulse.rangeFalloff) ** 2 : 1;
  return { impulse: j, momentum: p, deltaV: Math.hypot(j.x, j.y) / m, deltaKE, work, efficiency, rangeFactor, energy: (work / efficiency) * rangeFactor };
}

export interface ProjectileQuote {
  kineticEnergy: number;
  momentum: number;
  energy: number;
  /** Health damage on a direct, unguarded hit. */
  damage: number;
}

/** E = (½mv² + linearPerMu·p) / efficiency. Its damage on impact is its kinetic energy. */
export function quoteProjectile(t: ExchangeTable, speed: number, mass: number): ProjectileQuote {
  const s = speed / V_UNIT;
  const ke = 0.5 * mass * s * s;
  const p = mass * s;
  return { kineticEnergy: ke, momentum: p, energy: (ke + t.projectile.linearPerMu * p) / t.projectile.efficiency, damage: ke * t.damage.hpPerEnergy };
}

export function strikeEnergy(t: ExchangeTable, hp: number): number {
  return Math.max(0, hp) * t.strike.energyPerHp;
}

/** Stamina and energy to redirect a hit carrying `hitEnergy` E with the guard `guardAge` s old. */
export function redirectCost(t: ExchangeTable, guardAge: number, hitEnergy: number, remaining: number, amplify: number): { stamina: number; energy: number } {
  const r = t.reflect;
  const age = Math.max(0, guardAge);
  const amp = Math.max(1, finiteOr(amplify, 1));
  return {
    stamina: r.staminaBase + r.staminaPerAgeSq * age * age + r.staminaPerHitEnergy * hitEnergy,
    energy: ((amp * amp - 1) * remaining) / r.amplifyEfficiency,
  };
}

/**
 * Windup efficiency: preparing an effect for `seconds` multiplies the energy it needs by
 *   factor = 1 − maxSaving · (1 − e^(−seconds / timeConstant))
 * Diminishing returns: the factor approaches 1 − maxSaving but never reaches it, so no amount of
 * waiting makes an effect free. Waiting creates no energy; it only reduces losses.
 */
export function windupFactor(t: ExchangeTable, seconds: number): number {
  const s = Math.max(0, finiteOr0(seconds));
  return 1 - t.windup.maxSaving * (1 - Math.exp(-s / t.windup.timeConstant));
}

/**
 * Preparation only counts if the effect follows it: once preparation ends, every second that
 * passes erodes one second of it. Time cannot be banked.
 */
export function effectiveWindup(prepared: number, endedAt: number | null, now: number): number {
  if (endedAt == null) return Math.max(0, prepared);
  return Math.max(0, prepared - Math.max(0, now - endedAt));
}

/** Seconds of channelling needed to move `energy` from the battery into a charge. */
export function channelSeconds(t: ExchangeTable, energy: number): number {
  return Math.max(0, energy) / t.power.channelRate;
}

/** Inverse of quoteImpulse for a body starting at rest: speed (px/s) that `energy` buys. */
export function speedForEnergy(t: ExchangeTable, energy: number, mass = 1, self = true): number {
  const eff = self ? t.impulse.selfEfficiency : t.impulse.efficiency;
  const lin = t.impulse.linearPerMu;
  const e = Math.max(0, energy) * eff;
  // e = lin·m·s + ½·m·s², s in 100 px/s
  const s = -lin + Math.sqrt(lin * lin + (2 * e) / Math.max(mass, 0.01));
  return s * V_UNIT;
}

/** Projectile speed (px/s) that `energy` buys for a projectile of mass m. */
export function projectileSpeedForEnergy(t: ExchangeTable, energy: number, mass: number): number {
  const lin = t.projectile.linearPerMu;
  const e = Math.max(0, energy) * t.projectile.efficiency;
  const s = -lin + Math.sqrt(lin * lin + (2 * e) / Math.max(mass, 0.01));
  return s * V_UNIT;
}

function finiteOr0(v: number): number {
  return Number.isFinite(v) ? v : 0;
}
function finiteOr(v: number, d: number): number {
  return Number.isFinite(v) ? v : d;
}
