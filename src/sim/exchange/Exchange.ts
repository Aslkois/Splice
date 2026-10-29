import { DT, V_UNIT } from '../config';
import type { Hit } from '../combat/Combat';
import type { Entity } from '../entities/Entity';
import type { ChargeState, Player } from '../entities/Player';
import { clamp, dist, finite, finiteVec, len, norm, scale, sub, type Vec } from '../math';
import type { World } from '../World';
import type { ExchangeTable } from './table';

export interface Cost {
  energy: number;
  stamina: number;
}

export const ZERO_COST: Cost = { energy: 0, stamina: 0 };

/** Energy that was channelled earlier and released into one mechanic execution. */
export interface FundingPool {
  energy: number;
}

export interface Txn {
  id: number;
  time: number;
  actorId: number;
  op: OpId;
  label: string;
  energy: number;
  stamina: number;
  /** Energy produced (absorb, pickups, refunds). */
  gained: number;
  ok: boolean;
  reason?: string;
}

export interface OpResult<T = unknown> {
  ok: boolean;
  reason?: string;
  cost: Cost;
  value?: T;
}

/**
 * A rule an operation must satisfy. `physical` rules always apply.
 * `exchange` rules are the balancing law and are lifted when the sandbox disables it.
 */
interface Check {
  ok: boolean;
  kind: 'physical' | 'exchange';
  reason: string;
}

interface OpContext {
  ex: Exchange;
  world: World;
  actor: Player;
  law: boolean;
}

/** Every operation declares its inputs, costs, constraints, outputs and lifecycle in one place. */
export interface OperationDef<A> {
  id: string;
  label: string;
  inputs: string;
  produces: string;
  constraints: string;
  lifecycle: string;
  checks(c: OpContext, args: A): Check[];
  cost(c: OpContext, args: A): Cost;
  apply(c: OpContext, args: A): unknown;
}

const phys = (ok: boolean, reason: string): Check => ({ ok, kind: 'physical', reason });
const law = (ok: boolean, reason: string): Check => ({ ok, kind: 'exchange', reason });

export interface ImpulseArgs {
  target: Entity;
  /** kg*px/s */
  impulse: Vec;
  label?: string;
}
export interface StrikeArgs {
  target: Entity;
  amount: number;
}
export interface ProjectileArgs {
  dir: Vec;
  speed: number;
  mass: number;
}
export interface HitArgs {
  hit: Hit;
}
export interface RedirectArgs {
  hit: Hit;
  dir: Vec | null;
  amplify: number;
}
export interface ReduceArgs {
  hit: Hit;
  amount: number;
}
export type NoArgs = Record<string, never>;
export interface ConsumeArgs {
  resource: 'energy' | 'stamina';
  amount: number;
}

function impulseEnergy(c: OpContext, a: ImpulseArgs): number {
  const t = c.ex.table.impulse;
  const p = len(a.impulse) / V_UNIT;
  const m = Math.max(a.target.mass, 0.01);
  const d = a.target === c.actor ? 0 : dist(c.actor.pos, a.target.pos);
  const range = d > t.freeRange ? 1 + ((d - t.freeRange) / t.rangeFalloff) ** 2 : 1;
  return ((t.linearPerMu * p + (p * p) / (2 * m)) / t.efficiency) * range;
}

function hitChecks(c: OpContext, hit: Hit): Check[] {
  return [
    phys(hit.phase === 'intercept', 'the hit already landed'),
    phys(hit.victimId === c.actor.id, 'can only intercept hits aimed at yourself'),
  ];
}

function remainingEnergy(hit: Hit): number {
  return Math.max(0, hit.energy - hit.absorbedEnergy);
}

