import { DT, V_UNIT } from '../config';
import type { Hit } from '../combat/Combat';
import type { Entity } from '../entities/Entity';
import type { ChargeState, Player } from '../entities/Player';
import { clamp, dist, finite, finiteVec, len, norm, scale, sub, type Vec } from '../math';
import type { World } from '../World';
import {
  effectiveWindup,
  projectileSpeedForEnergy,
  quoteImpulse as priceImpulse,
  quoteProjectile,
  redirectCost,
  speedForEnergy,
  strikeEnergy,
  windupFactor,
  type PriceLine,
} from './formulas';
import type { ExchangeTable } from './table';

export interface Cost {
  energy: number;
  stamina: number;
}

export const ZERO_COST: Cost = { energy: 0, stamina: 0 };

/**
 * What one mechanic execution has prepared: energy released out of charges (spent before the
 * reservoir, and allowed to exceed it) and how long it wound up for.
 */
export interface FundingPool {
  energy: number;
  /** Seconds of preparation behind this execution. */
  windup: number;
  /** When that preparation ended (null: still going / none). Preparation erodes after it ends. */
  windupEndedAt: number | null;
}

export function emptyPool(): FundingPool {
  return { energy: 0, windup: 0, windupEndedAt: null };
}

/** How a price was reached — shown in the debugger and the Workshop, never recomputed separately. */
export interface CostQuote {
  /** Price before windup. */
  base: Cost;
  /** Effective preparation (s) and the multiplier it gave the energy price. */
  windup: number;
  factor: number;
  /** What was (or would be) charged. */
  cost: Cost;
  /** Where the energy came from. */
  fromPool: number;
  fromReservoir: number;
  /** Energy that could be spent right then: released charge + reservoir. */
  available: number;
  /** Operation-specific figures (requested impulse, Δv, kinetic energy…). */
  lines: PriceLine[];
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
  failKind?: FailKind;
}

/**
 * Why an operation failed, so diagnostics can tell problems apart:
 *   resources   — not enough energy or stamina, or a full battery
 *   target      — the target is missing, gone, anchored, out of reach, or the wrong kind
 *   requirement — a timing/eligibility rule: guard not raised before impact, hit already landed…
 *   limit       — an engine safety limit (e.g. too many projectiles)
 */
export type FailKind = 'resources' | 'target' | 'requirement' | 'limit';

export interface OpResult<T = unknown> {
  ok: boolean;
  reason?: string;
  failKind?: FailKind;
  cost: Cost;
  value?: T;
  quote?: CostQuote;
}

/**
 * A rule an operation must satisfy. `physical` rules always apply.
 * `exchange` rules are the balancing law and are lifted when the sandbox disables it.
 */
interface Check {
  ok: boolean;
  kind: 'physical' | 'exchange';
  reason: string;
  cat: FailKind;
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
  /** Converts energy into an effect, so preparation (windup) makes it cheaper. */
  windup: boolean;
  checks(c: OpContext, args: A): Check[];
  cost(c: OpContext, args: A): Cost;
  /** Figures behind the price, for the debugger and Workshop. */
  explain?(c: OpContext, args: A): PriceLine[];
  apply(c: OpContext, args: A): unknown;
}

const phys = (ok: boolean, reason: string, cat: FailKind = 'target'): Check => ({ ok, kind: 'physical', reason, cat });
const law = (ok: boolean, reason: string, cat: FailKind = 'requirement'): Check => ({ ok, kind: 'exchange', reason, cat });

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

