import { describe, expect, it } from 'vitest';
import { airDashGraph, doubleJumpGraph } from '../src/dev/campaignValidation';
import { GameRunner } from '../src/game/GameRunner';
import { attachMechanics } from '../src/mechanics/builder';
import type { MechanicHost } from '../src/mechanics/runtime';
import { applyScratch, toScratch } from '../src/mechanics/scratch';
import type { MechanicGraph } from '../src/mechanics/schema';
import { quoteImpulse } from '../src/sim/exchange/formulas';
import { DEFAULT_EXCHANGE } from '../src/sim/exchange/table';
import { Driver, flatLevel, makeWorld } from './helpers';

const AIR = 'Air Jumps Used';

function setup(graphs: MechanicGraph[], level = flatLevel()) {
  const w = makeWorld({ level });
  const { host } = attachMechanics(w, graphs);
  const d = new Driver(w);
  d.run(0.4);
  return { w, d, p: w.player!, host: host as MechanicHost };
}

/** Jump holding Space; at the apex (or once falling at `fallSpeed`) release and press Space again. */
function jumpThenAirJump(s: ReturnType<typeof setup>, opts: { fallSpeed?: number } = {}) {
  const { w, d, p } = s;
  const floorY = p.pos.y;
  w.step(d.frame(['Space']));
  let firstPeak = p.pos.y;
  for (let i = 0; i < 120; i++) {
    w.step(d.frame(['Space']));
    firstPeak = Math.min(firstPeak, p.pos.y);
    if (opts.fallSpeed != null ? p.vel.y >= opts.fallSpeed : p.vel.y >= -20) break;
  }
  const pressedAt = p.pos.y;
  w.step(d.frame([]));
  const e0 = p.account.energy;
  w.step(d.frame(['Space']));
  let peak = p.pos.y;
  for (let i = 0; i < 150 && !p.grounded; i++) {
    w.step(d.frame(['Space']));
    peak = Math.min(peak, p.pos.y);
  }
  return { floorY, firstHeight: floorY - firstPeak, height: floorY - peak, riseFromPress: pressedAt - peak, cost: e0 - p.account.energy };
}

describe('movement is priced by what it does', () => {
  it('an ordinary air jump costs a modest share of a 100 E reservoir; bigger ones cost more', () => {
    const t = DEFAULT_EXCHANGE;
    const price = (dv: number) => quoteImpulse(t, { mass: 1, velocity: { x: 0, y: 0 }, impulse: { x: 0, y: -dv }, self: true, distance: 0, maxSpeed: 4200 }).energy;
    expect(price(550)).toBeGreaterThan(10);
    expect(price(650)).toBeLessThan(25);
    const ladder = [300, 600, 900, 1500, 3000].map(price);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    // A launch to the top of a tall room costs far more than a reservoir holds.
    expect(price(3000)).toBeGreaterThan(400);
  });

  it('splitting a push into pieces does not make it cheaper', () => {
    const t = DEFAULT_EXCHANGE;
    const whole = quoteImpulse(t, { mass: 1, velocity: { x: 0, y: 0 }, impulse: { x: 0, y: -800 }, self: true, distance: 0, maxSpeed: 4200 }).energy;
    let v = 0;
    let sum = 0;
    for (let i = 0; i < 32; i++) {
      const q = quoteImpulse(t, { mass: 1, velocity: { x: 0, y: v }, impulse: { x: 0, y: -25 }, self: true, distance: 0, maxSpeed: 4200 });
      sum += q.energy;
      v -= 25;
    }
    expect(sum).toBeCloseTo(whole, 6);
  });
});

