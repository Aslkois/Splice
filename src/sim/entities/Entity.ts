import Matter from 'matter-js';
import type { Vec } from '../math';
import type { World } from '../World';

export type EntityKind =
  | 'player'
  | 'turret'
  | 'walker'
  | 'cannon'
  | 'crate'
  | 'target'
  | 'cell'
  | 'projectile'
  | 'spikes'
  | 'goal'
  | 'door'
  | 'bench'
  | 'sign'
  | 'gate'
  | 'mover';

export type Team = 'player' | 'enemy' | 'neutral';
export type Material = 'metal' | 'wood' | 'flesh' | 'stone' | 'glass';

export const CAT = {
  SOLID: 0x0001,
  PLAYER: 0x0002,
  ENEMY: 0x0004,
  PROP: 0x0008,
  GATE: 0x0010,
};

const STEP_PER_SEC = 60;

export abstract class Entity {
  id = 0;
  abstract readonly kind: EntityKind;
  team: Team = 'neutral';
  body: Matter.Body | null = null;
  hp = 1;
  maxHp = 1;
  damageable = false;
  /** Living things get hurt by hazards and can be "killed" (vs. "broken"). */
  living = false;
  alive = true;
  facing: 1 | -1 = 1;
  tag?: string;
  gravityScale = 1;
  material: Material = 'metal';
  spawnTime = 0;
  lastHurtTime = -999;
  /** Seconds of stagger (enemies) / hit-stun (player). */
  stun = 0;
  protected _pos: Vec = { x: 0, y: 0 };
  /** Size used by bodiless entities and for presentation. */
  w = 0;
  h = 0;

  get pos(): Vec {
    return this.body ? { x: this.body.position.x, y: this.body.position.y } : { x: this._pos.x, y: this._pos.y };
  }

  set pos(p: Vec) {
    if (this.body) Matter.Body.setPosition(this.body, p);
    else this._pos = { x: p.x, y: p.y };
  }

  /** Velocity in px/s. */
  get vel(): Vec {
    if (!this.body) return { x: 0, y: 0 };
    const v = Matter.Body.getVelocity(this.body);
    return { x: v.x * STEP_PER_SEC, y: v.y * STEP_PER_SEC };
  }

  set vel(v: Vec) {
    if (this.body && !this.body.isStatic) Matter.Body.setVelocity(this.body, { x: v.x / STEP_PER_SEC, y: v.y / STEP_PER_SEC });
  }

  get mass(): number {
    return this.body && !this.body.isStatic ? this.body.mass : 1e6;
  }

  get angle(): number {
    return this.body ? this.body.angle : 0;
  }

  get isDynamic(): boolean {
    return !!this.body && !this.body.isStatic;
  }

  /** Axis-aligned bounds in world space. */
  bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (this.body) {
      const b = this.body.bounds;
      return { minX: b.min.x, minY: b.min.y, maxX: b.max.x, maxY: b.max.y };
    }
    const p = this._pos;
    return { minX: p.x - this.w / 2, minY: p.y - this.h / 2, maxX: p.x + this.w / 2, maxY: p.y + this.h / 2 };
  }

  /** Applies a momentum change (kg*px/s). Raw physics: callers are responsible for any exchange accounting. */
  applyImpulse(j: Vec): void {
    if (!this.isDynamic) return;
    const v = this.vel;
    const m = this.mass;
    this.vel = { x: v.x + j.x / m, y: v.y + j.y / m };
  }

  update(_world: World): void {}
  onDestroyed(_world: World): void {}
}
