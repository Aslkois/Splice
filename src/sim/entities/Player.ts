import Matter from 'matter-js';
import { DT, MOVEMENT, PHYSICS, PLAYER } from '../config';
import { anyHeld, anyPressed, BINDINGS, EMPTY_INPUT, type InputFrame } from '../input';
import { approach, clamp, sign } from '../math';
import type { World } from '../World';
import { CAT, Entity } from './Entity';

/** Energy committed to a named charge, held apart from the reservoir. It may exceed the reservoir's capacity. */
export interface ChargeState {
  amount: number;
  channeling: boolean;
  startedAt: number;
  /** Seconds of preparation (time spent channelling). */
  windup: number;
  /** When channelling last stopped; preparation erodes from then on. */
  windupEndedAt: number | null;
}

/** Resource account owned by an actor. Mutated only through the exchange ledger. */
export interface ResourceAccount {
  energy: number;
  capacity: number;
  stamina: number;
  staminaMax: number;
  /** Time at which stamina may start regenerating again. */
  staminaRegenAt: number;
  charges: Map<string, ChargeState>;
}

export interface GuardState {
  active: boolean;
  raisedAt: number;
  recoveryUntil: number;
}

export class Player extends Entity {
  readonly kind = 'player' as const;
  input: InputFrame = EMPTY_INPUT;

  grounded = false;
  groundedPrev = false;
  coyote = 0;
  jumpBuffer = 0;
  jumping = false;
  dashTimer = 0;
  dashDir: 1 | -1 = 1;
  dashCooldown = 0;
  /** Vertical velocity before this tick's physics step (for landing speed). */
  lastVy = 0;
  moveIntent = 0;
  deadAt = -1;
  /** Windups in progress (mechanics preparing an effect). You move slower while preparing. */
  windingUp = 0;
  /** Last time a hit was strong enough to break channelling and windups. */
  staggeredAt = -Infinity;

  account: ResourceAccount;
  guard: GuardState = { active: false, raisedAt: -1, recoveryUntil: -1 };

  constructor(world: World, x: number, y: number) {
    super();
    this.team = 'player';
    this.living = true;
    this.damageable = true;
    this.material = 'flesh';
    this.maxHp = PLAYER.maxHp;
    this.hp = this.maxHp;
    const { w, h } = MOVEMENT.playerSize;
    this.w = w;
    this.h = h;
    this.body = Matter.Bodies.rectangle(x, y, w, h, {
      chamfer: { radius: 7 },
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0,
      restitution: 0,
      inertia: Infinity,
      collisionFilter: { category: CAT.PLAYER, mask: CAT.SOLID | CAT.ENEMY | CAT.PROP | CAT.GATE },
      label: 'player',
    });
    Matter.Body.setMass(this.body, MOVEMENT.playerMass);
    Matter.Body.setInertia(this.body, Infinity);
    const t = world.exchange.table;
    this.account = {
      energy: Math.min(world.level.startEnergy ?? t.energy.start, t.energy.capacity),
      capacity: t.energy.capacity,
      stamina: t.stamina.max,
      staminaMax: t.stamina.max,
      staminaRegenAt: 0,
      charges: new Map(),
    };
  }

  get isDashing(): boolean {
    return this.dashTimer > 0;
  }

  get isChanneling(): boolean {
    for (const c of this.account.charges.values()) if (c.channeling) return true;
    return false;
  }

  /** Channelling a charge or winding up: preparing, so moving slower. */
  get isPreparing(): boolean {
    return this.windingUp > 0 || this.isChanneling;
  }

  /**
   * On the ground as far as jumping is concerned: standing on something, or within the short grace
   * period after stepping off a ledge during which the normal jump still works (coyote time).
   */
  get onGround(): boolean {
    return this.grounded || (this.coyote > 0 && this.vel.y >= 0);
  }

