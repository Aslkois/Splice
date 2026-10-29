import Matter from 'matter-js';
import { CombatSystem, type Hit } from './combat/Combat';
import { DT, IMPACT, PHYSICS, PLAYER, SAFETY, V_UNIT } from './config';
import type { MechanicDriver } from './driver';
import { Cannon, Turret, Walker } from './entities/enemies';
import { CAT, type Entity, type EntityKind, type Material, type Team } from './entities/Entity';
import { Player } from './entities/Player';
import { Projectile, type ProjectileStyle } from './entities/Projectile';
import { Bench, Cell, Crate, Door, Gate, Goal, Sign, Spikes, Target } from './entities/props';
import { Exchange } from './exchange/Exchange';
import { DEFAULT_EXCHANGE, cloneTable, type ExchangeTable } from './exchange/table';
import type { FxEvent } from './fx';
import { circleVsConvex, segmentVsConvex } from './geometry';
import { anyPressed, BINDINGS, type InputFrame } from './input';
import type { LevelDef, SpawnDef } from './levels/types';
import { dist, dot, len, norm, Rng, sub, type Vec } from './math';

export type GameMode = 'campaign' | 'sandbox' | 'hub' | 'test';

export interface WorldOptions {
  level: LevelDef;
  mode?: GameMode;
  lawEnabled?: boolean;
  seed?: number;
  exchange?: ExchangeTable;
}

export type WorldRequest =
  | { type: 'door'; target: string; requires?: string }
  | { type: 'bench' }
  | { type: 'restart' }
  | { type: 'complete'; levelId: string };

export interface ObjectiveState {
  done: boolean;
  doneAt: number;
  destroyedTags: boolean;
  reachedZone: boolean;
}

export interface Diagnostic {
  time: number;
  message: string;
  mechanicId?: string;
}

interface StartedPair {
  a: Matter.Body;
  b: Matter.Body;
  normal: Vec;
  point: Vec;
}

/**
 * The authoritative game simulation. Fixed timestep, deterministic iteration order (entity id),
 * no DOM, no rendering. Step order is documented in docs/ARCHITECTURE.md and mirrored in `step`.
 */
export class World {
  readonly level: LevelDef;
  readonly mode: GameMode;
  private _law: boolean;
  readonly engine: Matter.Engine;
  readonly rng: Rng;
  readonly exchange: Exchange;
  readonly combat: CombatSystem;
  mechanics: MechanicDriver | null = null;

  tick = 0;
  time = 0;
  entities: Entity[] = [];
  player: Player | null = null;
  fx: FxEvent[] = [];
  requests: WorldRequest[] = [];
  diagnostics: Diagnostic[] = [];
  objective: ObjectiveState = { done: false, doneAt: -1, destroyedTags: false, reachedZone: false };
  gravity = PHYSICS.gravity;
  physicsLimits = { maxBodySpeed: PHYSICS.maxBodySpeed, maxProjectileSpeed: PHYSICS.maxProjectileSpeed };
  readonly safety = SAFETY;
  /** False once anything outside normal play touched this world (sandbox tools). Only certified worlds may complete challenges. */
  certified = true;
  /** The interactable the player is currently overlapping (door/bench), for prompts. */
  nearInteractable: Entity | null = null;

  private byId = new Map<number, Entity>();
  private byBody = new Map<number, Entity>();
  private nextId = 1;
  private bodiesCache: Matter.Body[] | null = null;
  private started: StartedPair[] = [];
  private preVel = new Map<number, Vec>();
  private pairCooldown = new Map<string, number>();
  private hazardCooldown = new Map<number, number>();
  private interactCooldown = 0;

