import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import type { MechanicHost } from '../src/mechanics/runtime';
import { Walker } from '../src/sim/entities/enemies';
import { Dynamo, Target } from '../src/sim/entities/props';
import { windupFactor } from '../src/sim/exchange/formulas';
import type { World } from '../src/sim/World';
import { Driver, makeWorld } from './helpers';

/** Every unit of energy is accounted for: held + committed + in flight = start + income − spent − lost. */
function conserved(w: World, host: MechanicHost): number {
  const p = w.player!;
  const { reservoir, committed } = w.exchange.holdings(p);
  const a = w.exchange.audit;
  return reservoir + committed + host.pooledEnergy() - (a.start + a.income - a.spent - a.dissipated);
}

function stage(build: (b: GraphBuilder) => void, opts: { energy?: number; law?: boolean } = {}) {
  const b = new GraphBuilder('Under test');
  build(b);
  const w = makeWorld({ lawEnabled: opts.law ?? true });
  const { host, rejected } = attachMechanics(w, [b.build()]);
  expect(rejected.flatMap((r) => r.issues.filter((i) => i.severity === 'error'))).toEqual([]);
  const d = new Driver(w);
  d.run(0.3);
  const p = w.player!;
  if (opts.energy != null) {
    p.account.energy = opts.energy;
    w.exchange.resetAudit(opts.energy);
  }
  return { w, d, p, host, id: b.graph.id };
}

describe('energy: reservoir, commitment and progressive expenditure', () => {
  it('an 80 E action runs at once when 80 E is available', () => {
    const { d, p, w } = stage((b) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      // 0.4 kg at 1840 px/s: ½·0.4·18.4² = 67.7 E of kinetic energy + momentum term → ~ 89.2 E
      const shot = b.node('act.projectile', { speed: 1700, mass: 0.45, dir: { x: 1, y: 0 } });
      b.flow(ev, 'then', shot);
    }, { energy: 100 });
    d.tap('Q', 1);
    const txn = w.exchange.log.find((t) => t.label === 'Projectile')!;
    expect(txn.ok).toBe(true);
    expect(txn.energy).toBeGreaterThan(80);
    expect(p.account.energy).toBeCloseTo(100 - txn.energy, 5);
  });

  it('a 250 E effect is charged progressively from a real source, then paid in one go', () => {
    const { d, p, w, host } = stage(
      (b) => {
        const ev = b.node('on.keyPressed', { key: 'Q' });
        const ch = b.node('act.channelUntil', { name: 'Big', amount: 250 });
        const shot = b.node('act.projectile', { speed: 2200, mass: 0.8, dir: { x: 1, y: 0 } });
        const kept = b.node('var.setNumber', { name: 'charged', scope: 'character' });
        b.flow(ev, 'then', ch).flow(ch, 'charged', kept).wire(ch, 'energy', kept, 'value').flow(kept, 'then', shot);
      },
      { energy: 100 },
    );
    const dyn = w.add(new Dynamo(p.pos.x, p.pos.y - 20, 400, 150))!;
    d.tap('Q', 1);
    let maxCharge = 0;
    for (let i = 0; i < 60 * 12 && !w.exchange.log.some((t) => t.label === 'Projectile'); i++) {
      d.run(1 / 60);
      maxCharge = Math.max(maxCharge, p.account.charges.get('Big')?.amount ?? 0);
      expect(Math.abs(conserved(w, host))).toBeLessThan(1e-6);
      expect(p.account.energy).toBeLessThanOrEqual(p.account.capacity + 1e-9);
    }
    // The charge held more than the reservoir ever can.
    expect(maxCharge).toBeGreaterThan(p.account.capacity * 2);
    expect(host.characterScope.numbers.get('charged')).toBeGreaterThan(250 - 1e-6);
    const txn = w.exchange.log.find((t) => t.label === 'Projectile')!;
    expect(txn.ok).toBe(true);
    // ~6 s of channelling made it cheaper than its 250+ E list price, and the dynamo really paid for it.
    expect(txn.energy).toBeLessThan(250);
    expect(400 - dyn.reserve).toBeGreaterThan(150);
    expect(Math.abs(conserved(w, host))).toBeLessThan(1e-6);
  });

  it('without a source, a charge never exceeds what the reservoir could give', () => {
    const { d, p, w, host } = stage(
      (b) => {
        const ev = b.node('on.keyPressed', { key: 'Q' });
        const ch = b.node('act.channelUntil', { name: 'Big', amount: 250 });
        const strike = b.node('act.consume', { amount: 1 });
        b.flow(ev, 'then', ch).flow(ch, 'charged', strike);
      },
      { energy: 100 },
    );
    d.tap('Q', 1);
    d.run(20);
    expect(p.account.charges.get('Big')!.amount).toBeCloseTo(100, 5);
    expect(p.account.energy).toBeCloseTo(0, 5);
    expect(w.exchange.log.some((t) => t.label === 'Consume')).toBe(false);
    expect(Math.abs(conserved(w, host))).toBeLessThan(1e-6);
  });

  it('two mechanics cannot both spend one charge', () => {
    const b1 = new GraphBuilder('A');
    const e1 = b1.node('on.keyPressed', { key: 'R' });
    const r1 = b1.node('act.releaseCharge', { name: 'Pot' });
    const s1 = b1.node('act.consume', { amount: 60 });
    b1.flow(e1, 'then', r1).flow(r1, 'then', s1);
    const b2 = new GraphBuilder('B');
    const e2 = b2.node('on.keyPressed', { key: 'R' });
    const r2 = b2.node('act.releaseCharge', { name: 'Pot' });
    const s2 = b2.node('act.consume', { amount: 60 });
    b2.flow(e2, 'then', r2).flow(r2, 'then', s2);
    const w = makeWorld();
    const { host } = attachMechanics(w, [b1.build(), b2.build()]);
    const d = new Driver(w);
    d.run(0.3);
    const p = w.player!;
    p.account.energy = 0;
    p.account.charges.set('Pot', { amount: 80, channeling: false, startedAt: 0, windup: 0, windupEndedAt: null });
    w.exchange.resetAudit(80);
    d.tap('R', 1);
    const consumes = w.exchange.log.filter((t) => t.label === 'Consume');
    expect(consumes.map((t) => t.ok)).toEqual([true, false]);
    // 80 released, 60 spent, 20 back in the reservoir; the second mechanic found the charge empty.
    expect(p.account.energy).toBeCloseTo(20, 5);
    expect(Math.abs(conserved(w, host))).toBeLessThan(1e-6);
  });
});

