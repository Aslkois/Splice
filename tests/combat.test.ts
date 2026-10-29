import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import { Spikes } from '../src/sim/entities/props';
import { Driver, makeWorld } from './helpers';
import { addShooter, blockOnly, deathParry, fireSlug, reflectAlways } from './fixtures';

/** Stage: player at x≈400 facing right, a shooter dummy at x=900. */
function stage(graphs: Parameters<typeof attachMechanics>[1], lawEnabled = true) {
  const w = makeWorld({ lawEnabled });
  attachMechanics(w, graphs);
  const d = new Driver(w);
  d.run(0.5);
  const shooter = addShooter(w, 900, 560);
  return { w, d, p: w.player!, shooter };
}

/** Holds F starting `leadTicks` before the slug would arrive (slug flies ~19 ticks). */
function slugWithGuard(s: ReturnType<typeof stage>, guardEarlyTicks: number, holdF = true) {
  const { w, d, shooter } = s;
  if (guardEarlyTicks > 19) {
    w.step(d.frame(['F']));
    for (let i = 0; i < guardEarlyTicks - 19; i++) w.step(d.frame(['F']));
    fireSlug(w, shooter.id, 780, 570);
  } else {
    fireSlug(w, shooter.id, 780, 570);
    for (let i = 0; i < 19 - guardEarlyTicks; i++) w.step(d.frame([]));
    w.step(d.frame(holdF ? ['F'] : []));
  }
  for (let i = 0; i < 60; i++) w.step(d.frame(holdF ? ['F'] : []));
}

describe('combat pipeline & the Death Parry experiment', () => {
  it('a guard alone does not survive the lethal slug', () => {
    const s = stage([blockOnly()]);
    slugWithGuard(s, 8);
    expect(s.p.alive).toBe(false);
  });

  it('a correctly built, well-timed parry reflects the slug and prevents the lethal hit', () => {
    const s = stage([deathParry()]);
    const hp0 = s.p.hp;
    slugWithGuard(s, 8);
    expect(s.p.alive).toBe(true);
    expect(s.p.hp).toBe(hp0);
    // The slug went back the way it came and destroyed whoever fired it.
    expect(s.shooter.alive).toBe(false);
    const parries = s.w.fx.filter((f) => f.type === 'parry');
    expect(parries.length).toBe(1);
  });

  it('the same mechanic mistimed (guard up too long) follows its own logic and fails', () => {
    const s = stage([deathParry({ window: 0.5 })]);
    slugWithGuard(s, 50); // guard raised ~0.8 s before impact: Timer("Parry") ≥ 0.5
    expect(s.p.alive).toBe(false);
    expect(s.shooter.alive).toBe(true);
  });

  it('reflection without Prevent still lands the (guarded) damage — half a parry is not enough', () => {
    const s = stage([deathParry({ prevent: false })]);
    slugWithGuard(s, 8);
    expect(s.shooter.alive).toBe(false);
    expect(s.p.alive).toBe(false);
  });

  it('works through "On Incoming Hit" too (no special parry class involved)', () => {
    const s = stage([deathParry({ event: 'on.incomingHit' })]);
    slugWithGuard(s, 8);
    expect(s.p.alive).toBe(true);
  });

  it('reflection needs a guard that was up before impact (Law ON)', () => {
    const s = stage([reflectAlways()]);
    fireSlug(s.w, s.shooter.id, 780, 570);
    s.d.run(1);
    expect(s.p.alive).toBe(false);
    const fails = s.w.exchange.log.filter((t) => !t.ok && t.label === 'Redirect');
    expect(fails[0]?.reason).toMatch(/guard/);
  });

  it('raising the guard inside the interception does not count for that hit', () => {
    const b = new GraphBuilder('Panic');
    const ev = b.node('on.incomingHit');
    const block = b.node('act.block');
    const reflect = b.node('act.reflect');
    const prevent = b.node('act.prevent');
    b.flow(ev, 'then', block).flow(block, 'then', reflect).flow(reflect, 'then', prevent);
    const s = stage([b.build()]);
    fireSlug(s.w, s.shooter.id, 780, 570);
    s.d.run(1);
    expect(s.p.alive).toBe(false);
  });

  it('precision costs: the longer the guard was up, the more stamina a reflection takes', () => {
    const cost = (early: number) => {
      const s = stage([deathParry({ window: 5 })]);
      slugWithGuard(s, early);
      const t = s.w.exchange.log.find((x) => x.label === 'Redirect' && x.ok);
      return t?.stamina ?? NaN;
    };
    const tight = cost(3);
    const loose = cost(40);
    expect(tight).toBeLessThan(loose);
    expect(tight).toBeLessThan(10);
  });

  it('hazards cannot be reflected', () => {
    const s = stage([reflectAlways()]);
    s.w.add(new Spikes(380, 590, 60, 10));
    s.d.run(0.3);
    const redirects = s.w.exchange.log.filter((t) => t.label === 'Redirect');
    expect(redirects.length).toBeGreaterThan(0);
    expect(redirects.every((t) => !t.ok)).toBe(true);
    expect(s.p.hp).toBeLessThan(s.p.maxHp);
  });

  it('Law OFF lifts the guard/exchange requirements but keeps authored conditions', () => {
    // Lazy mirror works when the law is off...
    const free = stage([reflectAlways()], false);
    fireSlug(free.w, free.shooter.id, 780, 570);
    free.d.run(1);
    expect(free.p.alive).toBe(true);
    expect(free.shooter.alive).toBe(false);

    // ...but the parry's own timing condition still decides.
    const timed = stage([deathParry({ window: 0.5 })], false);
    slugWithGuard(timed, 50);
    expect(timed.p.alive).toBe(false);
  });

  it('absorbing a hit stores its energy (bounded by capacity) and reduces its damage', () => {
    const b = new GraphBuilder('Sponge');
    const press = b.node('on.keyPressed', { key: 'F' });
    const block = b.node('act.block');
    b.flow(press, 'then', block);
    const ev = b.node('on.successfulBlock');
    const absorb = b.node('act.absorb');
    b.flow(ev, 'then', absorb);
    const s = stage([b.build()]);
    s.p.account.energy = 0;
    const shot = s.w.spawnProjectile({ x: 780, y: 570 }, { x: -760, y: 0 }, { mass: 0.4, ownerId: s.shooter.id, team: 'enemy' })!;
    const ke = shot.energy;
    s.d.run(0.2, ['F']);
    s.d.run(0.6, ['F']);
    expect(s.p.account.energy).toBeCloseTo(ke * 0.6, 1);
    expect(s.p.hp).toBe(s.p.maxHp);
  });
});