export const OPERATIONS = {
  impulse: {
    id: 'impulse',
    label: 'Impulse',
    inputs: 'target entity, impulse vector (kg*px/s)',
    produces: 'a change of the target\'s momentum',
    constraints: 'target must be a free (non-anchored) body; Δv capped by engine safety',
    lifecycle: 'instant; no cancellation',
    checks: (_c, a) => [phys(a.target.alive, 'target is gone'), phys(a.target.isDynamic, 'target is anchored')],
    cost: (c, a) => ({ energy: impulseEnergy(c, a), stamina: 0 }),
    apply: (c, a) => {
      const maxDv = c.world.physicsLimits.maxBodySpeed;
      const m = a.target.mass;
      let j = finiteVec(a.impulse);
      if (len(j) / m > maxDv) j = scale(norm(j), maxDv * m);
      a.target.applyImpulse(j);
      if (a.target === c.actor && len(j) > 30) c.world.emit({ type: 'thrust', pos: c.actor.pos, dir: norm(j), amount: len(j) / V_UNIT });
      return true;
    },
  } satisfies OperationDef<ImpulseArgs>,

  strike: {
    id: 'strike',
    label: 'Strike',
    inputs: 'target entity, damage (HP)',
    produces: 'a strike hit through the combat pipeline + knockback',
    constraints: 'target within reach, alive and damageable',
    lifecycle: 'instant',
    checks: (c, a) => {
      const b = a.target.bounds();
      const p = c.actor.pos;
      const nx = clamp(p.x, b.minX, b.maxX);
      const ny = clamp(p.y, b.minY, b.maxY);
      const reach = Math.hypot(p.x - nx, p.y - ny);
      return [
        phys(a.target.alive && a.target.damageable, 'nothing to strike'),
        phys(a.target !== c.actor, 'cannot strike yourself'),
        phys(reach <= c.ex.table.strike.reach, `out of reach (${Math.round(reach)}px > ${c.ex.table.strike.reach}px)`),
      ];
    },
    cost: (c, a) => ({ energy: Math.max(0, a.amount) * c.ex.table.strike.energyPerHp, stamina: 0 }),
    apply: (c, a) => {
      const amount = Math.max(0, finite(a.amount));
      const e = amount * c.ex.table.strike.energyPerHp;
      const m = Math.min(a.target.mass, 60);
      const momentum = Math.sqrt(2 * m * e * c.ex.table.strike.knockbackShare);
      const dir = norm(sub(a.target.pos, c.actor.pos), { x: c.actor.facing, y: 0 });
      c.world.combat.submit({
        kind: 'strike',
        attackerId: c.actor.id,
        sourceId: c.actor.id,
        victim: a.target,
        point: { x: (a.target.pos.x + c.actor.pos.x) / 2, y: (a.target.pos.y + c.actor.pos.y) / 2 },
        direction: { x: dir.x, y: dir.y - 0.25 },
        momentum,
        energy: e,
        damage: amount,
      });
      return true;
    },
  } satisfies OperationDef<StrikeArgs>,

  projectile: {
    id: 'projectile',
    label: 'Projectile',
    inputs: 'direction, speed (px/s), mass (kg)',
    produces: 'a kinetic projectile; its damage on impact derives from its kinetic energy. Recoil pushes the shooter.',
    constraints: 'mass and speed clamped to engine limits; projectile count capped',
    lifecycle: 'instant launch; projectile expires after its lifetime',
    checks: (c) => [phys(c.world.projectileCount < c.world.safety.maxProjectiles, 'too many projectiles in the world')],
    cost: (c, a) => {
      const t = c.ex.table.projectile;
      const s = a.speed / V_UNIT;
      const ke = 0.5 * a.mass * s * s;
      const p = a.mass * s;
      return { energy: (ke + t.linearPerMu * p) / t.efficiency, stamina: 0 };
    },
    apply: (c, a) => {
      const dir = norm(a.dir, { x: c.actor.facing, y: 0 });
      const p = c.world.spawnProjectile(
        { x: c.actor.pos.x + dir.x * 26, y: c.actor.pos.y - 4 + dir.y * 30 },
        scale(dir, a.speed),
        { mass: a.mass, ownerId: c.actor.id, team: c.actor.team, style: a.mass >= 3 ? 'slug' : 'spark', life: c.ex.table.projectile.lifetime },
      );
      // Recoil: equal and opposite momentum. Free — it is the reaction, not a new effect.
      c.actor.applyImpulse(scale(dir, -a.mass * a.speed * 0.6));
      return p ? p.id : null;
    },
  } satisfies OperationDef<ProjectileArgs>,

  guardUp: {
    id: 'guardUp',
    label: 'Raise Guard',
    inputs: '—',
    produces: 'an active guard. Guarded frontal hits are mitigated; redirection becomes possible.',
    constraints: 'not while dashing; guard must have recovered from its last lowering',
    lifecycle: 'stays up until lowered, broken, or stamina runs out; drains stamina while held',
    checks: (c, _a: NoArgs) => [
      phys(!c.actor.isDashing, 'cannot guard mid-dash'),
      law(c.world.time >= c.actor.guard.recoveryUntil, 'guard still recovering'),
    ],
    cost: (c, _a: NoArgs) => (c.actor.guard.active ? ZERO_COST : { energy: 0, stamina: c.ex.table.guard.activateStamina }),
    apply: (c, _a: NoArgs) => {
      if (c.actor.guard.active) return false;
      c.actor.guard.active = true;
      c.actor.guard.raisedAt = c.world.time;
      return true;
    },
  } satisfies OperationDef<NoArgs>,

  redirect: {
    id: 'redirect',
    label: 'Redirect',
    inputs: 'incoming hit, direction (default: back at the attacker), amplification ≥ 1',
    produces: 'the hit\'s force leaves along the new direction instead of landing on you',
    constraints: 'hit must be redirectable and still incoming; guard raised before impact; not already absorbed',
    lifecycle: 'commits immediately on the open hit; resolved with the hit',
    checks: (c, a) => [
      ...hitChecks(c, a.hit),
      phys(a.hit.redirectable, `a ${a.hit.kind} hit cannot be redirected`),
      phys(!a.hit.redirected, 'already redirected'),
      phys(remainingEnergy(a.hit) > 0 || a.hit.energy === 0, 'nothing left to redirect'),
      law(a.hit.guarded, a.hit.blockable ? 'guard was not up before impact' : 'hit is outside your guard'),
    ],
    cost: (c, a) => {
      const t = c.ex.table.reflect;
      const age = Math.max(0, a.hit.guardAge);
      const amp = clamp(finite(a.amplify, 1), 1, t.maxAmplify);
      return {
        stamina: t.staminaBase + t.staminaPerAgeSq * age * age + t.staminaPerHitEnergy * a.hit.energy,
        energy: ((amp * amp - 1) * remainingEnergy(a.hit)) / t.amplifyEfficiency,
      };
    },
    apply: (c, a) => {
      const hit = a.hit;
      let dir = a.dir;
      if (!dir) {
        const attacker = hit.attackerId != null ? c.world.get(hit.attackerId) : null;
        dir =
          attacker && attacker.alive && dist(attacker.pos, hit.point) < 1600
            ? norm(sub(attacker.pos, hit.point))
            : { x: -hit.direction.x, y: -hit.direction.y };
      }
      hit.redirected = true;
      hit.redirectDir = norm(finiteVec(dir), { x: -hit.direction.x, y: -hit.direction.y });
      hit.amplify = clamp(finite(a.amplify, 1), 1, c.ex.table.reflect.maxAmplify);
      return true;
    },
  } satisfies OperationDef<RedirectArgs>,

  prevent: {
    id: 'prevent',
    label: 'Prevent Damage',
    inputs: 'incoming hit',
    produces: 'the hit deals no health damage',
    constraints: 'the hit must still be incoming and aimed at you',
    lifecycle: 'commits on the open hit',
    checks: (c, a) => hitChecks(c, a.hit),
    cost: (c, a) => {
      if (a.hit.prevented) return ZERO_COST;
      const t = c.ex.table.prevent;
      if (a.hit.redirected) return { energy: t.afterRedirectEnergy, stamina: 0 };
      return { energy: c.world.combat.projectedDamage(a.hit) * t.energyPerHp, stamina: 0 };
    },
    apply: (_c, a) => {
      a.hit.prevented = true;
      return true;
    },
  } satisfies OperationDef<HitArgs>,

  reduce: {
    id: 'reduce',
    label: 'Reduce Damage',
    inputs: 'incoming hit, amount (HP)',
    produces: 'removes up to `amount` HP from the hit',
    constraints: 'the hit must still be incoming and aimed at you',
    lifecycle: 'commits on the open hit',
    checks: (c, a) => hitChecks(c, a.hit),
    cost: (c, a) => {
      const amt = Math.min(Math.max(0, finite(a.amount)), c.world.combat.projectedDamage(a.hit));
      return { energy: amt * c.ex.table.reduce.energyPerHp, stamina: 0 };
    },
    apply: (c, a) => {
      const amt = Math.min(Math.max(0, finite(a.amount)), c.world.combat.projectedDamage(a.hit));
      a.hit.reduction += amt;
      return amt;
    },
  } satisfies OperationDef<ReduceArgs>,

  absorb: {
    id: 'absorb',
    label: 'Absorb',
    inputs: 'incoming hit',
    produces: 'stores part of the hit\'s kinetic energy in your battery; the absorbed share deals no damage',
    constraints: 'guard raised before impact; energy not already redirected; limited by free battery capacity',
    lifecycle: 'commits on the open hit',
    checks: (c, a) => [
      ...hitChecks(c, a.hit),
      phys(!a.hit.redirected, 'the energy was already redirected'),
      phys(remainingEnergy(a.hit) > 0, 'nothing left to absorb'),
      law(a.hit.guarded, 'guard was not up before impact'),
      law(c.actor.account.energy < c.actor.account.capacity - 0.01, 'battery is full'),
    ],
    cost: (c, a) => ({ energy: 0, stamina: absorbAmount(c, a.hit) * c.ex.table.absorb.staminaPerEnergy }),
    apply: (c, a) => {
      const amount = absorbAmount(c, a.hit);
      a.hit.absorbedEnergy += amount;
      const gain = amount * c.ex.table.absorb.efficiency;
      c.ex.credit(c.actor, gain, 'Absorb');
      return amount;
    },
  } satisfies OperationDef<HitArgs>,

  consume: {
    id: 'consume',
    label: 'Consume',
    inputs: 'resource, amount',
    produces: 'nothing — spends the resource (use it to gate your own logic behind a real cost)',
    constraints: 'amount ≥ 0',
    lifecycle: 'instant',
    checks: () => [],
    cost: (_c, a) =>
      a.resource === 'energy' ? { energy: Math.max(0, finite(a.amount)), stamina: 0 } : { energy: 0, stamina: Math.max(0, finite(a.amount)) },
    apply: () => true,
  } satisfies OperationDef<ConsumeArgs>,
} as const;