describe('windup', () => {
  function windupJump(seconds: number) {
    return (b: GraphBuilder) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const wu = b.node('act.windUp', { seconds });
      const shot = b.node('act.strike', { amount: 60 });
      const near = b.node('entity.nearest', { filter: 'target', radius: 300 });
      const fail = b.node('var.setFlag', { name: 'interrupted', scope: 'character', value: true });
      b.flow(ev, 'then', wu).flow(wu, 'then', shot).wire(near, 'out', shot, 'target').flow(wu, 'interrupted', fail);
    };
  }

  it('preparation cuts the energy price by the documented formula, with diminishing returns', () => {
    const t = makeWorld().exchange.table;
    expect(windupFactor(t, 0)).toBe(1);
    expect(windupFactor(t, 2)).toBeCloseTo(1 - 0.4 * (1 - Math.exp(-1)), 9);
    // Never free, however long you wait.
    expect(windupFactor(t, 1e6)).toBeCloseTo(0.6, 9);
    const gains = [0.5, 1, 2, 4, 8].map((s) => windupFactor(t, s));
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1]);
    expect(gains[3] - gains[4]).toBeLessThan(gains[0] - gains[1]);

    for (const s of [0.5, 2, 6]) {
      const { d, w } = stage(windupJump(s), { energy: 100 });
      w.add(new Target(470, 570, 1000));
      d.tap('Q', 1);
      d.run(s + 0.2);
      const txn = w.exchange.log.find((x) => x.label === 'Strike')!;
      expect(txn.ok).toBe(true);
      expect(txn.energy).toBeCloseTo(60 * windupFactor(t, s), 1);
    }
  });

  it('winding up creates no energy and the world keeps moving', () => {
    const { d, p, w } = stage(windupJump(30), { energy: 50 });
    const walker = w.add(new Walker(1500, 560))!;
    const x0 = walker.pos.x;
    d.tap('Q', 1);
    d.run(10);
    expect(p.account.energy).toBe(50);
    expect(p.windingUp).toBe(1);
    expect(Math.abs(walker.pos.x - x0)).toBeGreaterThan(50);
  });

  it('a hit breaks a windup and takes the Interrupted path', () => {
    const { d, p, w, host } = stage(windupJump(2), { energy: 100 });
    w.add(new Target(470, 570, 1000));
    d.tap('Q', 1);
    d.run(0.5);
    w.combat.hazard(p, p.pos, 10);
    d.run(2);
    expect(host.characterScope.flags.get('interrupted')).toBe(true);
    expect(w.exchange.log.some((t) => t.label === 'Strike')).toBe(false);
    expect(p.windingUp).toBe(0);
  });

  it('held preparation erodes: time cannot be banked', () => {
    const { d, p, w } = stage(
      (b) => {
        const press = b.node('on.keyPressed', { key: 'Q' });
        const begin = b.node('act.beginCharge', { name: 'C' });
        b.flow(press, 'then', begin);
        const hold = b.node('on.keyPressed', { key: 'G' });
        const stop = b.node('act.holdCharge', { name: 'C' });
        b.flow(hold, 'then', stop);
        const go = b.node('on.keyPressed', { key: 'R' });
        const rel = b.node('act.releaseCharge', { name: 'C' });
        const c = b.node('act.strike', { amount: 30 });
        const near = b.node('entity.nearest', { filter: 'target', radius: 300 });
        b.flow(go, 'then', rel).flow(rel, 'then', c).wire(near, 'out', c, 'target');
      },
      { energy: 100 },
    );
    w.add(new Target(470, 570, 1000));
    d.tap('Q', 1);
    d.run(2);
    d.tap('G', 1);
    const ch = p.account.charges.get('C')!;
    expect(w.exchange.chargeWindup(ch)).toBeGreaterThan(1.9);
    d.run(3); // held for 3 s: the 2 s of preparation are gone, the energy is not
    expect(w.exchange.chargeWindup(ch)).toBe(0);
    expect(ch.amount).toBeGreaterThan(70);
    d.tap('R', 1);
    const txn = w.exchange.log.find((x) => x.label === 'Strike')!;
    expect(txn.energy).toBeCloseTo(30, 5);
  });

  it('being hurt while channelling scatters half the charge; the loss is recorded, not hidden', () => {
    const { d, p, w, host } = stage(
      (b) => {
        const ev = b.node('on.keyPressed', { key: 'Q' });
        const begin = b.node('act.beginCharge', { name: 'C' });
        b.flow(ev, 'then', begin);
      },
      { energy: 100 },
    );
    d.tap('Q', 1);
    d.run(1);
    const before = p.account.charges.get('C')!.amount;
    w.combat.hazard(p, p.pos, 10);
    expect(p.account.charges.get('C')!.amount).toBeCloseTo(before / 2, 5);
    expect(w.exchange.audit.dissipated).toBeCloseTo(before / 2, 5);
    expect(Math.abs(conserved(w, host))).toBeLessThan(1e-6);
  });
});

