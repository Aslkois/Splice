import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import type { MechanicGraph } from '../src/mechanics/schema';
import { ScriptedInput } from '../src/sim/input';
import { LAB_BY_ID } from '../src/sim/levels/labs';
import { World } from '../src/sim/World';

function labWorld(id: string, graphs: MechanicGraph[]) {
  const lab = LAB_BY_ID[id];
  const world = new World({ level: lab.level, mode: 'lab' });
  const att = attachMechanics(world, graphs, { allowedTypes: lab.parts, maxBlocks: lab.maxBlocks });
  return { world, att, input: new ScriptedInput(), lab };
}

describe('Challenge Lab', () => {
  it('rules: parts outside the list and over-budget builds are refused', () => {
    const b = new GraphBuilder('Too Much');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const iff = b.node('flow.if');
    const imp = b.node('act.impulse');
    b.flow(ev, 'then', iff).flow(iff, 'then', imp);
    const { att } = labWorld('lab1', [b.build()]);
    expect(att.compiled).toHaveLength(0);
    const msgs = att.rejected[0].issues.map((i) => i.message).join(' ');
    expect(msgs).toContain("'If' is not allowed in this lab");
    expect(msgs).toContain('allows 2');
  });

  it('the law cannot be lifted in a lab', () => {
    const { world } = labWorld('lab1', []);
    expect(world.setLaw(false)).toBe(false);
    expect(world.lawEnabled).toBe(true);
  });

  it('Two Blocks: a single launch impulse crosses the gap', () => {
    const b = new GraphBuilder('Launch');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const imp = b.node('act.impulse', { impulse: { x: 560, y: -420 } });
    b.flow(ev, 'then', imp);
    const { world, input } = labWorld('lab1', [b.build()]);
    const p = world.player!;
    let i = 0;
    while (p.pos.x < 640 && i++ < 600) world.step(input.frame(['D']));
    world.step(input.frame(['D', 'Space']));
    world.step(input.frame(['D', 'Space', 'Q']));
    for (let k = 0; k < 300 && !world.objective.done && p.alive; k++) world.step(input.frame(['D', 'Space']));
    expect(world.objective.done).toBe(true);
    expect(world.requests.some((r) => r.type === 'complete')).toBe(true);
  });

  it('Two Blocks: the built-in moveset falls short', () => {
    const { world, input } = labWorld('lab1', []);
    const p = world.player!;
    let i = 0;
    while (p.pos.x < 680 && i++ < 600) world.step(input.frame(['D']));
    world.step(input.frame(['D', 'Space']));
    for (let k = 0; k < 16; k++) world.step(input.frame(['D', 'Space']));
    world.step(input.frame(['D', 'Space', 'Shift']));
    for (let k = 0; k < 200 && p.alive; k++) world.step(input.frame(['D', 'Space']));
    expect(world.objective.done).toBe(false);
  });

  it('Long Distance: two fast, light shots shatter the crystal on 60 E', () => {
    const b = new GraphBuilder('Rail');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const near = b.node('entity.nearest', { filter: 'target', radius: 2000 });
    const dir = b.node('entity.directionTo');
    const shot = b.node('act.projectile', { speed: 2000, mass: 0.111 });
    b.flow(ev, 'then', shot).wire(near, 'out', dir, 'target').wire(dir, 'out', shot, 'dir');
    const { world, input } = labWorld('lab2', [b.build()]);
    for (let k = 0; k < 30; k++) world.step(input.frame([]));
    world.step(input.frame(['Q']));
    for (let k = 0; k < 20; k++) world.step(input.frame([]));
    world.step(input.frame(['Q']));
    for (let k = 0; k < 90; k++) world.step(input.frame([]));
    expect(world.objective.done).toBe(true);
    expect(world.exchange.totalSpent).toBeLessThanOrEqual(60);
  });

  it('Long Distance: slow shots run out of energy first', () => {
    const b = new GraphBuilder('Pea Shooter');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const near = b.node('entity.nearest', { filter: 'target', radius: 2000 });
    const dir = b.node('entity.directionTo');
    const shot = b.node('act.projectile', { speed: 700, mass: 0.6 });
    b.flow(ev, 'then', shot).wire(near, 'out', dir, 'target').wire(dir, 'out', shot, 'dir');
    const { world, input } = labWorld('lab2', [b.build()]);
    for (let k = 0; k < 6; k++) {
      world.step(input.frame(['Q']));
      for (let j = 0; j < 40; j++) world.step(input.frame([]));
    }
    expect(world.objective.done).toBe(false);
  });

  it('Lightning Rod: guarding and absorbing the volley fills the battery', () => {
    const b = new GraphBuilder('Rod');
    const ev = b.node('on.keyPressed', { key: 'F' });
    const block = b.node('act.block');
    b.flow(ev, 'then', block);
    const hit = b.node('on.successfulBlock');
    const absorb = b.node('act.absorb');
    b.flow(hit, 'then', absorb);
    const { world, input } = labWorld('lab3', [b.build()]);
    const p = world.player!;
    for (let k = 0; k < 60 * 30 && !world.objective.done && p.alive; k++) world.step(input.frame(['F']));
    expect(p.alive).toBe(true);
    expect(world.objective.done).toBe(true);
    expect(p.account.energy).toBeGreaterThanOrEqual(60);
  });
});
