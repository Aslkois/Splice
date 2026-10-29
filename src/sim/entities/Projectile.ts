import { DT, PHYSICS, V_UNIT } from '../config';
import { len, type Vec } from '../math';
import type { World } from '../World';
import { Entity, type Team } from './Entity';

export type ProjectileStyle = 'bolt' | 'slug' | 'spark';

/**
 * Projectiles are kinematic and swept against the physics world each tick (sub-stepped circle tests),
 * so fast shots never tunnel. Their damage is never a free variable: it is derived from kinetic energy.
 */
export class Projectile extends Entity {
  readonly kind = 'projectile' as const;
  velocity: Vec;
  radius: number;
  pMass: number;
  ownerId: number | null;
  /** Entity that originally fired it (survives reflection, for "return to sender"). */
  originId: number | null;
  life: number;
  style: ProjectileStyle;
  reflections = 0;
  /** Ids this projectile must not hit on the current tick (just reflected off them). */
  ignoreId: number | null = null;
  ignoreUntil = 0;
  trail: Vec[] = [];

  constructor(
    pos: Vec,
    velocity: Vec,
    opts: { mass: number; radius?: number; ownerId: number | null; team: Team; life?: number; style?: ProjectileStyle; gravityScale?: number },
  ) {
    super();
    this._pos = { ...pos };
    this.velocity = { ...velocity };
    this.pMass = opts.mass;
    this.radius = opts.radius ?? Math.max(3, Math.min(18, 3 + Math.sqrt(opts.mass) * 4));
    this.ownerId = opts.ownerId;
    this.originId = opts.ownerId;
    this.team = opts.team;
    this.life = opts.life ?? 4;
    this.style = opts.style ?? 'bolt';
    this.gravityScale = opts.gravityScale ?? 0;
    this.w = this.h = this.radius * 2;
  }

  override get vel(): Vec {
    return { ...this.velocity };
  }
  override set vel(v: Vec) {
    this.velocity = { ...v };
  }
  override get mass(): number {
    return this.pMass;
  }

  /** Kinetic energy in E. */
  get energy(): number {
    const s = len(this.velocity) / V_UNIT;
    return 0.5 * this.pMass * s * s;
  }

  /** Momentum magnitude in mu. */
  get momentum(): number {
    return (this.pMass * len(this.velocity)) / V_UNIT;
  }

  override update(world: World): void {
    this.life -= DT;
    if (this.life <= 0) {
      world.destroy(this, 'expired');
      return;
    }
    this.trail.push({ ...this._pos });
    if (this.trail.length > 8) this.trail.shift();
    if (this.gravityScale) this.velocity.y += PHYSICS.gravity * this.gravityScale * DT;
    world.sweepProjectile(this);
  }
}
