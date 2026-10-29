import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import { MechanicHost } from '../src/mechanics/runtime';
import { TraceLog } from '../src/mechanics/trace';
import { validateGraph } from '../src/mechanics/validate';
import { Target } from '../src/sim/entities/props';
import { Driver, makeWorld } from './helpers';
import { addShooter, deathParry, fireSlug } from './fixtures';

function stage(graphs: Parameters<typeof attachMechanics>[1], lawEnabled = true) {
  const w = makeWorld({ lawEnabled });
  const att = attachMechanics(w, graphs);
  const d = new Driver(w);
  d.run(0.5);
  return { w, d, p: w.player!, host: att.host };
}

describe('failure categories', () => {
  it('the exchange says why an operation failed', () => {
    const { w, p } = stage([]);
    p.account.energy = 1;
    expect(w.exchange.perform('strike', p, { target: p, amount: 50 }).failKind).toBe('target'); // can't strike yourself
    const far = w.add(new Target(2000, 560, 50))!;
    expect(w.exchange.perform('strike', p, { target: far, amount: 5 }).failKind).toBe('target'); // out of reach
    expect(w.exchange.perform('impulse', p, { target: p, impulse: { x: 0, y: -900 } }).failKind).toBe('resources');
    p.account.energy = 100;
    expect(w.exchange.perform('impulse', p, { target: p, impulse: { x: 0, y: -2000 } }).failKind).toBe('resources'); // instant limit
    const r = w.exchange.perform('impulse', p, { target: p, impulse: { x: 0, y: -300 } });
    expect(r.ok).toBe(true);
    expect(r.failKind).toBeUndefined();
    // The ledger keeps the category too.
    expect(w.exchange.log.filter((t) => !t.ok).map((t) => t.failKind)).toEqual(['target', 'target', 'resources', 'resources']);
  });

  it('acting on a hit that is not open is a requirement failure, not a resource one', () => {
    const b = new GraphBuilder('Late');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const reflect = b.node('act.reflect');
    b.flow(ev, 'then', reflect);
    const { d, host } = stage([b.build()]);
    d.tap('Q');
    const e = host.traceLog.entries().find((x) => x.nodeType === 'act.reflect')!;
    expect(e.ok).toBe(false);
    expect(e.category).toBe('requirement');
    expect(e.port).toBe('failed');
  });
});

describe('On Hit Resolved (post-hit)', () => {
  function hitResolvedProbe(withReflect = false) {
    const b = new GraphBuilder('After');
    const ev = b.node('on.hitResolved');
    const set = b.node('var.setNumber', { name: 'dmg', scope: 'character' });
    const flag = b.node('var.setFlag', { name: 'prevented', scope: 'character' });
    b.flow(ev, 'then', set).wire(ev, 'damage', set, 'value');
    b.flow(set, 'then', flag).wire(ev, 'prevented', flag, 'value');
    if (withReflect) {
      const r = b.node('act.reflect');
      b.flow(flag, 'then', r);
    }
    return b.build();
  }

  it('fires after damage with what actually happened', () => {
    const hurt = new GraphBuilder('Hurt');
    const dt = hurt.node('on.damageTaken');
    const snd = hurt.node('fx.sound');
    hurt.flow(dt, 'then', snd);
    const s = stage([hitResolvedProbe(), hurt.build()]);
    const shooter = addShooter(s.w, 900, 560);
    const shot = s.w.spawnProjectile({ x: 780, y: 570 }, { x: -700, y: 0 }, { mass: 0.3, ownerId: shooter.id, team: 'enemy' })!;
    const ke = shot.energy;
    s.d.run(0.6);
    expect(s.host.characterScope.numbers.get('dmg')).toBeCloseTo(ke, 5);
    expect(s.p.hp).toBeCloseTo(s.p.maxHp - ke, 5);
    expect(s.host.characterScope.flags.get('prevented')).toBe(false);
    // On Damage Taken (queued during the hit) runs before On Hit Resolved
    const order = s.host.traceLog.entries().filter((e) => e.kind === 'event').map((e) => e.nodeType);
    expect(order).toEqual(['on.damageTaken', 'on.hitResolved']);
  });

  it('also fires for a hit that dealt no damage, and is too late to change it', () => {
    const b = new GraphBuilder('Shield');
    const ev = b.node('on.incomingHit');
    const prevent = b.node('act.prevent');
    b.flow(ev, 'then', prevent);
    const s = stage([b.build(), hitResolvedProbe(true)]);
    const shooter = addShooter(s.w, 900, 560);
    s.w.spawnProjectile({ x: 780, y: 570 }, { x: -700, y: 0 }, { mass: 0.3, ownerId: shooter.id, team: 'enemy' });
    s.d.run(0.6);
    expect(s.p.hp).toBe(s.p.maxHp);
    expect(s.host.characterScope.numbers.get('dmg')).toBe(0);
    expect(s.host.characterScope.flags.get('prevented')).toBe(true);
    const late = s.host.traceLog.entries().find((e) => e.nodeType === 'act.reflect')!;
    expect(late.ok).toBe(false);
    expect(late.reason).toMatch(/already landed/);
    expect(late.category).toBe('requirement');
    // …and the editor warns about it before you ever play.
    const issues = validateGraph(hitResolvedProbe(true));
    expect(issues.some((i) => /after the hit has already landed/.test(i.message))).toBe(true);
  });

  it('lethal defence still works because On Guarded Hit runs before damage', () => {
    const s = stage([deathParry()]);
    const shooter = addShooter(s.w, 900, 560);
    fireSlug(s.w, shooter.id, 780, 570);
    for (let i = 0; i < 11; i++) s.w.step(s.d.frame([]));
    for (let i = 0; i < 60; i++) s.w.step(s.d.frame(['F']));
    expect(s.p.alive).toBe(true);
  });
});