function impulseQuote(c: OpContext, a: ImpulseArgs) {
  return priceImpulse(c.ex.table, {
    mass: a.target.mass,
    velocity: a.target.vel,
    impulse: a.impulse,
    self: a.target === c.actor,
    distance: dist(c.actor.pos, a.target.pos),
    maxSpeed: c.world.physicsLimits.maxBodySpeed,
  });
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function hitChecks(c: OpContext, hit: Hit): Check[] {
  return [
    phys(hit.phase === 'intercept', 'the hit already landed', 'requirement'),
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
    windup: true,
    checks: (_c, a) => [phys(a.target.alive, 'target is gone'), phys(a.target.isDynamic, 'target is anchored')],
    cost: (c, a) => ({ energy: impulseQuote(c, a).energy, stamina: 0 }),
    explain: (c, a) => {
      const q = impulseQuote(c, a);
      const v0 = a.target.vel;
      return [
        { label: 'Requested impulse', value: r1(len(finiteVec(a.impulse))), unit: 'kg·px/s' },
        { label: 'Target mass', value: r1(a.target.mass * 100) / 100, unit: 'kg' },
        { label: 'Velocity change', value: r1(q.deltaV), unit: 'px/s' },
        { label: 'Speed before', value: r1(len(v0)), unit: 'px/s' },
        { label: 'Kinetic energy gained', value: r1(q.deltaKE), unit: 'E' },
        { label: 'Momentum term', value: r1(c.ex.table.impulse.linearPerMu * q.momentum), unit: 'E' },
        { label: 'Efficiency', value: q.efficiency, unit: '×' },
        ...(q.rangeFactor > 1 ? [{ label: 'Range factor', value: r1(q.rangeFactor * 100) / 100, unit: '×' }] : []),
      ];
    },
    apply: (c, a) => {
      const j = impulseQuote(c, a).impulse;
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
    windup: true,
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
    cost: (c, a) => ({ energy: strikeEnergy(c.ex.table, finite(a.amount)), stamina: 0 }),
    explain: (c, a) => [{ label: 'Damage', value: r1(Math.max(0, finite(a.amount))), unit: 'HP' }, { label: 'Price per HP', value: c.ex.table.strike.energyPerHp, unit: 'E' }],
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
    windup: true,
    checks: (c) => [phys(c.world.projectileCount < c.world.safety.maxProjectiles, 'too many projectiles in the world', 'limit')],
    cost: (c, a) => ({ energy: quoteProjectile(c.ex.table, a.speed, a.mass).energy, stamina: 0 }),
    explain: (c, a) => {
      const q = quoteProjectile(c.ex.table, a.speed, a.mass);
      return [
        { label: 'Speed', value: r1(a.speed), unit: 'px/s' },
        { label: 'Mass', value: a.mass, unit: 'kg' },
        { label: 'Kinetic energy (= damage)', value: r1(q.kineticEnergy), unit: 'E' },
        { label: 'Efficiency', value: c.ex.table.projectile.efficiency, unit: '×' },
      ];
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
    windup: false,
    checks: (c, _a: NoArgs) => [
      phys(!c.actor.isDashing, 'cannot guard mid-dash', 'requirement'),
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
    inputs: 'incoming hit, direction (default: straight back along the incoming path), amplification ≥ 1',
    produces: 'the hit\'s force leaves along the new direction instead of landing on you',
    constraints: 'hit must be redirectable and still incoming; guard raised before impact; not already absorbed',
    lifecycle: 'commits immediately on the open hit; resolved with the hit',
    windup: true,
    checks: (c, a) => [
      ...hitChecks(c, a.hit),
      phys(a.hit.redirectable, `a ${a.hit.kind} hit cannot be redirected`),
      phys(!a.hit.redirected, 'already redirected'),
      phys(remainingEnergy(a.hit) > 0 || a.hit.energy === 0, 'nothing left to redirect'),
      law(a.hit.guarded, a.hit.blockable ? 'guard was not up before impact' : 'hit is outside your guard'),
    ],
    cost: (c, a) => redirectCost(c.ex.table, a.hit.guardAge, a.hit.energy, remainingEnergy(a.hit), a.amplify),
    explain: (_c, a) => [
      { label: 'Incoming energy', value: r1(a.hit.energy), unit: 'E' },
      { label: 'Guard age', value: Math.round(Math.max(0, a.hit.guardAge) * 1000) / 1000, unit: 's' },
      { label: 'Amplify', value: Math.max(1, finite(a.amplify, 1)), unit: '×' },
    ],
    apply: (_c, a) => {
      const hit = a.hit;
      // No direction: retrace the incoming path exactly. A straight shot goes back the way it came,
      // so it returns to its muzzle even when its shooter stands behind cover's edge.
      const dir = a.dir ?? { x: -hit.direction.x, y: -hit.direction.y };
      hit.redirected = true;
      hit.redirectDir = norm(finiteVec(dir), { x: -hit.direction.x, y: -hit.direction.y });
      hit.amplify = Math.max(1, finite(a.amplify, 1));
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
    windup: true,
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
    windup: true,
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
    windup: false,
    checks: (c, a) => [
      ...hitChecks(c, a.hit),
      phys(!a.hit.redirected, 'the energy was already redirected'),
      phys(remainingEnergy(a.hit) > 0, 'nothing left to absorb'),
      law(a.hit.guarded, 'guard was not up before impact'),
      law(c.actor.account.energy < c.actor.account.capacity - 0.01, 'battery is full', 'resources'),
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
    // A deliberate payment, not a conversion: preparation never discounts it.
    windup: false,
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

/** Where energy came from and went, since this world began (or the last respawn). */
export interface EnergyAudit {
  /** Reservoir at the start (or at respawn). */
  start: number;
  /** Energy that entered from legitimate sources: cells, dynamos, absorbed hits, refunds don't count. */
  income: number;
  /** Energy converted into effects. */
  spent: number;
  /** Energy lost: scattered charges, overflow that didn't fit back into the reservoir, charges lost on death. */
  dissipated: number;
}

/**
 * The single authority over resources. Every effect that costs something goes through `perform`,
 * which validates eligibility and funds for the whole cost before committing anything — one
 * transaction at a time, so the same energy can never be spent twice.
 */
export class Exchange {
  private nextTxn = 1;
  readonly log: Txn[] = [];
  /** Energy spent by successful operations since this world began. */
  totalSpent = 0;
  readonly audit: EnergyAudit = { start: 0, income: 0, spent: 0, dissipated: 0 };

  constructor(
    private world: World,
    public table: ExchangeTable,
  ) {}

  get law(): boolean {
    return this.world.lawEnabled;
  }

  /** Called when the player's account is (re)filled at spawn. */
  resetAudit(start: number): void {
    this.audit.start = start;
    this.audit.income = 0;
    this.audit.spent = 0;
    this.audit.dissipated = 0;
  }

  /** Energy held right now: reservoir plus every charge. (Energy released into running executions is not included.) */
  holdings(actor: Player): { reservoir: number; committed: number } {
    let committed = 0;
    for (const ch of actor.account.charges.values()) committed += ch.amount;
    return { reservoir: actor.account.energy, committed };
  }

  /** Effective preparation of a funding pool right now, and the price multiplier it gives. */
  windupOf(funding?: FundingPool | null): { windup: number; factor: number } {
    if (!funding) return { windup: 0, factor: 1 };
    const w = effectiveWindup(funding.windup, funding.windupEndedAt, this.world.time);
    return { windup: w, factor: windupFactor(this.table, w) };
  }

  /**
   * Works out what an operation would cost right now, without doing anything. The Workshop and the
   * debugger show exactly this; `perform` charges exactly this.
   */
  quote<K extends keyof typeof OPERATIONS>(
    opId: K,
    actor: Player,
    args: Parameters<(typeof OPERATIONS)[K]['cost']>[1],
    funding?: FundingPool | null,
  ): CostQuote {
    const op = OPERATIONS[opId] as unknown as OperationDef<unknown>;
    const c: OpContext = { ex: this, world: this.world, actor, law: this.law };
    return this.quoteWith(op, c, args, funding);
  }

  private quoteWith(op: OperationDef<unknown>, c: OpContext, args: unknown, funding?: FundingPool | null): CostQuote {
    const raw = op.cost(c, args);
    const base: Cost = { energy: sanitize(raw.energy), stamina: sanitize(raw.stamina) };
    const { windup, factor } = op.windup ? this.windupOf(funding) : { windup: 0, factor: 1 };
    const cost: Cost = c.law ? { energy: base.energy * factor, stamina: base.stamina } : ZERO_COST;
    const pool = funding?.energy ?? 0;
    const fromPool = Math.min(pool, cost.energy);
    return {
      base,
      windup,
      factor,
      cost,
      fromPool,
      fromReservoir: cost.energy - fromPool,
      available: pool + c.actor.account.energy,
      lines: op.explain?.(c, args) ?? [],
    };
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
    if (!actor.alive) return this.fail(actor, opId, op.label, 'you are down', ZERO_COST, 'requirement');
    for (const chk of op.checks(c, args)) {
      if (chk.ok) continue;
      if (chk.kind === 'exchange' && !lawOn) continue;
      return this.fail(actor, opId, op.label, chk.reason, ZERO_COST, chk.cat);
    }
    const quote = this.quoteWith(op, c, args, funding);
    const cost = quote.cost;
    const pay = this.canPay(actor, cost, funding);
    if (!pay.ok) return { ...this.fail(actor, opId, op.label, pay.reason, cost, 'resources'), quote };
    this.commit(actor, cost, funding);
    const value = op.apply(c, args);
    this.record(actor, opId, op.label, cost, 0, true);
    if (cost.energy > 0.05 || cost.stamina > 0.05)
      this.world.emit({ type: 'spend', pos: actor.pos, energy: cost.energy, stamina: cost.stamina, label: op.label });
    return { ok: true, cost, value, quote };
  }

  /** Read-only: could this cost be paid right now? Released charge energy is used before the reservoir. */
  canPay(actor: Player, cost: Cost, funding?: FundingPool | null): { ok: true } | { ok: false; reason: string } {
    if (!this.law) return { ok: true };
    const a = actor.account;
    if (cost.stamina > a.stamina + 1e-9) return { ok: false, reason: `needs ${fmt(cost.stamina)} stamina (have ${fmt(a.stamina)})` };
    const pool = funding?.energy ?? 0;
    const fromBattery = cost.energy - Math.min(pool, cost.energy);
    if (fromBattery > a.energy + 1e-9) {
      const have = a.energy + pool;
      const short = cost.energy - have;
      const hint = cost.energy > a.capacity ? ' — more than your reservoir holds: commit it to a charge first' : '';
      return { ok: false, reason: `needs ${fmt(cost.energy)}⚡ (have ${fmt(have)}, short ${fmt(short)})${hint}` };
    }
    return { ok: true };
  }

  private commit(actor: Player, cost: Cost, funding?: FundingPool | null): void {
    if (!this.law) return;
    const a = actor.account;
    const fromPool = Math.min(funding?.energy ?? 0, cost.energy);
    if (funding) funding.energy -= fromPool;
    const fromBattery = cost.energy - fromPool;
    a.energy = Math.max(0, a.energy - fromBattery);
    this.totalSpent += cost.energy;
    this.audit.spent += cost.energy;
    if (cost.stamina > 0) {
      a.stamina = Math.max(0, a.stamina - cost.stamina);
      a.staminaRegenAt = this.world.time + this.table.stamina.regenDelay;
    }
  }

  /** Adds energy from a legitimate source (absorb, pickups, dynamos). Capped by capacity. */
  credit(actor: Player, amount: number, label: string): number {
    const a = actor.account;
    const before = a.energy;
    a.energy = clamp(a.energy + Math.max(0, finite(amount)), 0, a.capacity);
    const gained = a.energy - before;
    if (gained > 0) {
      if (this.law) this.audit.income += gained;
      if (label !== 'Dynamo') this.record(actor, label === 'Absorb' ? 'absorb' : 'pickup', label, ZERO_COST, gained, true);
    }
    return gained;
  }

  /** Stamina-only body moves (dash). Returns false if unaffordable. */
  payBody(actor: Player, stamina: number, label: string): boolean {
    const cost = { energy: 0, stamina };
    if (!this.law) return true;
    const ok = this.canPay(actor, cost);
    if (!ok.ok) {
      this.fail(actor, 'dash', label, ok.reason, cost, 'resources');
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
    this.record(actor, 'guard', 'Guard Broken', ZERO_COST, 0, false, 'out of stamina', 'resources');
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

  // ---- charges: reservoir -> named store, at a limited rate. Time is spent, never stored. ----
  //
  // Lifecycle: idle → channelling (energy flows in, preparation accrues) → held (flow stopped;
  // preparation starts eroding) → released into one execution (spent there; leftovers flow back into
  // the reservoir up to its capacity, the overflow is lost) — or interrupted (being hurt scatters
  // part of it; the rest stays held).

  beginCharge(actor: Player, name: string): void {
    const ch = actor.account.charges.get(name);
    const now = this.world.time;
    if (ch) {
      if (!ch.channeling) {
        ch.startedAt = now;
        // Resuming keeps whatever preparation has not eroded yet.
        ch.windup = effectiveWindup(ch.windup, ch.windupEndedAt, now);
        ch.windupEndedAt = null;
      }
      ch.channeling = true;
    } else actor.account.charges.set(name, { amount: 0, channeling: true, startedAt: now, windup: 0, windupEndedAt: null });
  }

  stopCharge(actor: Player, name: string): void {
    const ch = actor.account.charges.get(name);
    if (ch && ch.channeling) {
      ch.channeling = false;
      ch.windupEndedAt = this.world.time;
    }
  }

  /** Effective preparation of a charge right now (seconds). */
  chargeWindup(ch: ChargeState): number {
    return effectiveWindup(ch.windup, ch.channeling ? null : ch.windupEndedAt, this.world.time);
  }

  /** Empties a charge into a funding pool. Returns the released energy and its preparation. */
  releaseCharge(actor: Player, name: string): { energy: number; windup: number } {
    const ch = actor.account.charges.get(name);
    if (!ch) return { energy: 0, windup: 0 };
    actor.account.charges.delete(name);
    return { energy: ch.amount, windup: this.chargeWindup(ch) };
  }

  /** Adds preparation and released energy to an execution's pool. */
  fund(pool: FundingPool, energy: number, windup: number): void {
    const now = this.world.time;
    const prior = effectiveWindup(pool.windup, pool.windupEndedAt, now);
    pool.energy += Math.max(0, energy);
    pool.windup = prior + Math.max(0, windup);
    pool.windupEndedAt = now;
  }

  /** Returns unspent released energy to the reservoir. What doesn't fit is lost as heat. */
  refund(actor: Player, amount: number): void {
    if (amount <= 0.001 || !this.law) return;
    const a = actor.account;
    const back = Math.max(0, Math.min(amount, a.capacity - a.energy));
    a.energy += back;
    const lost = amount - back;
    if (lost > 0) this.audit.dissipated += lost;
    if (back > 0.05) this.record(actor, 'refund', 'Unspent charge returned', ZERO_COST, back, true);
    if (lost > 0.05) this.record(actor, 'refund', 'Overflow lost as heat', ZERO_COST, 0, false, `${fmt(lost)}⚡ did not fit in the reservoir`, 'resources');
  }

  tickChannels(actor: Player): void {
    const channeling: ChargeState[] = [];
    for (const ch of actor.account.charges.values()) if (ch.channeling) channeling.push(ch);
    if (!channeling.length) return;
    const share = (this.table.power.channelRate * DT) / channeling.length;
    for (const ch of channeling) {
      // Preparation accrues while you channel, whether or not energy is flowing.
      ch.windup += DT;
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
    const now = this.world.time;
    for (const ch of actor.account.charges.values()) {
      if (!ch.channeling) continue;
      any = true;
      ch.channeling = false;
      // The preparation is broken, and part of the stored energy scatters.
      ch.windup = 0;
      ch.windupEndedAt = now;
      const lost = this.law ? ch.amount * this.table.charge.interruptLoss : 0;
      ch.amount -= lost;
      this.audit.dissipated += lost;
    }
    if (any) {
      this.world.emit({ type: 'interrupt', pos: actor.pos });
      this.record(actor, 'channel', 'Charge interrupted', ZERO_COST, 0, false, 'hit while channelling', 'requirement');
      this.world.mechanics?.fire('charge.interrupted', {});
    }
  }

  /** Charges are lost when you go down. */
  dropCharges(actor: Player): void {
    for (const ch of actor.account.charges.values()) if (this.law) this.audit.dissipated += ch.amount;
    actor.account.charges.clear();
  }

  // ---- quotes: pure conversions the Workshop can display and graphs can read ----

  quoteDamage(energy: number): number {
    return Math.max(0, energy) / this.table.strike.energyPerHp;
  }

  /** Impulse (kg*px/s) that `energy` buys on your own body of mass m, starting at rest. */
  quoteImpulse(energy: number, m = 1): number {
    return speedForEnergy(this.table, energy, m, true) * m;
  }

  /** Projectile speed (px/s) that `energy` buys for a projectile of mass m. */
  quoteProjectileSpeed(energy: number, m: number): number {
    return projectileSpeedForEnergy(this.table, energy, m);
  }

  private fail(actor: Player, op: OpId, label: string, reason: string, cost: Cost, failKind: FailKind): OpResult {
    this.record(actor, op, label, cost, 0, false, reason, failKind);
    this.world.emit({ type: 'fizzle', pos: actor.pos, reason });
    return { ok: false, reason, cost, failKind };
  }

  private record(actor: Player, op: OpId, label: string, cost: Cost, gained: number, ok: boolean, reason?: string, failKind?: FailKind): void {
    const txn: Txn = { id: this.nextTxn++, time: this.world.time, actorId: actor.id, op, label, energy: cost.energy, stamina: cost.stamina, gained, ok, reason, failKind };
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