describe('extremes and the sandbox switch', () => {
  it('huge but valid numbers neither crash nor produce NaN', () => {
    const { d, p, w } = stage(
      (b) => {
        const ev = b.node('on.keyPressed', { key: 'Q' });
        const imp = b.node('act.impulse', { impulse: { x: 1e12, y: -1e15 } });
        const shot = b.node('act.projectile', { speed: 1e9, mass: 1e9 });
        const strike = b.node('act.strike', { amount: 1e300 });
        b.flow(ev, 'then', imp).flow(imp, 'failed', shot).flow(shot, 'failed', strike);
      },
      { energy: 100 },
    );
    d.tap('Q', 1);
    d.run(1);
    expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)).toBe(true);
    expect(Number.isFinite(p.account.energy)).toBe(true);
    expect(w.exchange.log.filter((t) => !t.ok).every((t) => t.failKind === 'resources' || t.failKind === 'target')).toBe(true);
  });

  it('with the law off, costs go but authored conditions still decide', () => {
    const { d, w } = stage(
      (b) => {
        const ev = b.node('on.keyPressed', { key: 'Q' });
        const iff = b.node('flow.if');
        const cmp = b.node('logic.compare', { a: 1, op: '>', b: 2 });
        const strike = b.node('act.strike', { amount: 1e6 });
        const near = b.node('entity.nearest', { filter: 'target', radius: 300 });
        b.flow(ev, 'then', iff).wire(cmp, 'out', iff, 'cond').flow(iff, 'then', strike).wire(near, 'out', strike, 'target');
        const ev2 = b.node('on.keyPressed', { key: 'R' });
        const strike2 = b.node('act.strike', { amount: 1e6 });
        b.flow(ev2, 'then', strike2).wire(near, 'out', strike2, 'target');
      },
      { law: false },
    );
    const t = w.add(new Target(470, 570, 2e6))!;
    d.tap('Q', 1);
    expect(t.hp).toBe(t.maxHp);
    d.tap('R', 1);
    expect(t.maxHp - t.hp).toBeCloseTo(1e6, 0);
  });
});