export type OpId = keyof typeof OPERATIONS | 'dash' | 'guard' | 'channel' | 'pickup' | 'refund';

function absorbAmount(c: OpContext, hit: Hit): number {
  const acc = c.actor.account;
  const room = Math.max(0, acc.capacity - acc.energy);
  const eff = c.ex.table.absorb.efficiency;
  return Math.min(remainingEnergy(hit), room / eff);
}

/**
 * The single authority over resources. Every effect that costs something goes through `perform`,
 * which validates eligibility and funds for the whole cost before committing anything.
 */
export class Exchange {
  private nextTxn = 1;
  readonly log: Txn[] = [];
  /** Energy spent by successful operations since this world began. */
  totalSpent = 0;

  constructor(
    private world: World,
    public table: ExchangeTable,
  ) {}

  get law(): boolean {
    return this.world.lawEnabled;
  }

  beginTick(): void {
    const p = this.world.player;
    if (p) p.account.burstUsed = 0;
  }

  perform<K extends keyof typeof OPERATIONS>(
    opId: K,
    actor: Player,
    args: Parameters<(typeof OPERATIONS)[K]['cost']>[1],
    funding?: FundingPool | null,
  ): OpResult {
    const op = OPERATIONS[opId] as unknown as OperationDef<unknown>;
    const lawOn = this.law;
    const c: OpContext = { ex: this, world: this.world, actor, law: lawOn };
    if (!actor.alive) return this.fail(actor, opId, op.label, 'you are down', ZERO_COST);
    for (const chk of op.checks(c, args)) {
      if (chk.ok) continue;
      if (chk.kind === 'exchange' && !lawOn) continue;
      return this.fail(actor, opId, op.label, chk.reason, ZERO_COST);
    }
    const raw = op.cost(c, args);
    const cost: Cost = lawOn ? { energy: sanitize(raw.energy), stamina: sanitize(raw.stamina) } : ZERO_COST;
    const pay = this.canPay(actor, cost, funding);
    if (!pay.ok) return this.fail(actor, opId, op.label, pay.reason, cost);
    this.commit(actor, cost, funding);
    const value = op.apply(c, args);
    this.record(actor, opId, op.label, cost, 0, true);
    if (cost.energy > 0.05 || cost.stamina > 0.05)
      this.world.emit({ type: 'spend', pos: actor.pos, energy: cost.energy, stamina: cost.stamina, label: op.label });
    return { ok: true, cost, value };
  }