describe('a double jump built from general primitives', () => {
  it('adds real height, for a price in the 10–25 E range', () => {
    const s = setup([doubleJumpGraph({ speed: 600 })]);
    const r = jumpThenAirJump(s);
    expect(r.height).toBeGreaterThan(r.firstHeight * 1.4);
    expect(r.cost).toBeGreaterThan(10);
    expect(r.cost).toBeLessThan(25);
    // used once, and reset by the landing at the end
    expect(s.w.exchange.log.filter((x) => x.label === 'Impulse' && x.ok)).toHaveLength(1);
    expect(s.host.characterScope.numbers.get(AIR)).toBe(0);
  });

  it('pressed while falling it still carries you up — target velocity vs fixed impulse', () => {
    const target = setup([doubleJumpGraph({ speed: 600 })]);
    const t = jumpThenAirJump(target, { fallSpeed: 400 });
    const fixed = setup([doubleJumpGraph({ speed: 600, mode: 'impulse' })]);
    const f = jumpThenAirJump(fixed, { fallSpeed: 400 });
    // Setting the upward speed overcomes the fall completely…
    expect(t.riseFromPress).toBeGreaterThan(50);
    // …a fixed impulse first has to cancel the fall: less height, and much cheaper.
    expect(f.riseFromPress).toBeLessThan(t.riseFromPress);
    expect(f.cost).toBeLessThan(t.cost);
  });

  it('one air jump per air time: repeated presses and a held key do nothing more', () => {
    const s = setup([doubleJumpGraph({ speed: 600 })]);
    const { w, d, p, host } = s;
    w.step(d.frame(['Space']));
    for (let i = 0; i < 10; i++) w.step(d.frame(['Space']));
    const before = w.exchange.log.filter((x) => x.label === 'Impulse' && x.ok).length;
    // mash Space five times, then hold it
    for (let k = 0; k < 5; k++) {
      w.step(d.frame([]));
      w.step(d.frame(['Space']));
    }
    for (let i = 0; i < 20; i++) w.step(d.frame(['Space']));
    const after = w.exchange.log.filter((x) => x.label === 'Impulse' && x.ok).length;
    expect(after - before).toBe(1);
    expect(host.characterScope.numbers.get(AIR)).toBe(1);
    // landing resets it
    for (let i = 0; i < 200 && !p.grounded; i++) w.step(d.frame([]));
    w.step(d.frame([]));
    expect(host.characterScope.numbers.get(AIR)).toBe(0);
  });

  it('touching a wall in the air is not a landing', () => {
    const level = flatLevel({ solids: [...flatLevel().solids, { x: 460, y: 300, w: 40, h: 240, style: 'wall' }] });
    const s = setup([doubleJumpGraph({ speed: 600 })], level);
    const { w, d, p, host } = s;
    // jump and air-jump next to the wall while pressing into it
    w.step(d.frame(['Space', 'D']));
    for (let i = 0; i < 18; i++) w.step(d.frame(['Space', 'D']));
    w.step(d.frame(['D']));
    w.step(d.frame(['Space', 'D']));
    expect(host.characterScope.numbers.get(AIR)).toBe(1);
    let touchedWall = false;
    for (let i = 0; i < 30 && !p.grounded; i++) {
      w.step(d.frame(['D']));
      if (p.pos.x + p.w / 2 >= 459) touchedWall = true;
      expect(host.characterScope.numbers.get(AIR)).toBe(1);
    }
    expect(touchedWall).toBe(true);
  });

  it('stepping off a ledge, Space within the grace period is the normal (free) jump, not the air jump', () => {
    const level = flatLevel({
      solids: [
        { x: -40, y: 600, w: 560, h: 300, style: 'ground' },
        { x: 700, y: 760, w: 2300, h: 140, style: 'ground' },
      ],
    });
    const s = setup([doubleJumpGraph({ speed: 600 })], level);
    const { w, d, p, host } = s;
    for (let i = 0; i < 200 && p.grounded; i++) w.step(d.frame(['D']));
    expect(p.grounded).toBe(false);
    const e0 = p.account.energy;
    w.step(d.frame(['D', 'Space']));
    expect(p.vel.y).toBeLessThan(-500);
    expect(p.account.energy).toBe(e0);
    expect(host.characterScope.numbers.get(AIR) ?? 0).toBe(0);
  });

  it('behaves the same at 30, 60 and 144 frames per second', () => {
    const heights: number[] = [];
    const costs: number[] = [];
    for (const fps of [30, 60, 144]) {
      const r = new GameRunner();
      r.load({ levelId: 'sandbox', mode: 'sandbox', lawEnabled: true, mechanics: [doubleJumpGraph({ speed: 600 })] });
      const p = r.world.player!;
      const frame = 1000 / fps;
      const advance = (ms: number) => {
        for (let t = 0; t < ms; t += frame) r.advance(frame);
      };
      advance(500);
      const floor = p.pos.y;
      const e0 = p.account.energy;
      r.input.press('Space');
      advance(320);
      r.input.release('Space');
      advance(1000 / 30);
      r.input.press('Space');
      let peak = p.pos.y;
      for (let t = 0; t < 1200; t += frame) {
        r.advance(frame);
        peak = Math.min(peak, p.pos.y);
      }
      heights.push(floor - peak);
      costs.push(e0 - p.account.energy);
    }
    // Same simulation steps whatever the display does; input timing differs by at most a tick.
    for (const h of heights) expect(Math.abs(h - heights[1])).toBeLessThan(12);
    for (const c of costs) expect(Math.abs(c - costs[1])).toBeLessThan(1.5);
  });
});

describe('both editors run the same mechanic', () => {
  it('a double jump and an air dash round-tripped through Scratch Blocks behave identically', () => {
    for (const make of [() => doubleJumpGraph({ speed: 600 }), () => airDashGraph(850)]) {
      const g = make();
      const view = toScratch(g);
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      const g2 = applyScratch(g, view.view);
      const run = (graph: MechanicGraph) => {
        const s = setup([graph]);
        const key = graph.name === 'Air Dash' ? 'Q' : 'Space';
        s.w.step(s.d.frame(['Space', 'D']));
        for (let i = 0; i < 16; i++) s.w.step(s.d.frame(['Space', 'D']));
        s.w.step(s.d.frame(['D']));
        s.w.step(s.d.frame([key, 'D']));
        for (let i = 0; i < 60; i++) s.w.step(s.d.frame(['D']));
        return { x: s.p.pos.x, y: s.p.pos.y, e: s.p.account.energy, log: s.w.exchange.log.map((t) => `${t.label}:${t.energy.toFixed(4)}`) };
      };
      expect(run(g2)).toEqual(run(g));
    }
  });
});
