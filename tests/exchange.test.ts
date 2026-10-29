import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import { Walker } from '../src/sim/entities/enemies';
import { Target } from '../src/sim/entities/props';
import { World } from '../src/sim/World';
import { C1 } from '../src/sim/levels/levels';
import { Driver, makeWorld } from './helpers';

function strikeGraph(amount: number, opts: { channel?: number } = {}) {
  const b = new GraphBuilder('Strike');
  const ev = b.node('on.keyPressed', { key: 'Q' });
  const near = b.node('entity.nearest', { filter: 'target', radius: 200 });
  const strike = b.node('act.strike', { amount });
  b.wire(near, 'out', strike, 'target');
  if (opts.channel != null) {
    const ch = b.node('act.channelUntil', { name: 'Windup', amount: opts.channel });
    b.flow(ev, 'then', ch).flow(ch, 'charged', strike);
  } else b.flow(ev, 'then', strike);
  return b.build();
}

function arena(graph: ReturnType<typeof strikeGraph>, opts: { lawEnabled?: boolean; targetHp?: number } = {}) {
  const w = makeWorld({ lawEnabled: opts.lawEnabled ?? true });
  attachMechanics(w, [graph]);
  const d = new Driver(w);
  d.run(0.5);
  const t = w.add(new Target(470, 570, opts.targetHp ?? 1e7))!;
  return { w, d, p: w.player!, t };
}