  /** Read-only: could this cost be paid right now? */
  canPay(actor: Player, cost: Cost, funding?: FundingPool | null): { ok: true } | { ok: false; reason: string } {
    if (!this.law) return { ok: true };
    const a = actor.account;
    if (cost.stamina > a.stamina + 1e-9) return { ok: false, reason: `needs ${fmt(cost.stamina)} stamina (have ${fmt(a.stamina)})` };
    const fromPool = Math.min(funding?.energy ?? 0, cost.energy);
    const fromBattery = cost.energy - fromPool;
    if (fromBattery > a.energy + 1e-9) return { ok: false, reason: `needs ${fmt(cost.energy)}⚡ (have ${fmt(a.energy + (funding?.energy ?? 0))})` };
    if (a.burstUsed + fromBattery > this.table.power.burstPerTick + 1e-9)
      return { ok: false, reason: `over the ${this.table.power.burstPerTick}⚡ instant limit — channel a charge first` };
    return { ok: true };
  }

  private commit(actor: Player, cost: Cost, funding?: FundingPool | null): void {
    if (!this.law) return;
    const a = actor.account;
    const fromPool = Math.min(funding?.energy ?? 0, cost.energy);
    if (funding) funding.energy -= fromPool;
    const fromBattery = cost.energy - fromPool;
    a.energy = Math.max(0, a.energy - fromBattery);
    a.burstUsed += fromBattery;
    this.totalSpent += cost.energy;
    if (cost.stamina > 0) {
      a.stamina = Math.max(0, a.stamina - cost.stamina);
      a.staminaRegenAt = this.world.time + this.table.stamina.regenDelay;
    }
  }

