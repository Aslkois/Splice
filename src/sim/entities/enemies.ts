import Matter from 'matter-js';
import { DT, V_UNIT } from '../config';
import { clamp, dist, norm, sub, type Vec } from '../math';
import type { World } from '../World';
import { CAT, Entity } from './Entity';

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Static emplacement that tracks the player and fires kinetic bolts after a visible windup. */
export class Turret extends Entity {
  readonly kind = 'turret' as const;
  aim: number;
  cooldown: number;
  windup = 0;
  interval: number;
  range: number;
  shotSpeed = 760;
  shotMass = 0.4;

  constructor(x: number, y: number, opts: { facing?: -1 | 1; interval?: number; range?: number; hp?: number; tag?: string }) {
    super();
    this.team = 'enemy';
    this.damageable = true;
    this.material = 'metal';
    this.maxHp = this.hp = opts.hp ?? 60;
    this.facing = opts.facing ?? -1;
    this.interval = opts.interval ?? 1.7;
    this.range = opts.range ?? 640;
    this.cooldown = 0.8;
    this.aim = this.facing > 0 ? 0 : Math.PI;
    this.tag = opts.tag;
    this.w = 44;
    this.h = 40;
    this.body = Matter.Bodies.rectangle(x, y, this.w, this.h, {
      isStatic: true,
      collisionFilter: { category: CAT.ENEMY, mask: CAT.PLAYER | CAT.PROP | CAT.ENEMY },
      label: 'turret',
    });
  }

  muzzle(): Vec {
    const p = this.pos;
    return { x: p.x + Math.cos(this.aim) * 34, y: p.y - 4 + Math.sin(this.aim) * 34 };
  }

  override update(world: World): void {
    this.stun = Math.max(0, this.stun - DT);
    const player = world.player;
    if (!player || !player.alive || this.stun > 0) {
      this.windup = 0;
      return;
    }
    const p = this.pos;
    const target = player.pos;
    const d = dist(p, target);
    const base = this.facing > 0 ? 0 : Math.PI;
    const desired = Math.atan2(target.y - p.y, target.x - p.x);
    const withinArc = Math.abs(angleDiff(base, desired)) < 1.45;
    const sees = d < this.range && withinArc && world.lineOfSight({ x: p.x, y: p.y - 4 }, target, [this.id, player.id]);
    if (sees) {
      const delta = angleDiff(this.aim, desired);
      this.aim += clamp(delta, -3.2 * DT, 3.2 * DT);
    }
    this.cooldown -= DT;
    if (this.windup > 0) {
      this.windup -= DT;
      if (this.windup <= 0) {
        const dir = { x: Math.cos(this.aim), y: Math.sin(this.aim) };
        world.spawnProjectile(this.muzzle(), { x: dir.x * this.shotSpeed, y: dir.y * this.shotSpeed }, {
          mass: this.shotMass,
          ownerId: this.id,
          team: 'enemy',
          style: 'bolt',
        });
        this.cooldown = this.interval;
      }
    } else if (sees && this.cooldown <= 0) {
      this.windup = 0.38;
      world.emit({ type: 'telegraph', pos: this.muzzle(), entityId: this.id, duration: this.windup });
    }
  }
}

/** Patrolling ground drone that telegraphs a lunge. Its lunge is a blockable, redirectable melee hit. */
export class Walker extends Entity {
  readonly kind = 'walker' as const;
  state: 'patrol' | 'windup' | 'lunge' | 'recover' = 'patrol';
  stateTime = 0;
  lungeHit = false;
  patrolSpeed = 85;
  lungeSpeed = 560;
  meleeDamage = 16;

  constructor(x: number, y: number, tag?: string) {
    super();
    this.team = 'enemy';
    this.damageable = true;
    this.living = true;
    this.material = 'metal';
    this.maxHp = this.hp = 45;
    this.tag = tag;
    this.w = 38;
    this.h = 34;
    this.body = Matter.Bodies.rectangle(x, y, this.w, this.h, {
      chamfer: { radius: 10 },
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0,
      inertia: Infinity,
      collisionFilter: { category: CAT.ENEMY, mask: CAT.SOLID | CAT.PLAYER | CAT.PROP | CAT.ENEMY | CAT.GATE },
      label: 'walker',
    });
    Matter.Body.setMass(this.body, 2.5);
    Matter.Body.setInertia(this.body, Infinity);
  }

  override update(world: World): void {
    if (!this.body) return;
    this.stateTime += DT;
    const v = this.vel;
    const grounded = world.isGrounded(this);
    if (this.stun > 0) {
      this.stun -= DT;
      if (grounded) v.x *= 0.85;
      this.vel = v;
      this.state = 'recover';
      this.stateTime = 0;
      return;
    }
    const player = world.player;
    const p = this.pos;
    switch (this.state) {
      case 'patrol': {
        if (grounded) {
          const ahead = { x: p.x + this.facing * (this.w / 2 + 8), y: p.y + this.h / 2 + 10 };
          const wall = { x: p.x + this.facing * (this.w / 2 + 6), y: p.y };
          if (!world.solidAt(ahead, this.id) || world.solidAt(wall, this.id)) this.facing = this.facing > 0 ? -1 : 1;
          v.x = this.facing * this.patrolSpeed;
        }
        if (player && player.alive) {
          const dx = player.pos.x - p.x;
          const dy = player.pos.y - p.y;
          if (Math.abs(dx) < 300 && Math.abs(dy) < 90 && Math.sign(dx) === this.facing && world.lineOfSight(p, player.pos, [this.id, player.id])) {
            this.state = 'windup';
            this.stateTime = 0;
            world.emit({ type: 'telegraph', pos: p, entityId: this.id, duration: 0.5 });
          }
        }
        break;
      }
      case 'windup':
        v.x *= 0.7;
        if (this.stateTime >= 0.5) {
          this.state = 'lunge';
          this.stateTime = 0;
          this.lungeHit = false;
          v.x = this.facing * this.lungeSpeed;
          v.y = -160;
        }
        break;
      case 'lunge':
        if (this.stateTime >= 0.42 || (grounded && this.stateTime > 0.15 && Math.abs(v.x) < 60)) {
          this.state = 'recover';
          this.stateTime = 0;
        }
        break;
      case 'recover':
        if (grounded) v.x *= 0.8;
        if (this.stateTime >= 0.85) {
          this.state = 'patrol';
          this.stateTime = 0;
        }
        break;
    }
    this.vel = v;
  }

