import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import type { MechanicGraph } from '../src/mechanics/schema';
import { Projectile } from '../src/sim/entities/Projectile';
import { ScriptedInput } from '../src/sim/input';
import { C1, C2, C3 } from '../src/sim/levels/levels';
import type { LevelDef } from '../src/sim/levels/types';
import { World } from '../src/sim/World';
import { deathParry, guardGraph } from './fixtures';

/** A tiny "player" that holds keys and reacts to what it sees, one tick at a time. */
class Bot {
  readonly input = new ScriptedInput();
  readonly world: World;
  constructor(level: LevelDef, graphs: MechanicGraph[], maxTier = 3) {
    this.world = new World({ level, mode: 'campaign', seed: 3 });
    const { rejected } = attachMechanics(this.world, graphs, { maxTier });
    expect(rejected.map((r) => r.issues.filter((i) => i.severity === 'error'))).toEqual(rejected.map(() => []));
  }
  get p() {
    return this.world.player!;
  }
  tick(keys: string[]) {
    this.world.step(this.input.frame(keys));
  }
  until(cond: () => boolean, keys: () => string[], maxSeconds: number): boolean {
    for (let i = 0; i < maxSeconds * 60; i++) {
      if (cond()) return true;
      this.tick(keys());
    }
    return cond();
  }
  completed(): boolean {
    return this.world.objective.done && this.world.requests.some((r) => r.type === 'complete');
  }
}

/** On Space Pressed while airborne: an upward impulse. Built from tier-0 primitives. */
function doubleJump(): MechanicGraph {
  const b = new GraphBuilder('Double Jump');
  const ev = b.node('on.keyPressed', { key: 'Space' });
  const grounded = b.node('state.grounded');
  const not = b.node('logic.not');
  const iff = b.node('flow.if');
  const imp = b.node('act.impulse', { impulse: { x: 0, y: -650 } });
  b.flow(ev, 'then', iff).flow(iff, 'then', imp);
  b.wire(grounded, 'out', not, 'a').wire(not, 'out', iff, 'cond');
  return b.build();
}

/** Parry without Prevent (tier 1 only): reflect when the guard is fresh. */
function returnToSender(): MechanicGraph {
  const b = new GraphBuilder('Return to Sender');
  guardGraph(b);
  const ev = b.node('on.successfulBlock', {}, { x: 0, y: 300 });
  const timer = b.node('timer.value', { name: 'Parry' }, { x: 100, y: 420 });
  const cmp = b.node('logic.compare', { op: '<', b: 0.4 }, { x: 260, y: 420 });
  const iff = b.node('flow.if', {}, { x: 220, y: 300 });
  const reflect = b.node('act.reflect', {}, { x: 420, y: 300 });
  b.flow(ev, 'then', iff).wire(timer, 'out', cmp, 'a').wire(cmp, 'out', iff, 'cond').flow(iff, 'then', reflect);
  return b.build();
}

/** Run right and leap with everything the built-in moveset offers. */
function baseLeap(bot: Bot, jumpAtX: number, dashDelay: number): void {
  bot.until(() => bot.p.pos.x >= jumpAtX || !bot.p.alive, () => ['D'], 6);
  bot.tick(['D', 'Space']);
  for (let i = 0; i < dashDelay; i++) bot.tick(['D', 'Space']);
  bot.tick(['D', 'Space', 'Shift']);
  bot.until(() => !bot.p.alive || bot.completed(), () => ['D', 'Space'], 4);
}

/** Walks right, hopping over anything it gets stuck on. */
function walkTo(bot: Bot, x: number): void {
  let stuckFor = 0;
  bot.until(
    () => bot.p.pos.x >= x,
    () => {
      const crateAhead = bot.world.pushablesBeside(bot.p, 1).length > 0;
      stuckFor = (Math.abs(bot.p.vel.x) < 60 || crateAhead) && bot.p.grounded ? stuckFor + 1 : 0;
      return stuckFor > 3 ? ['D', 'Space'] : ['D'];
    },
    8,
  );
}