  /** Adds energy from a legitimate source (absorb, pickups, refunds). Capped by capacity. */
  credit(actor: Player, amount: number, label: string): number {
    const a = actor.account;
    const before = a.energy;
    a.energy = clamp(a.energy + Math.max(0, finite(amount)), 0, a.capacity);
    const gained = a.energy - before;
    if (gained > 0) this.record(actor, label === 'Absorb' ? 'absorb' : 'pickup', label, ZERO_COST, gained, true);
    return gained;
  }

  /** Stamina-only body moves (dash). Returns false if unaffordable. */
  payBody(actor: Player, stamina: number, label: string): boolean {
    const cost = { energy: 0, stamina };
    if (!this.law) return true;
    const ok = this.canPay(actor, cost);
    if (!ok.ok) {
      this.fail(actor, 'dash', label, ok.reason, cost);
      return false;
    }
    this.commit(actor, cost);
    this.record(actor, 'dash', label, cost, 0, true);
    return true;
  }

  guardDown(actor: Player): void {
    if (!actor.guard.active) return;
    actor.guard.active = false;
    actor.guard.recoveryUntil = this.world.time + this.table.guard.recovery;
  }

  breakGuard(actor: Player): void {
    if (!actor.guard.active) return;
    actor.guard.active = false;
    actor.guard.recoveryUntil = this.world.time + this.table.guard.recovery + this.table.guard.breakStun;
    actor.stun = Math.max(actor.stun, this.table.guard.breakStun);
    this.world.emit({ type: 'guardBreak', pos: actor.pos });
    this.record(actor, 'guard', 'Guard Broken', ZERO_COST, 0, false, 'out of stamina');
  }

  /** Charges the guard's stamina for soaking a hit. Returns guard effectiveness in [0,1]. */
  strainGuard(actor: Player, strain: number): number {
    if (!this.law) return 1;
    const a = actor.account;
    if (a.stamina >= strain) {
      a.stamina -= strain;
      a.staminaRegenAt = this.world.time + this.table.stamina.regenDelay;
      return 1;
    }
    const eff = a.stamina / strain;
    a.stamina = 0;
    this.breakGuard(actor);
    return eff;
  }

  // ---- charges: battery -> named store, at a limited power. Time is spent, never stored. ----

  beginCharge(actor: Player, name: string): void {
    const ch = actor.account.charges.get(name);
    if (ch) {
      if (!ch.channeling) ch.startedAt = this.world.time;
      ch.channeling = true;
    } else actor.account.charges.set(name, { amount: 0, channeling: true, startedAt: this.world.time });
  }