describe('execution trace', () => {
  it('records events and blocks with real simulation timestamps, values and costs', () => {
    const b = new GraphBuilder('Jump');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const iff = b.node('flow.if');
    const grounded = b.node('state.grounded');
    const imp = b.node('act.impulse', { impulse: { x: 0, y: -500 } });
    b.flow(ev, 'then', iff).wire(grounded, 'out', iff, 'cond').flow(iff, 'then', imp);
    const { w, d, host } = stage([b.build()]);
    const tickBefore = w.tick;
    d.tap('Q');
    const entries = host.traceLog.entries();
    expect(entries.map((e) => e.nodeType)).toEqual(['on.keyPressed', 'flow.if', 'act.impulse']);
    for (const e of entries) {
      expect(e.tick).toBe(tickBefore + 1);
      expect(e.time).toBeCloseTo(e.tick / 60, 9);
    }
    expect(new Set(entries.map((e) => e.run)).size).toBe(1);
    const iffE = entries[1];
    expect(iffE.port).toBe('then');
    expect(iffE.values).toEqual([{ port: 'cond', value: 'true' }]);
    const impE = entries[2];
    expect(impE.ok).toBe(true);
    const txn = w.exchange.log.at(-1)!;
    expect(impE.cost!.energy).toBeCloseTo(txn.energy, 9);
    expect(impE.after!.energy).toBeCloseTo(w.player!.account.energy, 9);

    // In the air the condition is false: filed as a condition, not an error.
    d.tap('Q');
    const last = host.traceLog.entries().at(-1)!;
    expect(last.nodeType).toBe('flow.if');
    expect(last.port).toBe('else');
    expect(last.category).toBe('condition');
  });

  it('a delay pauses the run and resumes it under the same run id', () => {
    const b = new GraphBuilder('Later');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const delay = b.node('flow.delay', { seconds: 0.25 });
    const add = b.node('var.addNumber', { name: 'n' });
    b.flow(ev, 'then', delay).flow(delay, 'then', add);
    const { d, host, w } = stage([b.build()]);
    d.tap('Q', 1);
    const start = host.traceLog.entries()[0].tick;
    d.run(0.5);
    const e = host.traceLog.entries();
    expect(e.map((x) => x.kind)).toEqual(['event', 'block', 'wait', 'resume', 'block']);
    expect(new Set(e.map((x) => x.run)).size).toBe(1);
    expect(e[3].tick - start).toBe(15); // 0.25 s at 60 Hz
    expect(w.tick).toBeGreaterThan(e[3].tick);
  });

  it('limits show up as limit entries', () => {
    const b = new GraphBuilder('Spin');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const add = b.node('var.addNumber', { name: 'k' });
    b.flow(ev, 'then', add).flow(add, 'then', add);
    const { d, host } = stage([b.build()]);
    d.tap('Q', 1);
    const lim = host.traceLog.entries().filter((e) => e.kind === 'limit');
    expect(lim).toHaveLength(1);
    expect(lim[0].category).toBe('limit');
    expect(lim[0].text).toMatch(/steps in one tick/);
  });

  it('is a bounded ring buffer and can be cleared', () => {
    const t = new TraceLog(5);
    for (let i = 0; i < 12; i++) t.push({ tick: i, time: i / 60, mechId: 'm', mechName: 'M', run: i, kind: 'event', text: `e${i}`, ok: true });
    expect(t.size).toBe(5);
    expect(t.entries().map((e) => e.text)).toEqual(['e7', 'e8', 'e9', 'e10', 'e11']);
    expect(t.since(10).map((e) => e.text)).toEqual(['e10', 'e11']);
    t.clear();
    expect(t.size).toBe(0);
  });
});

describe('hot reload', () => {
  it('keeps variables, toggles and the trace of mechanics that stay equipped', () => {
    const b = new GraphBuilder('Counter');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const tog = b.node('flow.toggle');
    const add = b.node('var.addNumber', { name: 'n' });
    b.flow(ev, 'then', tog).flow(tog, 'a', add);
    const g = b.build();
    const w = makeWorld();
    const first = attachMechanics(w, [g]).host;
    const d = new Driver(w);
    d.run(0.2);
    d.tap('Q'); // toggle → a: n = 1
    expect(first.scopeOf(g.id).numbers.get('n')).toBe(1);
    const traced = first.traceLog.size;

    // Edit something unrelated and reload: the toggle remembers it is on "b" next.
    const edited = { ...g, name: 'Counter v2' };
    const second = attachMechanics(w, [edited]).host;
    expect(second).not.toBe(first);
    expect(second.scopeOf(g.id).numbers.get('n')).toBe(1);
    expect(second.traceLog.size).toBe(traced);
    d.tap('Q'); // toggle → b: no add
    d.tap('Q'); // toggle → a: n = 2
    expect(second.scopeOf(g.id).numbers.get('n')).toBe(2);
    expect(w.mechanics).toBeInstanceOf(MechanicHost);
  });

  it('forgets state of mechanics that were unequipped', () => {
    const b = new GraphBuilder('Counter');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const add = b.node('var.addNumber', { name: 'n' });
    b.flow(ev, 'then', add);
    const g = b.build();
    const w = makeWorld();
    attachMechanics(w, [g]);
    const d = new Driver(w);
    d.run(0.2);
    d.tap('Q');
    const host = attachMechanics(w, []).host;
    const back = attachMechanics(w, [g]).host;
    expect(host.mechanics).toHaveLength(0);
    expect(back.scopeOf(g.id).numbers.get('n')).toBeUndefined();
  });
});