  /** Checks lunge contact with the player and submits a melee hit. */
  postPhysics(world: World): void {
    const player = world.player;
    if (this.state !== 'lunge' || this.lungeHit || !player || !player.alive) return;
    const a = this.bounds();
    const b = player.bounds();
    const pad = 6;
    if (a.maxX + pad < b.minX || a.minX - pad > b.maxX || a.maxY + pad < b.minY || a.minY - pad > b.maxY) return;
    this.lungeHit = true;
    const speed = Math.max(Math.abs(this.vel.x), this.lungeSpeed * 0.6);
    const energy = 0.5 * this.mass * (speed / V_UNIT) ** 2;
    const dir = norm(sub(player.pos, this.pos), { x: this.facing, y: 0 });
    world.combat.submit({
      kind: 'melee',
      attackerId: this.id,
      sourceId: this.id,
      victim: player,
      point: { x: (this.pos.x + player.pos.x) / 2, y: player.pos.y },
      direction: { x: Math.sign(dir.x) || this.facing, y: -0.15 },
      momentum: (this.mass * speed) / V_UNIT,
      energy,
      damage: this.meleeDamage,
    });
  }
}

/** A heavy emplacement whose slug carries enough kinetic energy to be lethal through a guard. */
export class Cannon extends Entity {
  readonly kind = 'cannon' as const;
  phase: 'idle' | 'charge' | 'reload' = 'idle';
  phaseTime = 0;
  aim: number;
  locked = false;
  chargeTime = 2.6;
  slugMass = 6;
  slugSpeed = 1150;

  constructor(x: number, y: number, opts: { facing?: -1 | 1; tag?: string; hp?: number }) {
    super();
    this.team = 'enemy';
    this.damageable = true;
    this.material = 'metal';
    this.maxHp = this.hp = opts.hp ?? 350;
    this.facing = opts.facing ?? -1;
    this.tag = opts.tag;
    this.aim = this.facing > 0 ? 0 : Math.PI;
    this.w = 96;
    this.h = 74;
    this.body = Matter.Bodies.rectangle(x, y, this.w, this.h, {
      isStatic: true,
      chamfer: { radius: 12 },
      collisionFilter: { category: CAT.ENEMY, mask: CAT.PLAYER | CAT.PROP | CAT.ENEMY },
      label: 'cannon',
    });
  }

  muzzle(): Vec {
    const p = this.pos;
    return { x: p.x + Math.cos(this.aim) * 64, y: p.y - 6 + Math.sin(this.aim) * 64 };
  }

  get chargeProgress(): number {
    return this.phase === 'charge' ? clamp(this.phaseTime / this.chargeTime, 0, 1) : 0;
  }

  override update(world: World): void {
    this.phaseTime += DT;
    this.stun = Math.max(0, this.stun - DT);
    const player = world.player;
    const p = this.pos;
    const sees =
      !!player && player.alive && dist(p, player.pos) < 1500 && world.lineOfSight({ x: p.x, y: p.y - 6 }, player.pos, [this.id, player.id]);
    const base = this.facing > 0 ? 0 : Math.PI;
    if (player && sees && !this.locked) {
      const desired = Math.atan2(player.pos.y - (p.y - 6), player.pos.x - p.x);
      const clamped = base + clamp(angleDiff(base, desired), -1.1, 1.1);
      this.aim += clamp(angleDiff(this.aim, clamped), -2.4 * DT, 2.4 * DT);
    }
    switch (this.phase) {
      case 'idle':
        if (sees && this.phaseTime > 1.0 && this.stun <= 0) {
          this.phase = 'charge';
          this.phaseTime = 0;
          this.locked = false;
          world.emit({ type: 'telegraph', pos: this.muzzle(), entityId: this.id, duration: this.chargeTime });
        }
        break;
      case 'charge':
        if (this.stun > 0) {
          this.phase = 'reload';
          this.phaseTime = 0;
          break;
        }
        if (this.phaseTime > this.chargeTime - 0.35) this.locked = true;
        if (this.phaseTime >= this.chargeTime) {
          const dir = { x: Math.cos(this.aim), y: Math.sin(this.aim) };
          world.spawnProjectile(this.muzzle(), { x: dir.x * this.slugSpeed, y: dir.y * this.slugSpeed }, {
            mass: this.slugMass,
            radius: 13,
            ownerId: this.id,
            team: 'enemy',
            style: 'slug',
            life: 3,
          });
          world.emit({ type: 'shake', intensity: 7, duration: 0.25 });
          this.phase = 'reload';
          this.phaseTime = 0;
          this.locked = false;
        }
        break;
      case 'reload':
        if (this.phaseTime >= 1.8) {
          this.phase = 'idle';
          this.phaseTime = 0;
        }
        break;
    }
  }
}
