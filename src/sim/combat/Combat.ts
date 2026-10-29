import { MOVEMENT, SAFETY, V_UNIT } from '../config';
import type { Entity } from '../entities/Entity';
import { Player } from '../entities/Player';
import { Projectile } from '../entities/Projectile';
import { add, clampLen, dot, len, norm, scale, type Vec } from '../math';
import type { World } from '../World';

export type HitKind = 'projectile' | 'melee' | 'impact' | 'strike' | 'hazard';

/**
 * An incoming hit, constructed before any damage is applied so that defensive mechanics can
 * intercept it. Interception only ever mutates this record through exchange operations; the
 * final outcome is computed once, at resolution, from the record.
 */
export interface Hit {
  id: number;
  time: number;
  kind: HitKind;
  attackerId: number | null;
  sourceId: number | null;
  victimId: number;
  point: Vec;
  /** Unit vector the incoming force travels along. */
  direction: Vec;
  /** Momentum magnitude in mu (kg * 100px/s). */
  momentum: number;
  /** Kinetic energy carried, in E. */
  energy: number;
  baseDamage: number;
  /** The hit's kind allows guarding AND it arrives inside the guard arc. */
  blockable: boolean;
  redirectable: boolean;

  phase: 'intercept' | 'resolved';
  /** Guard was raised strictly before the hit was constructed. */
  guarded: boolean;
  guardAge: number;
  guardEffectiveness: number;
  redirected: boolean;
  redirectDir: Vec | null;
  amplify: number;
  absorbedEnergy: number;
  prevented: boolean;
  reduction: number;
  finalDamage: number;
  lethal: boolean;
}

export interface HitSubmission {
  kind: HitKind;
  attackerId: number | null;
  sourceId: number | null;
  victim: Entity;
  point: Vec;
  direction: Vec;
  momentum: number;
  energy: number;
  /** Health damage. Omitted → derived from energy through the exchange table. */
  damage?: number;
  projectile?: Projectile;
}

const BLOCKABLE_KINDS: Record<HitKind, boolean> = {
  projectile: true,
  melee: true,
  impact: true,
  strike: true,
  hazard: false,
};
const REDIRECTABLE_KINDS: Record<HitKind, boolean> = {
  projectile: true,
  melee: true,
  impact: true,
  strike: false,
  hazard: false,
};

export class CombatSystem {
  private nextHitId = 1;
  /** Hits currently being intercepted (stack: a reflected projectile can't re-enter, but keep it general). */
  readonly open: Hit[] = [];

  constructor(private world: World) {}

  /** Damage the hit would deal if resolved right now. */
  projectedDamage(hit: Hit): number {
    if (hit.prevented) return 0;
    let dmg = hit.baseDamage;
    if (hit.energy > 0 && hit.absorbedEnergy > 0) dmg *= Math.max(0, 1 - hit.absorbedEnergy / hit.energy);
    if (hit.guarded) dmg *= 1 - this.world.exchange.table.guard.mitigation * hit.guardEffectiveness;
    dmg -= hit.reduction;
    return Math.max(0, dmg);
  }

  isFrontal(victim: Entity, direction: Vec): boolean {
    const arc = (this.world.exchange.table.guard.arcDegrees * Math.PI) / 180;
    const incomingFrom = { x: -direction.x, y: -direction.y };
    const c = dot(norm(incomingFrom), { x: victim.facing, y: 0 });
    return Math.acos(Math.max(-1, Math.min(1, c))) <= arc / 2 + 1e-6;
  }

  submit(sub: HitSubmission): Hit | null {
    const world = this.world;
    const victim = sub.victim;
    if (!victim.alive || !victim.damageable) return null;
    const t = world.exchange.table;
    const direction = norm(sub.direction, { x: 1, y: 0 });
    const energy = Math.max(0, Math.min(sub.energy, SAFETY.maxDamage));
    const baseDamage = Math.min(SAFETY.maxDamage, Math.max(0, sub.damage ?? energy * t.damage.hpPerEnergy));

    // Stage 2: construct the incoming hit.
    const hit: Hit = {
      id: this.nextHitId++,
      time: world.time,
      kind: sub.kind,
      attackerId: sub.attackerId,
      sourceId: sub.sourceId,
      victimId: victim.id,
      point: { ...sub.point },
      direction,
      momentum: Math.max(0, sub.momentum),
      energy,
      baseDamage,
      blockable: BLOCKABLE_KINDS[sub.kind] && this.isFrontal(victim, direction),
      redirectable: REDIRECTABLE_KINDS[sub.kind],
      phase: 'intercept',
      guarded: false,
      guardAge: -1,
      guardEffectiveness: 1,
      redirected: false,
      redirectDir: null,
      amplify: 1,
      absorbedEnergy: 0,
      prevented: false,
      reduction: 0,
      finalDamage: 0,
      lethal: false,
    };

    if (victim instanceof Player) {
      const g = victim.guard;
      if (g.active && g.raisedAt < hit.time && hit.blockable) {
        hit.guarded = true;
        hit.guardAge = hit.time - g.raisedAt;
      }
    }
    hit.lethal = this.projectedDamage(hit) >= victim.hp;

    // Stage 3/4: defensive mechanics intercept synchronously, in documented order:
    // every "On Incoming Hit" handler first, then (if guarded) every "On Successful Block" handler.
    if (victim instanceof Player && world.mechanics && world.player === victim) {
      this.open.push(hit);
      try {
        world.mechanics.fireSync('hit.incoming', { hit });
        if (hit.guarded) world.mechanics.fireSync('block.success', { hit });
      } finally {
        this.open.pop();
      }
    }

    // Guard strain (only when the energy was not sent elsewhere).
    if (hit.guarded && !hit.redirected && victim instanceof Player) {
      const blockedHp = Math.max(0, hit.baseDamage * (1 - hit.absorbedEnergy / Math.max(hit.energy, 1e-9))) * t.guard.mitigation;
      const strain = blockedHp * t.guard.staminaPerBlockedHp;
      if (strain > 0) {
        const ok = world.exchange.strainGuard(victim, strain);
        if (ok < 1) hit.guardEffectiveness = ok;
      }
    }

    // Stage 5/6: remaining damage and lethality.
    hit.finalDamage = this.projectedDamage(hit);
    hit.lethal = hit.finalDamage >= victim.hp;
    hit.phase = 'resolved';

    // Stage 7: commit.
    this.commit(hit, sub, victim);
    return hit;
  }

