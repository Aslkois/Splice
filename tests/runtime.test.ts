import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import { compileGraph } from '../src/mechanics/compile';
import { LIMITS, type MechanicHost } from '../src/mechanics/runtime';
import { deserializeGraph, exportShareCode, importShareCode, serializeGraph } from '../src/mechanics/serialize';
import { Driver, makeWorld } from './helpers';

function settle(d: Driver) {
  d.run(0.5);
}

describe('mechanic runtime', () => {
  it('runs an authored graph: On Q Pressed → Apply Impulse lifts the player', () => {
    const b = new GraphBuilder('Hop');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const imp = b.node('act.impulse', { impulse: { x: 0, y: -600 } });
    b.flow(ev, 'then', imp);
    const w = makeWorld();
    const { rejected } = attachMechanics(w, [b.build()]);
    expect(rejected).toHaveLength(0);
    const d = new Driver(w);
    settle(d);
    const p = w.player!;
    const e0 = p.account.energy;
    d.tap('Q', 1);
    expect(p.vel.y).toBeLessThan(-450);
    expect(p.account.energy).toBeLessThan(e0);
  });

  it('branches with If/Compare and remembers variables between runs', () => {
    const b = new GraphBuilder('Counter');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const add = b.node('var.addNumber', { name: 'n', value: 1 });
    const get = b.node('var.getNumber', { name: 'n' });
    const cmp = b.node('logic.compare', { op: '>=', b: 3 });
    const iff = b.node('flow.if');
    const flag = b.node('var.setFlag', { name: 'third', value: true });
    b.flow(ev, 'then', add).flow(add, 'then', iff).flow(iff, 'then', flag);
    b.wire(get, 'out', cmp, 'a').wire(cmp, 'out', iff, 'cond');
    const w = makeWorld();
    const { host } = attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    settle(d);
    const mechId = b.graph.id;
    d.tap('Q', 1);
    d.tap('Q', 1);
    expect(host.scopeOf(mechId).flags.get('third')).toBeUndefined();
    d.tap('Q', 1);
    expect(host.scopeOf(mechId).numbers.get('n')).toBe(3);
    expect(host.scopeOf(mechId).flags.get('third')).toBe(true);
  });

  it('Delay continues later while the world keeps running', () => {
    const b = new GraphBuilder('Late');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const delay = b.node('flow.delay', { seconds: 0.5 });
    const set = b.node('var.setNumber', { name: 't' });
    const now = b.node('time.now');
    b.flow(ev, 'then', delay).flow(delay, 'then', set).wire(now, 'out', set, 'value');
    const w = makeWorld();
    const { host } = attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    settle(d);
    const pressedAt = w.time;
    d.tap('Q', 1);
    expect(host.scopeOf(b.graph.id).numbers.get('t')).toBeUndefined();
    d.run(0.6);
    const t = host.scopeOf(b.graph.id).numbers.get('t')!;
    expect(t - pressedAt).toBeGreaterThanOrEqual(0.5);
    expect(t - pressedAt).toBeLessThan(0.6);
  });

  it('Cooldown Gate only passes once per interval', () => {
    const b = new GraphBuilder('Gate');
    const ev = b.node('on.tick');
    const gate = b.node('flow.cooldown', { seconds: 0.5 });
    const add = b.node('var.addNumber', { name: 'passes' });
    b.flow(ev, 'then', gate).flow(gate, 'pass', add);
    const w = makeWorld();
    const { host } = attachMechanics(w, [b.build()]);
    new Driver(w).run(2.0);
    const passes = host.scopeOf(b.graph.id).numbers.get('passes')!;
    expect(passes).toBeGreaterThanOrEqual(4);
    expect(passes).toBeLessThanOrEqual(5);
  });

  it('an exec loop cannot hang the simulation; it is stopped and diagnosed', () => {
    const b = new GraphBuilder('Spinner');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const add = b.node('var.addNumber', { name: 'spins' });
    b.flow(ev, 'then', add).flow(add, 'then', add);
    const g = b.build();
    expect(compileGraph(g).issues.some((i) => i.message.includes('loops back'))).toBe(true);
    const w = makeWorld();
    const { host } = attachMechanics(w, [g]);
    const d = new Driver(w);
    settle(d);
    const t0 = performance.now();
    d.tap('Q', 1);
    d.run(0.2);
    expect(performance.now() - t0).toBeLessThan(1000);
    const spins = host.scopeOf(g.id).numbers.get('spins')!;
    expect(spins).toBeGreaterThan(100);
    expect(spins).toBeLessThanOrEqual(LIMITS.stepsPerTick);
    expect(w.diagnostics.some((x) => x.message.includes('Spinner'))).toBe(true);
  });

  it('mechanics that signal each other forever are bounded', () => {
    const a = new GraphBuilder('Ping');
    const onPing = a.node('on.signal', { name: 'ping' });
    const emitPong = a.node('flow.emit', { name: 'pong' });
    a.flow(onPing, 'then', emitPong);
    const kick = a.node('on.keyPressed', { key: 'Q' });
    const emitPing = a.node('flow.emit', { name: 'ping' });
    a.flow(kick, 'then', emitPing);
    const b = new GraphBuilder('Pong');
    const onPong = b.node('on.signal', { name: 'pong' });
    const count = b.node('var.addNumber', { name: 'bounces', scope: 'character' });
    const emitPing2 = b.node('flow.emit', { name: 'ping' });
    b.flow(onPong, 'then', count).flow(count, 'then', emitPing2);
    const w = makeWorld();
    const { host } = attachMechanics(w, [a.build(), b.build()]);
    const d = new Driver(w);
    settle(d);
    d.tap('Q', 1);
    d.run(0.5);
    const bounces = host.characterScope.numbers.get('bounces') ?? 0;
    expect(bounces).toBeGreaterThan(0);
    expect(bounces).toBeLessThanOrEqual(LIMITS.maxEmitDepth);
    expect(w.diagnostics.some((x) => x.message.includes('levels deep'))).toBe(true);
  });

  it('rejects graphs whose values feed into themselves', () => {
    const b = new GraphBuilder('Ouroboros');
    const m1 = b.node('num.math');
    const m2 = b.node('num.math');
    b.wire(m1, 'out', m2, 'a').wire(m2, 'out', m1, 'a');
    const ev = b.node('on.tick');
    const set = b.node('var.setNumber', { name: 'x' });
    b.flow(ev, 'then', set).wire(m1, 'out', set, 'value');
    const c = compileGraph(b.build());
    expect(c.ok).toBe(false);
    expect(c.issues.some((i) => i.severity === 'error' && i.message.includes('feed back'))).toBe(true);
  });

  it('rejects mismatched wires with a helpful hint', () => {
    const b = new GraphBuilder('Mismatch');
    const ev = b.node('on.keyPressed');
    const iff = b.node('flow.if');
    const n = b.node('num.const', { value: 3 });
    b.flow(ev, 'then', iff).wire(n, 'out', iff, 'cond');
    const c = compileGraph(b.build());
    expect(c.ok).toBe(false);
    expect(c.issues.find((i) => i.severity === 'error')!.message).toContain('Compare');
  });

  it('flags locked primitives in the campaign', () => {
    const b = new GraphBuilder('Too Early');
    const ev = b.node('on.incomingHit');
    const r = b.node('act.prevent');
    b.flow(ev, 'then', r);
    expect(compileGraph(b.build(), { maxTier: 0 }).ok).toBe(false);
    expect(compileGraph(b.build(), { maxTier: 2 }).ok).toBe(true);
  });

  it('warns when a hit-only action runs after a Delay', () => {
    const b = new GraphBuilder('Late Reflect');
    const ev = b.node('on.incomingHit');
    const delay = b.node('flow.delay', { seconds: 0.1 });
    const r = b.node('act.reflect');
    b.flow(ev, 'then', delay).flow(delay, 'then', r);
    expect(compileGraph(b.build()).issues.some((i) => i.message.includes('only works while a hit is incoming'))).toBe(true);
  });

  it('Repeat is bounded', () => {
    const b = new GraphBuilder('Many');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const rep = b.node('flow.repeat', { count: 10000 });
    const add = b.node('var.addNumber', { name: 'k' });
    b.flow(ev, 'then', rep).flow(rep, 'body', add);
    const w = makeWorld();
    const { host } = attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    settle(d);
    d.tap('Q', 1);
    expect(host.scopeOf(b.graph.id).numbers.get('k')).toBe(LIMITS.maxRepeat);
  });

  it('handlers resolve in slot order, then canvas order (top to bottom)', () => {
    const order: string[] = [];
    const mk = (name: string, y: number) => {
      const b = new GraphBuilder(name);
      const ev = b.node('on.keyPressed', { key: 'Q' }, { x: 0, y });
      const add = b.node('var.addNumber', { name: 'seq', scope: 'character', value: 1 }, { x: 200, y });
      const set = b.node('var.setNumber', { name: name, scope: 'character' }, { x: 400, y });
      const get = b.node('var.getNumber', { name: 'seq', scope: 'character' }, { x: 300, y: y + 60 });
      b.flow(ev, 'then', add).flow(add, 'then', set).wire(get, 'out', set, 'value');
      return b.build();
    };
    const w = makeWorld();
    const { host } = attachMechanics(w, [mk('second', 0), mk('first', 0)]);
    const d = new Driver(w);
    settle(d);
    d.tap('Q', 1);
    order.push(...['second', 'first'].sort((a, b) => host.characterScope.numbers.get(a)! - host.characterScope.numbers.get(b)!));
    expect(order).toEqual(['second', 'first']);
  });

  it('saving and reloading a mechanic preserves its behaviour', () => {
    const b = new GraphBuilder('Bounce');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const notG = b.node('logic.not');
    const g = b.node('state.grounded');
    const iff = b.node('flow.if');
    const imp = b.node('act.impulse', { impulse: { x: 220, y: -520 } });
    b.flow(ev, 'then', iff).flow(iff, 'then', imp).wire(g, 'out', notG, 'a').wire(notG, 'out', iff, 'cond');
    const original = b.build();
    const reloaded = importShareCode(exportShareCode(deserializeGraph(serializeGraph(original))));
    expect(reloaded).toEqual(original);

    const trial = (graph: typeof original) => {
      const w = makeWorld();
      attachMechanics(w, [graph]);
      const d = new Driver(w);
      settle(d);
      d.tap('Space', 6);
      d.run(0.1);
      d.tap('Q', 1);
      d.run(0.4);
      return { x: w.player!.pos.x, y: w.player!.pos.y, e: w.player!.account.energy };
    };
    expect(trial(reloaded)).toEqual(trial(original));
  });

  it('host exposes per-node traces for the workshop', () => {
    const b = new GraphBuilder('Trace');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const c = b.node('act.consume', { amount: 1e6 });
    b.flow(ev, 'then', c);
    const w = makeWorld();
    const { host } = attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    settle(d);
    d.tap('Q', 1);
    const t = (host as MechanicHost).traces.get(b.graph.id)!.get(c)!;
    expect(t.fails).toBe(1);
    expect(t.lastFail).toMatch(/needs/);
  });
});

describe('hot reload', () => {
  it('swapping mechanics refunds energy held by pending executions', () => {
    const b = new GraphBuilder('Slow Spend');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const begin = b.node('act.beginCharge', { name: 'C' });
    b.flow(ev, 'then', begin);
    const ev2 = b.node('on.keyPressed', { key: 'R' });
    const rel = b.node('act.releaseCharge', { name: 'C' });
    const wait = b.node('flow.delay', { seconds: 5 });
    b.flow(ev2, 'then', rel).flow(rel, 'then', wait);
    const w = makeWorld();
    attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    d.run(0.2);
    w.player!.account.energy = 60;
    d.tap('Q', 1);
    d.run(1);
    d.tap('R', 1);
    const held = 60 - w.player!.account.energy;
    expect(held).toBeGreaterThan(25);
    attachMechanics(w, []);
    expect(w.player!.account.energy).toBeCloseTo(60, 5);
  });
});