  constructor(opts: WorldOptions) {
    this.level = opts.level;
    this.mode = opts.mode ?? 'sandbox';
    this._law = opts.lawEnabled ?? true;
    this.rng = new Rng(opts.seed ?? 1337);
    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 6;
    this.exchange = new Exchange(this, cloneTable(opts.exchange ?? DEFAULT_EXCHANGE));
    this.combat = new CombatSystem(this);
    Matter.Events.on(this.engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        const c = pair.collision;
        const sp = c.supports[0] ?? pair.bodyA.position;
        this.started.push({
          a: pair.bodyA.parent ?? pair.bodyA,
          b: pair.bodyB.parent ?? pair.bodyB,
          normal: { x: c.normal.x, y: c.normal.y },
          point: { x: sp.x, y: sp.y },
        });
      }
    });
    this.buildLevel();
  }

  // ---------------------------------------------------------------- rules

  /** Campaign always enforces the law; only the sandbox (and tests) may lift it. */
  get lawEnabled(): boolean {
    return this.mode === 'campaign' || this.mode === 'hub' ? true : this._law;
  }

  setLaw(on: boolean): boolean {
    if (this.mode === 'campaign' || this.mode === 'hub') return false;
    this._law = on;
    return true;
  }

  // ---------------------------------------------------------------- construction

  private buildLevel(): void {
    for (const s of this.level.solids) {
      const body = Matter.Bodies.rectangle(s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, {
        isStatic: true,
        friction: 0.7,
        frictionStatic: 0.9,
        collisionFilter: { category: CAT.SOLID, mask: 0xffff },
        label: `solid:${s.style ?? 'ground'}`,
      });
      Matter.Composite.add(this.engine.world, body);
    }
    this.bodiesCache = null;
    for (const sp of this.level.spawns) this.spawnFromDef(sp);
    const p = new Player(this, this.level.spawn.x, this.level.spawn.y);
    this.player = p;
    this.add(p);
  }

  spawnFromDef(sp: SpawnDef): Entity | null {
    switch (sp.type) {
      case 'crate':
        return this.add(new Crate(sp.x, sp.y, sp.heavy, sp.tag));
      case 'turret':
        return this.add(new Turret(sp.x, sp.y, sp));
      case 'walker':
        return this.add(new Walker(sp.x, sp.y, sp.tag));
      case 'cannon':
        return this.add(new Cannon(sp.x, sp.y, sp));
      case 'target':
        return this.add(new Target(sp.x, sp.y, sp.hp, sp.tag));
      case 'cell':
        return this.add(new Cell(sp.x, sp.y, sp.amount ?? this.exchange.table.pickups.cellEnergy));
      case 'spikes':
        return this.add(new Spikes(sp.x, sp.y, sp.w, sp.h));
      case 'goal':
        return this.add(new Goal(sp.x, sp.y, sp.w, sp.h, sp.tag));
      case 'door':
        return this.add(new Door(sp.x, sp.y, sp.target, sp.label, sp.requires));
      case 'bench':
        return this.add(new Bench(sp.x, sp.y));
      case 'sign':
        return this.add(new Sign(sp.x, sp.y, sp.text, sp.w));
      case 'gate':
        return this.add(new Gate(sp.x, sp.y, sp.w, sp.h, sp.opensWhen));
    }
  }

  add<T extends Entity>(e: T): T | null {
    if (this.entities.length >= SAFETY.maxEntities && e.kind !== 'player') return null;
    e.id = this.nextId++;
    e.spawnTime = this.time;
    this.entities.push(e);
    this.byId.set(e.id, e);
    if (e.body) {
      this.byBody.set(e.body.id, e);
      Matter.Composite.add(this.engine.world, e.body);
      this.bodiesCache = null;
    }
    return e;
  }

  get(id: number): Entity | null {
    return this.byId.get(id) ?? null;
  }

  entityOfBody(b: Matter.Body): Entity | null {
    return this.byBody.get((b.parent ?? b).id) ?? null;
  }

  allBodies(): Matter.Body[] {
    if (!this.bodiesCache) this.bodiesCache = Matter.Composite.allBodies(this.engine.world);
    return this.bodiesCache;
  }

  get projectileCount(): number {
    let n = 0;
    for (const e of this.entities) if (e.kind === 'projectile' && e.alive) n++;
    return n;
  }

  emit(ev: FxEvent): void {
    this.fx.push(ev);
    if (this.fx.length > 600) this.fx.splice(0, this.fx.length - 600);
  }

  diagnose(message: string, mechanicId?: string): void {
    const last = this.diagnostics[this.diagnostics.length - 1];
    if (last && last.message === message && this.time - last.time < 1) return;
    this.diagnostics.push({ time: this.time, message, mechanicId });
    if (this.diagnostics.length > 50) this.diagnostics.shift();
  }

  // ---------------------------------------------------------------- the fixed step

  /**
   * One fixed 1/60 s step. Order:
   *  1. clock + per-tick ledger reset
   *  2. mechanics: due timers and delayed continuations
   *  3. mechanics: key events for this frame, then the event queue is flushed
   *  4. built-in controllers and AI (player movement, enemies)
   *  5. channels move energy battery -> charges
   *  6. gravity + engine-safety speed caps, physics step
   *  7. contacts: grounding/landing, impacts, hazards, melee contact, pickups, zones
   *  8. projectiles sweep and resolve hits (interception happens synchronously inside)
   *  9. mechanics: flush events raised by 7–8
   * 10. stamina regen, deaths/respawn, objectives, cleanup
   */
  step(input: InputFrame): void {
    this.tick++;
    this.time = this.tick * DT;
    const player = this.player;
    if (player) player.input = input;
    this.exchange.beginTick();

    this.mechanics?.beginTick();
    if (player && player.alive) this.mechanics?.fireInput(input);
    this.mechanics?.flush();

    for (const e of this.entities) if (e.alive && e.kind !== 'projectile') e.update(this);
    if (player && player.alive) this.exchange.tickChannels(player);

    this.preVel.clear();
    for (const e of this.entities) {
      if (!e.alive || !e.isDynamic) continue;
      const v = e.vel;
      v.y += this.gravity * e.gravityScale * DT;
      const s = len(v);
      if (s > this.physicsLimits.maxBodySpeed) {
        v.x *= this.physicsLimits.maxBodySpeed / s;
        v.y *= this.physicsLimits.maxBodySpeed / s;
      }
      e.vel = v;
      this.preVel.set(e.body!.id, v);
    }
    if (player && player.alive) player.lastVy = player.vel.y;
    this.started.length = 0;
    Matter.Engine.update(this.engine, 1000 / 60);

    if (player && player.alive) player.postPhysics(this);
    for (const e of this.entities) if (e.alive && e instanceof Walker) e.postPhysics(this);
    this.processContacts();
    this.processImpacts();
    this.processHazards();
    this.processZones();

    for (const e of this.entities) if (e.alive && e.kind === 'projectile') e.update(this);

    this.mechanics?.flush();

    if (player && player.alive) player.regen(this);
    this.processBounds();
    this.processDeathAndRespawn();
    this.evaluateObjective();
    this.cleanup();
  }

  // ---------------------------------------------------------------- queries

  isGrounded(e: Entity): boolean {
    if (!e.body) return false;
    if (e.vel.y < -80) return false;
    const b = e.bounds();
    const region = { min: { x: b.minX + 3, y: b.maxY - 1 }, max: { x: b.maxX - 3, y: b.maxY + 3 } };
    const mask = e.body.collisionFilter.mask ?? 0xffff;
    for (const body of Matter.Query.region(this.allBodies(), region)) {
      if (body === e.body || body.isSensor) continue;
      if (((body.collisionFilter.category ?? 1) & mask) === 0) continue;
      if (body.bounds.min.y < b.maxY - 10) {
        // Something overlapping our side (a wall) — only counts if its top surface really is under us.
        const top = Math.min(...body.vertices.filter((v) => v.x > b.minX + 2 && v.x < b.maxX - 2).map((v) => v.y));
        if (!(top >= b.maxY - 10)) continue;
      }
      return true;
    }
    return false;
  }

  solidAt(p: Vec, excludeId?: number): boolean {
    for (const body of Matter.Query.point(this.allBodies(), p)) {
      const ent = this.entityOfBody(body);
      if (ent && (ent.id === excludeId || ent.kind === 'player')) continue;
      return true;
    }
    return false;
  }

  /** Static geometry, gates and props block sight; creatures don't. */
  lineOfSight(a: Vec, b: Vec, exclude: number[] = []): boolean {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    for (const body of this.allBodies()) {
      if (body.bounds.max.x < minX || body.bounds.min.x > maxX || body.bounds.max.y < minY || body.bounds.min.y > maxY) continue;
      const cat = body.collisionFilter.category ?? 1;
      if (cat & (CAT.PLAYER | CAT.ENEMY)) continue;
      const ent = this.entityOfBody(body);
      if (ent && (exclude.includes(ent.id) || ent.kind === 'spikes' || ent.kind === 'target')) continue;
      if (segmentVsConvex(a, b, body.vertices) !== null) return false;
    }
    return true;
  }

  nearest(filter: string, from: Vec, radius: number, excludeId?: number): Entity | null {
    let best: Entity | null = null;
    let bestD = radius;
    for (const e of this.entities) {
      if (!e.alive || e.id === excludeId || !matchesFilter(e, filter)) continue;
      const d = dist(from, e.pos);
      if (d <= bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- effects

  spawnProjectile(
    pos: Vec,
    vel: Vec,
    opts: { mass: number; radius?: number; ownerId: number | null; team: Team; style?: ProjectileStyle; life?: number; gravityScale?: number },
  ): Projectile | null {
    if (this.projectileCount >= SAFETY.maxProjectiles) {
      this.diagnose('Projectile limit reached — extra projectiles were not spawned.');
      return null;
    }
    const s = len(vel);
    const v = s > this.physicsLimits.maxProjectileSpeed ? { x: (vel.x / s) * this.physicsLimits.maxProjectileSpeed, y: (vel.y / s) * this.physicsLimits.maxProjectileSpeed } : vel;
    const p = this.add(new Projectile(pos, v, opts));
    if (p) this.emit({ type: 'shot', pos, dir: norm(v), mass: opts.mass, team: opts.team });
    return p;
  }

  sweepProjectile(p: Projectile): void {
    const from = p.pos;
    const travel = { x: p.velocity.x * DT, y: p.velocity.y * DT };
    const to = { x: from.x + travel.x, y: from.y + travel.y };
    const r = p.radius;
    const minX = Math.min(from.x, to.x) - r;
    const maxX = Math.max(from.x, to.x) + r;
    const minY = Math.min(from.y, to.y) - r;
    const maxY = Math.max(from.y, to.y) + r;
    const candidates: Matter.Body[] = [];
    for (const body of this.allBodies()) {
      if (body.bounds.max.x < minX || body.bounds.min.x > maxX || body.bounds.max.y < minY || body.bounds.min.y > maxY) continue;
      const ent = this.entityOfBody(body);
      if (ent && (ent.id === p.ownerId || !ent.alive)) continue;
      candidates.push(body);
    }
    const steps = Math.max(1, Math.ceil(len(travel) / Math.max(2, r * 0.75)));
    for (let i = 1; i <= steps && candidates.length; i++) {
      const pos = { x: from.x + (travel.x * i) / steps, y: from.y + (travel.y * i) / steps };
      for (const body of candidates) {
        const parts = body.parts.length > 1 ? body.parts.slice(1) : body.parts;
        let contact: { normal: Vec; point: Vec } | null = null;
        for (const part of parts) {
          contact = circleVsConvex(pos, r, part.vertices);
          if (contact) break;
        }
        if (!contact) continue;
        const ent = this.entityOfBody(body);
        p.pos = pos;
        if (!ent || !ent.damageable) {
          this.emit({ type: 'impact', pos: contact.point, normal: contact.normal, energy: p.energy, material: ent?.material ?? 'stone' });
          this.destroy(p, 'impact');
          return;
        }
        const hit = this.combat.submit({
          kind: 'projectile',
          attackerId: p.ownerId,
          sourceId: p.id,
          victim: ent,
          point: contact.point,
          direction: norm(p.velocity),
          momentum: p.momentum,
          energy: p.energy,
          projectile: p,
        });
        if (p.alive && !(hit && hit.redirected)) this.destroy(p, 'impact');
        return;
      }
    }
    p.pos = to;
  }

  /** Applies health damage that has already been resolved by the combat pipeline. */
  damageEntity(e: Entity, amount: number, point: Vec, dir: Vec, attackerId: number | null, hit?: Hit): void {
    if (!e.alive || !e.damageable || amount <= 0) return;
    const dmg = Math.min(amount, SAFETY.maxDamage);
    e.hp -= dmg;
    e.lastHurtTime = this.time;
    this.emit({ type: 'hurt', pos: point, amount: dmg, entityId: e.id });
    if (e instanceof Player) {
      if (dmg >= this.exchange.table.charge.interruptThreshold) this.exchange.interruptCharges(e);
      this.mechanics?.fire('damage.taken', { amount: dmg, attackerId, hit });
      if (dmg > 8) this.emit({ type: 'shake', intensity: Math.min(10, 2 + dmg * 0.08), duration: 0.2 });
    } else if (e instanceof Walker) {
      e.stun = Math.max(e.stun, 0.25);
    }
    void dir;
    if (e.hp <= 0) {
      if (e instanceof Player) this.killPlayer();
      else this.destroy(e, 'destroyed');
    }
  }

  destroy(e: Entity, reason: 'destroyed' | 'expired' | 'impact' | 'removed' | 'fell' | 'collected'): void {
    if (!e.alive) return;
    e.alive = false;
    if (e.body) {
      Matter.Composite.remove(this.engine.world, e.body);
      this.byBody.delete(e.body.id);
      this.bodiesCache = null;
    }
    e.onDestroyed(this);
    if (e.kind !== 'projectile') {
      if (reason === 'destroyed') this.emit({ type: 'break', pos: e.pos, kind: e.kind, size: Math.max(e.w, e.h) });
      this.mechanics?.fire('entity.destroyed', { entityId: e.id, kind: e.kind, tag: e.tag ?? '' });
      this.refreshGates();
    }
  }

  killPlayer(): void {
    const p = this.player;
    if (!p || !p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.deadAt = this.time;
    p.guard.active = false;
    if (p.body) {
      Matter.Composite.remove(this.engine.world, p.body);
      this.bodiesCache = null;
    }
    this.emit({ type: 'death', pos: p.pos });
    this.emit({ type: 'shake', intensity: 9, duration: 0.35 });
  }

  respawnPlayer(): void {
    const p = this.player;
    if (!p || !p.body) return;
    const t = this.exchange.table;
    p.alive = true;
    p.hp = p.maxHp;
    p.stun = 0;
    p.dashTimer = 0;
    p.guard = { active: false, raisedAt: -1, recoveryUntil: -1 };
    p.account.energy = Math.min(this.level.startEnergy ?? t.energy.start, p.account.capacity);
    p.account.stamina = p.account.staminaMax;
    p.account.charges.clear();
    Matter.Body.setPosition(p.body, this.level.spawn);
    p.vel = { x: 0, y: 0 };
    Matter.Composite.add(this.engine.world, p.body);
    this.bodiesCache = null;
    this.mechanics?.reset();
    this.emit({ type: 'spawn', pos: this.level.spawn });
  }

  private refreshGates(): void {
    for (const e of this.entities) {
      if (!(e instanceof Gate) || e.open) continue;
      const blockers = this.entities.some((o) => o.alive && o.tag === e.opensWhen && o.kind !== 'gate');
      if (!blockers) {
        e.open = true;
        e.openedAt = this.time;
        if (e.body) {
          Matter.Composite.remove(this.engine.world, e.body);
          this.byBody.delete(e.body.id);
          this.bodiesCache = null;
        }
        this.emit({ type: 'gateOpen', pos: e.pos });
      }
    }
  }

  // ---------------------------------------------------------------- post-physics passes

  /** Raises "On Collision" for every new contact of the player's body. */
  private processContacts(): void {
    const p = this.player;
    if (!p || !p.alive || !p.body || !this.mechanics) return;
    for (const sp of this.started) {
      let other: Matter.Body | null = null;
      if (sp.a === p.body) other = sp.b;
      else if (sp.b === p.body) other = sp.a;
      if (!other) continue;
      const ent = this.entityOfBody(other);
      const v = this.preVel.get(p.body.id) ?? { x: 0, y: 0 };
      const vo = this.preVel.get(other.id) ?? { x: 0, y: 0 };
      this.mechanics.fire('collision', {
        otherId: ent?.id ?? 0,
        kind: ent ? ent.kind : 'solid',
        team: ent?.team ?? 'neutral',
        speed: Math.abs(dot(sub(v, vo), sp.normal)),
      });
    }
  }

  private processImpacts(): void {
    for (const sp of this.started) {
      const ea = this.entityOfBody(sp.a);
      const eb = this.entityOfBody(sp.b);
      if (sp.a.isStatic && sp.b.isStatic) continue;
      const va = this.preVel.get(sp.a.id) ?? { x: 0, y: 0 };
      const vb = this.preVel.get(sp.b.id) ?? { x: 0, y: 0 };
      const rel = sub(va, vb);
      const vn = Math.abs(dot(rel, sp.normal));
      const ma = sp.a.isStatic ? Infinity : sp.a.mass;
      const mb = sp.b.isStatic ? Infinity : sp.b.mass;
      const mu = ma === Infinity ? mb : mb === Infinity ? ma : (ma * mb) / (ma + mb);
      const energy = 0.5 * mu * (vn / V_UNIT) ** 2;
      if (energy < IMPACT.threshold) continue;
      const key = sp.a.id < sp.b.id ? `${sp.a.id}:${sp.b.id}` : `${sp.b.id}:${sp.a.id}`;
      const until = this.pairCooldown.get(key) ?? -1;
      if (until > this.time) continue;
      this.pairCooldown.set(key, this.time + IMPACT.pairCooldown);
      const damage = (energy - IMPACT.threshold) * IMPACT.damageFactor;
      const mat: Material = ea?.material ?? eb?.material ?? 'stone';
      this.emit({ type: 'impact', pos: sp.point, normal: sp.normal, energy, material: mat });
      const sides: [Entity | null, Entity | null, Vec, Vec][] = [
        [ea, eb, va, vb],
        [eb, ea, vb, va],
      ];
      for (const [victim, other, vVictim, vOther] of sides) {
        if (!victim || !victim.alive || !victim.damageable || victim.kind === 'projectile') continue;
        if (victim instanceof Player) {
          // The player is only hurt by things that come at them, never by what they run into.
          if (!other || !other.isDynamic) continue;
          const toward = norm(sub(victim.pos, other.pos));
          if (dot(vOther, toward) < 250) continue;
        }
        this.combat.submit({
          kind: 'impact',
          attackerId: null,
          sourceId: other?.id ?? null,
          victim,
          point: sp.point,
          direction: norm(sub(vOther, vVictim)),
          momentum: (mu * vn) / V_UNIT,
          energy,
          damage,
        });
      }
    }
  }

  private processHazards(): void {
    const spikes = this.entities.filter((e) => e.alive && e.kind === 'spikes');
    if (!spikes.length) return;
    for (const e of this.entities) {
      if (!e.alive || !e.living || !e.body) continue;
      const until = this.hazardCooldown.get(e.id) ?? -1;
      if (until > this.time) continue;
      const b = e.bounds();
      for (const s of spikes) {
        const sb = s.bounds();
        if (b.maxX < sb.minX + 2 || b.minX > sb.maxX - 2 || b.maxY < sb.minY - 2 || b.minY > sb.maxY) continue;
        this.hazardCooldown.set(e.id, this.time + 0.6);
        this.combat.hazard(e, { x: e.pos.x, y: sb.minY }, (s as Spikes).damage);
        break;
      }
    }
  }

  private processZones(): void {
    const p = this.player;
    this.nearInteractable = null;
    if (!p || !p.alive) return;
    this.interactCooldown -= DT;
    const pb = p.bounds();
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.kind !== 'cell' && e.kind !== 'goal' && e.kind !== 'door' && e.kind !== 'bench') continue;
      const b = e.bounds();
      if (pb.maxX < b.minX || pb.minX > b.maxX || pb.maxY < b.minY || pb.minY > b.maxY) continue;
      if (e instanceof Cell) {
        const a = p.account;
        if (this.lawEnabled && a.energy >= a.capacity - 0.5) continue;
        this.exchange.credit(p, e.amount, 'Energy Cell');
        this.emit({ type: 'pickup', pos: e.pos, amount: e.amount });
        this.destroy(e, 'collected');
      } else if (e instanceof Goal) {
        e.reached = true;
      } else if (e instanceof Door || e instanceof Bench) {
        this.nearInteractable = e;
        if (anyPressed(p.input, BINDINGS.interact) && this.interactCooldown <= 0) {
          this.interactCooldown = 0.4;
          if (e instanceof Door) {
            if (!e.locked) this.requests.push({ type: 'door', target: e.target, requires: e.requires });
          } else this.requests.push({ type: 'bench' });
        }
      }
    }
  }

  private processBounds(): void {
    const limitY = this.level.height + PHYSICS.killMargin;
    for (const e of this.entities) {
      if (!e.alive) continue;
      const p = e.pos;
      if (p.y > limitY || p.x < -PHYSICS.killMargin * 2 || p.x > this.level.width + PHYSICS.killMargin * 2 || p.y < -4000) {
        if (e instanceof Player) this.killPlayer();
        else this.destroy(e, e.kind === 'projectile' ? 'expired' : 'fell');
      }
    }
  }

  private processDeathAndRespawn(): void {
    const p = this.player;
    if (!p || p.alive || p.deadAt < 0) return;
    if (this.time - p.deadAt < PLAYER.respawnDelay) return;
    if (this.mode === 'campaign') {
      if (!this.requests.some((r) => r.type === 'restart')) this.requests.push({ type: 'restart' });
      p.deadAt = Infinity;
    } else this.respawnPlayer();
  }

  private evaluateObjective(): void {
    const obj = this.level.objective;
    if (!obj || this.objective.done) return;
    const p = this.player;
    if (obj.kind === 'destroy' || obj.kind === 'destroyThenReach') {
      this.objective.destroyedTags = !this.entities.some((e) => e.alive && e.tag && obj.tags.includes(e.tag) && e.kind !== 'goal' && e.kind !== 'gate');
    }
    if (obj.kind === 'reach' || obj.kind === 'destroyThenReach') {
      this.objective.reachedZone = !!p?.alive && this.entities.some((e) => e instanceof Goal && e.tag === obj.zoneTag && e.reached);
    }
    for (const e of this.entities) if (e instanceof Goal) e.reached = false;
    const done =
      obj.kind === 'reach'
        ? this.objective.reachedZone
        : obj.kind === 'destroy'
          ? this.objective.destroyedTags && !!p?.alive
          : this.objective.destroyedTags && this.objective.reachedZone;
    if (done) {
      this.objective.done = true;
      this.objective.doneAt = this.time;
      this.emit({ type: 'objective', done: true });
      if (this.certified && this.lawEnabled) this.requests.push({ type: 'complete', levelId: this.level.id });
    }
  }

  private cleanup(): void {
    if (this.tick % 30 !== 0) return;
    const keep: Entity[] = [];
    for (const e of this.entities) {
      if (e.alive || e === this.player || e.kind === 'gate') keep.push(e);
      else this.byId.delete(e.id);
    }
    this.entities = keep;
    for (const [k, t] of this.pairCooldown) if (t < this.time) this.pairCooldown.delete(k);
  }

  // ---------------------------------------------------------------- sandbox tools

  /** Places an entity on behalf of the sandbox tools. Marks the world uncertified. */
  sandboxSpawn(type: 'crate' | 'heavy' | 'turret' | 'walker' | 'target' | 'cell' | 'cannon', at: Vec): Entity | null {
    this.certified = false;
    const facing: 1 | -1 = this.player && this.player.pos.x > at.x ? 1 : -1;
    switch (type) {
      case 'crate':
        return this.spawnFromDef({ type: 'crate', x: at.x, y: at.y });
      case 'heavy':
        return this.spawnFromDef({ type: 'crate', x: at.x, y: at.y, heavy: true });
      case 'turret':
        return this.spawnFromDef({ type: 'turret', x: at.x, y: at.y, facing });
      case 'walker':
        return this.spawnFromDef({ type: 'walker', x: at.x, y: at.y });
      case 'target':
        return this.spawnFromDef({ type: 'target', x: at.x, y: at.y });
      case 'cell':
        return this.spawnFromDef({ type: 'cell', x: at.x, y: at.y });
      case 'cannon':
        return this.spawnFromDef({ type: 'cannon', x: at.x, y: at.y, facing });
    }
  }

  sandboxRemoveAt(at: Vec): boolean {
    this.certified = false;
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (!e.alive || e === this.player) continue;
      if (e.kind === 'sign' || e.kind === 'door' || e.kind === 'bench') continue;
      const b = e.bounds();
      if (at.x >= b.minX - 6 && at.x <= b.maxX + 6 && at.y >= b.minY - 6 && at.y <= b.maxY + 6) {
        this.destroy(e, 'removed');
        return true;
      }
    }
    return false;
  }

  sandboxRefill(): void {
    this.certified = false;
    const p = this.player;
    if (!p) return;
    if (!p.alive) this.respawnPlayer();
    p.hp = p.maxHp;
    p.account.energy = p.account.capacity;
    p.account.stamina = p.account.staminaMax;
  }
}

export function matchesFilter(e: Entity, filter: string): boolean {
  switch (filter) {
    case 'any':
      return e.kind !== 'sign' && e.kind !== 'goal' && e.kind !== 'door' && e.kind !== 'bench' && e.kind !== 'gate';
    case 'enemy':
      return e.team === 'enemy' && e.kind !== 'projectile';
    case 'projectile':
      return e.kind === 'projectile';
    case 'hostileProjectile':
      return e.kind === 'projectile' && e.team === 'enemy';
    case 'crate':
      return e.kind === 'crate';
    case 'target':
      return e.kind === 'target';
    case 'cell':
      return e.kind === 'cell';
    case 'solid':
      return false;
    default:
      return e.kind === (filter as EntityKind);
  }
}