  private commit(hit: Hit, sub: HitSubmission, victim: Entity): void {
    const world = this.world;
    const proj = sub.projectile;
    const source = hit.sourceId != null ? world.get(hit.sourceId) : null;
    const remainingFraction = hit.energy > 0 ? Math.max(0, 1 - hit.absorbedEnergy / hit.energy) : 1;

    if (hit.redirected && hit.redirectDir) {
      const dir = norm(hit.redirectDir);
      const amp = hit.amplify;
      if (proj && proj.alive) {
        const speed = len(proj.velocity) * amp * Math.sqrt(remainingFraction);
        proj.velocity = scale(dir, Math.min(speed, world.physicsLimits.maxProjectileSpeed));
        proj.ownerId = victim.id;
        proj.team = victim.team;
        proj.reflections++;
        proj.life = Math.max(proj.life, 2.5);
        proj.pos = add(hit.point, scale(dir, proj.radius + 4));
        proj.trail = [];
      } else if (source && source.alive) {
        source.applyImpulse(clampLen(scale(dir, hit.momentum * amp * V_UNIT), world.physicsLimits.maxBodySpeed * source.mass));
        source.stun = Math.max(source.stun, 0.9);
        const back = hit.baseDamage * amp * remainingFraction;
        if (back > 0 && source.damageable) world.damageEntity(source, back, hit.point, dir, victim.id);
      }
      // Newton's third law: redirecting still shoves the defender a little.
      victim.applyImpulse(scale(dir, -hit.momentum * 0.12 * V_UNIT));
      world.emit({ type: 'parry', pos: hit.point, dir, energy: hit.energy * amp * amp, amplify: amp });
      const stop = Math.min(0.2, 0.06 + Math.sqrt(hit.energy * amp * amp) * 0.006);
      world.emit({ type: 'hitstop', duration: stop });
      world.emit({ type: 'shake', intensity: Math.min(14, 3 + Math.sqrt(hit.energy) * 0.5), duration: 0.18 });
    } else {
      if (proj && proj.alive) world.destroy(proj, 'impact');
      let knock = hit.momentum * V_UNIT * remainingFraction;
      if (hit.guarded) knock *= 0.45;
      const kdir = hit.kind === 'hazard' ? { x: hit.direction.x * 0.3, y: -1 } : hit.direction;
      if (victim.isDynamic && hit.kind !== 'impact') victim.applyImpulse(clampLen(scale(norm(kdir), knock), world.physicsLimits.maxBodySpeed * victim.mass * 0.5));
      if (hit.guarded) world.emit({ type: 'guard', pos: hit.point, dir: hit.direction, energy: hit.energy });
      else world.emit({ type: 'impact', pos: hit.point, normal: scale(hit.direction, -1), energy: hit.energy, material: victim.material });
    }
    if (hit.absorbedEnergy > 0) world.emit({ type: 'absorb', pos: hit.point, energy: hit.absorbedEnergy });
    if (hit.prevented && hit.baseDamage > 0) world.emit({ type: 'negate', pos: victim.pos, amount: hit.baseDamage });

    if (hit.finalDamage > 0) {
      world.damageEntity(victim, hit.finalDamage, hit.point, hit.direction, hit.attackerId, hit);
      if (victim instanceof Player && !hit.guarded) victim.stun = Math.max(victim.stun, MOVEMENT.hitStun);
    }
  }

  /** Small helper for hazards like spikes. */
  hazard(victim: Entity, point: Vec, damage: number): void {
    this.submit({
      kind: 'hazard',
      attackerId: null,
      sourceId: null,
      victim,
      point,
      direction: { x: 0, y: 1 },
      momentum: 6.5,
      energy: damage,
      damage,
    });
  }
}