describe('Law of Equivalent Exchange', () => {
  it('a strike is paid in energy, 1 E per HP', () => {
    const { d, p, t } = arena(strikeGraph(20));
    const e0 = p.account.energy;
    const hp0 = t.hp;
    d.tap('Q', 1);
    expect(hp0 - t.hp).toBeCloseTo(20, 5);
    expect(e0 - p.account.energy).toBeCloseTo(20, 5);
  });

  it('insufficient energy fails atomically: nothing is spent, nothing happens', () => {
    const { d, p, t } = arena(strikeGraph(30));
    p.account.energy = 10;
    const hp0 = t.hp;
    d.tap('Q', 1);
    expect(t.hp).toBe(hp0);
    expect(p.account.energy).toBe(10);
  });

  it('big effects exceed the instant limit and need a channelled windup', () => {
    const { d, p, t, w } = arena(strikeGraph(90));
    p.account.energy = 100;
    d.tap('Q', 1);
    expect(t.hp).toBe(t.maxHp);
    expect(w.exchange.log.at(-1)?.reason).toMatch(/instant limit/);
  });

  it('charging takes real time while the world keeps running, then pays for the strike', () => {
    const { d, p, t, w } = arena(strikeGraph(90, { channel: 90 }));
    const walker = w.add(new Walker(1500, 560))!;
    d.run(0.3);
    const wx0 = walker.pos.x;
    p.account.energy = 100;
    const t0 = w.time;
    d.tap('Q', 1);
    let struckAt = -1;
    for (let i = 0; i < 400 && struckAt < 0; i++) {
      d.run(1 / 60);
      if (t.hp < t.maxHp) struckAt = w.time;
    }
    const windup = struckAt - t0;
    // 90 E at a 30 E/s channel rate is a 3 s windup.
    expect(windup).toBeGreaterThan(2.9);
    expect(windup).toBeLessThan(3.3);
    expect(t.maxHp - t.hp).toBeCloseTo(90, 3);
    expect(p.account.energy).toBeCloseTo(10, 0);
    expect(Math.abs(walker.pos.x - wx0)).toBeGreaterThan(50);
  });

  it('waiting generates no energy', () => {
    const w = makeWorld();
    const d = new Driver(w);
    d.run(0.2);
    const e0 = w.player!.account.energy;
    d.run(30);
    expect(w.player!.account.energy).toBe(e0);
  });

  it('999,999 damage is constructible but needs 999,999 E of real input', () => {
    const { d, p, t, w } = arena(strikeGraph(999999, { channel: 999999 }), { targetHp: 2e6 });
    p.account.energy = 100;
    d.tap('Q', 1);
    d.run(10);
    expect(t.hp).toBe(t.maxHp);
    expect(p.account.energy).toBeLessThan(1);
    // The charge holds what the battery could give — a fraction of what is required.
    const ch = p.account.charges.get('Windup');
    expect(ch?.amount ?? 0).toBeCloseTo(100, 0);
    expect(w.time).toBeGreaterThan(10);
  });

  it('with the Law OFF in the sandbox, the same graph lands 999,999 instantly', () => {
    const { d, t } = arena(strikeGraph(999999), { lawEnabled: false, targetHp: 2e6 });
    d.tap('Q', 1);
    expect(t.maxHp - t.hp).toBeCloseTo(999999, 0);
  });

  it('setting a variable never creates resources', () => {
    const b = new GraphBuilder('Counterfeit');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const set = b.node('var.setNumber', { name: 'energy', scope: 'character', value: 999999 });
    b.flow(ev, 'then', set);
    const w = makeWorld();
    attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    d.run(0.2);
    const e0 = w.player!.account.energy;
    d.tap('Q', 1);
    expect(w.player!.account.energy).toBe(e0);
  });

  it('projectile damage comes from kinetic energy, not from a typed number', () => {
    const b = new GraphBuilder('Gun');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const shot = b.node('act.projectile', { speed: 900, mass: 0.3 });
    b.flow(ev, 'then', shot);
    const w = makeWorld();
    attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    d.run(0.4);
    const t = w.add(new Target(700, 572, 1000))!;
    const e0 = w.player!.account.energy;
    d.tap('Q', 1);
    d.run(0.6);
    const ke = 0.5 * 0.3 * 9 * 9;
    expect(t.maxHp - t.hp).toBeCloseTo(ke, 1);
    expect(e0 - w.player!.account.energy).toBeCloseTo((ke + 0.5 * 0.3 * 9) / 0.8, 3);
  });

  it('resources cannot be spent twice by simultaneous operations', () => {
    const b = new GraphBuilder('Twins');
    const ev1 = b.node('on.keyPressed', { key: 'Q' }, { x: 0, y: 0 });
    const c1 = b.node('act.consume', { amount: 30 }, { x: 200, y: 0 });
    const ev2 = b.node('on.keyPressed', { key: 'Q' }, { x: 0, y: 100 });
    const c2 = b.node('act.consume', { amount: 30 }, { x: 200, y: 100 });
    const flag = b.node('var.setFlag', { name: 'second' }, { x: 400, y: 100 });
    b.flow(ev1, 'then', c1).flow(ev2, 'then', c2).flow(c2, 'then', flag);
    const w = makeWorld();
    const { host } = attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    d.run(0.2);
    w.player!.account.energy = 40;
    d.tap('Q', 1);
    expect(w.player!.account.energy).toBeCloseTo(10, 5);
    expect(host.scopeOf(b.graph.id).flags.get('second')).toBeUndefined();
  });

  it('released charge funds big actions; unspent energy returns to the battery', () => {
    const b = new GraphBuilder('Bank');
    const hold = b.node('on.keyPressed', { key: 'Q' });
    const begin = b.node('act.beginCharge', { name: 'Bank' });
    b.flow(hold, 'then', begin);
    const rel = b.node('on.keyReleased', { key: 'Q' });
    const release = b.node('act.releaseCharge', { name: 'Bank' });
    const near = b.node('entity.nearest', { filter: 'target', radius: 200 });
    const strike = b.node('act.strike', { amount: 50 });
    b.flow(rel, 'then', release).flow(release, 'then', strike).wire(near, 'out', strike, 'target');
    const w = makeWorld();
    attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    d.run(0.4);
    const t = w.add(new Target(470, 570, 1000))!;
    w.player!.account.energy = 100;
    d.run(3, ['Q']);
    d.run(0.1);
    expect(t.maxHp - t.hp).toBeCloseTo(50, 3);
    // ~90 E channelled in 3 s, 50 spent, ~40 refunded, plus the ~10 never channelled.
    expect(w.player!.account.energy).toBeGreaterThan(48);
    expect(w.player!.account.energy).toBeLessThan(52);
  });

  it('the campaign cannot switch the law off', () => {
    const w = new World({ level: C1, mode: 'campaign', lawEnabled: false });
    expect(w.lawEnabled).toBe(true);
    expect(w.setLaw(false)).toBe(false);
    expect(w.lawEnabled).toBe(true);
  });

  it('taking damage while channelling scatters half the charge', () => {
    const b = new GraphBuilder('Fragile');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const begin = b.node('act.beginCharge', { name: 'C' });
    b.flow(ev, 'then', begin);
    const w = makeWorld();
    attachMechanics(w, [b.build()]);
    const d = new Driver(w);
    d.run(0.3);
    w.player!.account.energy = 100;
    d.tap('Q', 1);
    d.run(1);
    const before = w.player!.account.charges.get('C')!.amount;
    w.combat.hazard(w.player!, w.player!.pos, 10);
    const after = w.player!.account.charges.get('C')!;
    expect(after.channeling).toBe(false);
    expect(after.amount).toBeCloseTo(before * 0.5, 3);
  });
});

describe('cost previews match what the ledger charges', () => {
  it('impulse and projectile previews agree with real transactions', async () => {
    const { previewCost } = await import('../src/mechanics/costPreview');
    const b = new GraphBuilder('Price check');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const imp = b.node('act.impulse', { impulse: { x: 0, y: -650 } });
    const ev2 = b.node('on.keyPressed', { key: 'R' });
    const shot = b.node('act.projectile', { speed: 1200, mass: 0.2 });
    b.flow(ev, 'then', imp).flow(ev2, 'then', shot);
    const g = b.build();
    const w = makeWorld();
    attachMechanics(w, [g]);
    const d = new Driver(w);
    d.run(0.3);
    d.tap('Q', 1);
    d.tap('R', 1);
    const [ti, tp] = w.exchange.log.filter((t) => t.ok && (t.label === 'Impulse' || t.label === 'Projectile'));
    const pi = previewCost(g.nodes.find((n) => n.id === imp)!, () => false)!;
    const pp = previewCost(g.nodes.find((n) => n.id === shot)!, () => false)!;
    expect(pi).toContain(`${Math.round(ti.energy * 10) / 10} E`);
    expect(pp).toContain(`${Math.round(tp.energy * 10) / 10} E`);
  });
});