  stopCharge(actor: Player, name: string): void {
    const ch = actor.account.charges.get(name);
    if (ch) ch.channeling = false;
  }

  /** Empties a charge into a funding pool. Returns the released energy. */
  releaseCharge(actor: Player, name: string): number {
    const ch = actor.account.charges.get(name);
    if (!ch) return 0;
    actor.account.charges.delete(name);
    return ch.amount;
  }

  /** Returns unspent pooled energy to the battery (overflow is lost as heat). */
  refund(actor: Player, amount: number): void {
    if (amount <= 0.001 || !this.law) return;
    const a = actor.account;
    const back = Math.min(amount, a.capacity - a.energy);
    a.energy += Math.max(0, back);
    if (back > 0.05) this.record(actor, 'refund', 'Unspent charge returned', ZERO_COST, back, true);
  }

  tickChannels(actor: Player): void {
    const channeling: ChargeState[] = [];
    for (const ch of actor.account.charges.values()) if (ch.channeling) channeling.push(ch);
    if (!channeling.length) return;
    const share = (this.table.power.channelRate * DT) / channeling.length;
    for (const ch of channeling) {
      if (!this.law) {
        ch.amount += share * 10;
        continue;
      }
      const moved = Math.min(share, actor.account.energy);
      actor.account.energy -= moved;
      ch.amount += moved;
    }
    if (this.world.tick % 6 === 0) this.world.emit({ type: 'chargeTick', pos: actor.pos, amount: channeling.reduce((s, c) => s + c.amount, 0) });
  }

  interruptCharges(actor: Player): void {
    let any = false;
    for (const ch of actor.account.charges.values()) {
      if (!ch.channeling) continue;
      any = true;
      ch.channeling = false;
      ch.amount *= 1 - (this.law ? this.table.charge.interruptLoss : 0);
    }
    if (any) {
      this.world.emit({ type: 'interrupt', pos: actor.pos });
      this.record(actor, 'channel', 'Charge interrupted', ZERO_COST, 0, false, 'hit while channelling');
      this.world.mechanics?.fire('charge.interrupted', {});
    }
  }

  // ---- quotes: pure conversions the Workshop can display and graphs can read ----

  quoteDamage(energy: number): number {
    return Math.max(0, energy) / this.table.strike.energyPerHp;
  }

  /** Largest impulse (kg*px/s) on a body of mass m that `energy` buys at point-blank range. */
  quoteImpulse(energy: number, m = 1): number {
    const t = this.table.impulse;
    const lin = t.linearPerMu;
    const e = Math.max(0, energy) * t.efficiency;
    const p = m * (-lin + Math.sqrt(lin * lin + (2 * e) / m));
    return p * V_UNIT;
  }

  /** Projectile speed (px/s) that `energy` buys for a projectile of mass m. */
  quoteProjectileSpeed(energy: number, m: number): number {
    const t = this.table.projectile;
    const lin = t.linearPerMu;
    const e = Math.max(0, energy) * t.efficiency;
    const s = -lin + Math.sqrt(lin * lin + (2 * e) / Math.max(m, 0.01));
    return s * V_UNIT;
  }

  private fail(actor: Player, op: OpId, label: string, reason: string, cost: Cost): OpResult {
    this.record(actor, op, label, cost, 0, false, reason);
    this.world.emit({ type: 'fizzle', pos: actor.pos, reason });
    return { ok: false, reason, cost };
  }

  private record(actor: Player, op: OpId, label: string, cost: Cost, gained: number, ok: boolean, reason?: string): void {
    const txn: Txn = { id: this.nextTxn++, time: this.world.time, actorId: actor.id, op, label, energy: cost.energy, stamina: cost.stamina, gained, ok, reason };
    this.log.push(txn);
    if (this.log.length > 200) this.log.shift();
  }
}

/** NaN or infinite costs are never free: they are unaffordable. Negative costs clamp to zero. */
function sanitize(v: number): number {
  if (Number.isNaN(v) || v === Infinity) return Number.MAX_VALUE;
  return v > 0 ? v : 0;
}

function fmt(v: number): string {
  if (v >= 1e6) return v.toExponential(2);
  return v >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString();
}