  /** Built-in movement. Runs after mechanics have reacted to this tick's input. */
  override update(world: World): void {
    if (!this.alive || !this.body) return;
    const inp = this.input;
    const g = this.grounded;
    const dt = DT;
    const v = this.vel;

    if (g) {
      this.coyote = MOVEMENT.coyoteTime;
    } else if (v.y < 0) {
      // Leaving the ground upward (launched by a mechanic, or a jump) is not stepping off a ledge:
      // no grace jump in mid-air.
      this.coyote = 0;
    } else this.coyote -= dt;

    if (anyPressed(inp, BINDINGS.jump)) this.jumpBuffer = MOVEMENT.jumpBuffer;
    else this.jumpBuffer -= dt;
    this.stun = Math.max(0, this.stun - dt);
    this.dashCooldown -= dt;

    const stunned = this.stun > 0;
    let moveX = (anyHeld(inp, BINDINGS.right) ? 1 : 0) - (anyHeld(inp, BINDINGS.left) ? 1 : 0);
    if (stunned) moveX = 0;
    this.moveIntent = moveX;
    if (moveX !== 0 && this.dashTimer <= 0) this.facing = moveX > 0 ? 1 : -1;

    // Dash: a ground move paid in stamina (never energy). In the air you only have what you build.
    if (anyPressed(inp, BINDINGS.dash) && this.dashCooldown <= 0 && !stunned && g && !this.guard.active) {
      if (world.exchange.payBody(this, MOVEMENT.dashStamina, 'Dash')) {
        this.dashTimer = MOVEMENT.dashTime;
        this.dashDir = moveX !== 0 ? (moveX > 0 ? 1 : -1) : this.facing;
        this.facing = this.dashDir;
        this.dashCooldown = MOVEMENT.dashCooldown;
        world.emit({ type: 'dash', pos: this.pos, dir: this.dashDir });
      }
    }

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      v.x = this.dashDir * Math.max(MOVEMENT.dashSpeed, Math.abs(v.x));
      v.y = Math.min(v.y, 0) * 0.5;
      this.gravityScale = 0;
      if (this.dashTimer <= 0) {
        // A dash is a burst, not a launch: it hands back control at running speed.
        v.x = this.dashDir * Math.min(Math.abs(v.x), MOVEMENT.runSpeed * 1.15);
        // Dashing off a ledge is not stepping off it: no grace jump afterwards.
        if (!this.grounded) this.coyote = 0;
      }
      this.vel = v;
      return;
    }

    let speedFactor = 1;
    if (this.guard.active) speedFactor = Math.min(speedFactor, MOVEMENT.blockMoveFactor);
    if (this.isPreparing) speedFactor = Math.min(speedFactor, MOVEMENT.channelMoveFactor);
    let target = moveX * MOVEMENT.runSpeed * speedFactor;
    // Shoving crates: deterministic, so a walk always moves them (no fight with static friction).
    if (g && moveX !== 0) {
      for (const crate of world.pushablesBeside(this, moveX)) {
        const sp = MOVEMENT.pushSpeed / Math.sqrt(Math.max(crate.mass, 0.5) / 2);
        const cv = crate.vel;
        cv.x = approach(cv.x, moveX * sp, 2400 * dt);
        crate.vel = cv;
        if (Math.abs(target) > sp) target = moveX * sp;
      }
    }
    const accel = g ? MOVEMENT.groundAccel : MOVEMENT.airAccel;
    const decel = g ? MOVEMENT.groundDecel : MOVEMENT.airDecel;
    if (moveX !== 0) {
      const over = sign(v.x) === moveX && Math.abs(v.x) > Math.abs(target);
      if (over) {
        const od = g ? MOVEMENT.overspeedDecelGround : MOVEMENT.overspeedDecelAir;
        v.x = approach(v.x, target, od * dt);
      } else v.x = approach(v.x, target, accel * dt);
    } else if (!stunned || g) {
      v.x = approach(v.x, 0, decel * dt * (stunned ? 0.4 : 1));
    }

    // Jump (buffered + coyote).
    if (this.jumpBuffer > 0 && this.coyote > 0 && !stunned) {
      v.y = -MOVEMENT.jumpSpeed;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.jumping = true;
      this.grounded = false;
      world.emit({ type: 'jump', pos: this.pos });
    }
    const jumpHeld = anyHeld(inp, BINDINGS.jump);
    if (this.jumping && !jumpHeld && v.y < 0) {
      v.y *= MOVEMENT.jumpCutFactor;
      this.jumping = false;
    }
    if (v.y >= 0) this.jumping = false;

    // Gravity shaping: snappier falls, a little hang time at the apex while jump is held.
    if (v.y > MOVEMENT.apexThreshold) this.gravityScale = MOVEMENT.fallGravityMult;
    else if (Math.abs(v.y) <= MOVEMENT.apexThreshold && jumpHeld && !g) this.gravityScale = MOVEMENT.apexGravityMult;
    else this.gravityScale = 1;

    v.y = Math.min(v.y, PHYSICS.maxFall);
    this.vel = v;
  }

  /** Called after the physics step with fresh contact information. */
  postPhysics(world: World): void {
    if (!this.body) return;
    this.groundedPrev = this.grounded;
    this.grounded = world.isGrounded(this);
    if (this.grounded && !this.groundedPrev) {
      // Every touchdown counts (mechanics reset air counters on it); only hard ones make dust.
      if (this.lastVy > 120) world.emit({ type: 'land', pos: { x: this.pos.x, y: this.pos.y + this.h / 2 }, speed: this.lastVy });
      world.mechanics?.fire('landing', { fallSpeed: Math.max(0, this.lastVy) });
    }
  }

  regen(world: World): void {
    const a = this.account;
    const t = world.exchange.table;
    if (this.guard.active) {
      const drain = t.guard.holdStaminaPerSec * DT;
      if (world.lawEnabled) {
        a.stamina = Math.max(0, a.stamina - drain);
        a.staminaRegenAt = world.time + 0.25;
        if (a.stamina <= 0) world.exchange.breakGuard(this);
      }
    } else if (world.time >= a.staminaRegenAt) {
      a.stamina = clamp(a.stamina + t.stamina.regenPerSec * DT, 0, a.staminaMax);
    }
  }
}