function hostileIncoming(w: World, within: number): boolean {
  const p = w.player!;
  for (const e of w.entities) {
    if (!(e instanceof Projectile) || !e.alive || e.team !== 'enemy') continue;
    const dx = p.pos.x - e.pos.x;
    const dy = p.pos.y - e.pos.y;
    const d = Math.hypot(dx, dy);
    const closing = (dx * e.velocity.x + dy * e.velocity.y) / Math.max(d, 1);
    if (closing > 0 && d - closing * 0.0 < within) return true;
  }
  return false;
}

describe('campaign challenges complete through world state, using player-built mechanics', () => {
  it('Cross the Gap is out of reach for the built-in moveset', () => {
    for (const jumpAt of [700, 730, 750, 770]) {
      for (const dashDelay of [6, 14, 22, 30]) {
        const bot = new Bot(C1, []);
        baseLeap(bot, jumpAt, dashDelay);
        expect(bot.completed()).toBe(false);
      }
    }
  });

  it('Cross the Gap: a home-made double jump gets you across', () => {
    const bot = new Bot(C1, [doubleJump()], 0);
    // Grab the cell on the way, leap at the edge, re-jump at the apex, dash, re-jump again.
    bot.until(() => bot.p.pos.x >= 745, () => ['D'], 6);
    bot.tick(['D', 'Space']);
    bot.until(() => bot.p.vel.y > -60, () => ['D', 'Space'], 2);
    bot.tick(['D']);
    bot.tick(['D', 'Space']);
    bot.until(() => bot.p.vel.y > -60, () => ['D', 'Space'], 2);
    bot.tick(['D', 'Shift']);
    bot.until(() => bot.p.vel.y > 0, () => ['D'], 2);
    bot.tick(['D']);
    bot.tick(['D', 'Space']);
    const ok = bot.until(() => bot.completed() || !bot.p.alive, () => ['D'], 6);
    expect(ok).toBe(true);
    expect(bot.p.alive).toBe(true);
    expect(bot.completed()).toBe(true);
    // Paid for with energy: the receipt shows the impulses.
    expect(bot.world.exchange.log.filter((t) => t.label === 'Impulse' && t.ok).length).toBeGreaterThanOrEqual(2);
  });

  it('Return to Sender: reflecting the bolts silences both emplacements', () => {
    const bot = new Bot(C2, [returnToSender()], 1);
    walkTo(bot, 820);
    let holdUntil = -1;
    const solved = bot.until(
      () => bot.completed() || !bot.p.alive,
      () => {
        const w = bot.world;
        if (hostileIncoming(w, 150)) holdUntil = w.time + 0.12;
        return w.time < holdUntil ? ['F'] : [];
      },
      90,
    );
    expect(solved).toBe(true);
    expect(bot.p.alive).toBe(true);
    expect(bot.completed()).toBe(true);
  });

  it('Survive the Impossible: a timed reflect + prevent survives the slug and opens the way out', () => {
    const bot = new Bot(C3, [deathParry({ window: 0.4 })], 2);
    walkTo(bot, 1150);
    let holdUntil = -1;
    bot.until(
      () => !bot.world.entities.some((e) => e.alive && e.tag === 'judgement') || !bot.p.alive,
      () => {
        const w = bot.world;
        if (hostileIncoming(w, 190)) holdUntil = w.time + 0.12;
        return w.time < holdUntil ? ['F'] : [];
      },
      30,
    );
    expect(bot.p.alive).toBe(true);
    expect(bot.world.entities.some((e) => e.alive && e.tag === 'judgement')).toBe(false);
    const out = bot.until(() => bot.completed() || !bot.p.alive, () => ['A'], 12);
    expect(out).toBe(true);
    expect(bot.completed()).toBe(true);
  });

  it('Survive the Impossible: blocking alone is not enough', () => {
    const b = new GraphBuilder('Guard');
    guardGraph(b);
    const bot = new Bot(C3, [b.build()], 2);
    walkTo(bot, 1150);
    let holdUntil = -1;
    bot.until(
      () => !bot.p.alive,
      () => {
        const w = bot.world;
        if (hostileIncoming(w, 190)) holdUntil = w.time + 0.12;
        return w.time < holdUntil ? ['F'] : [];
      },
      20,
    );
    expect(bot.p.alive).toBe(false);
  });
});
