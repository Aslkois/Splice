import { GraphBuilder } from '../mechanics/builder';
import type { MechanicGraph } from '../mechanics/schema';

/**
 * Movement mechanics built from general primitives. They are examples in the docs and reference
 * solutions in the campaign validation — the same graphs a player could wire.
 */

/** Air jump: Space while the normal jump is unavailable, once per air time, reset on landing. */
export function doubleJumpGraph(opts: { speed?: number; mode?: 'targetVelocity' | 'impulse'; airJumps?: number } = {}): MechanicGraph {
  const speed = opts.speed ?? 600;
  const b = new GraphBuilder('Double Jump');
  const ev = b.node('on.keyPressed', { key: 'Space' }, { x: 0, y: 0 });
  const grounded = b.node('state.grounded', {}, { x: 0, y: 140 });
  const not = b.node('logic.not', {}, { x: 180, y: 140 });
  const ifAir = b.node('flow.if', {}, { x: 260, y: 0 });
  const used = b.node('var.getNumber', { name: 'Air Jumps Used', scope: 'character' }, { x: 300, y: 160 });
  const cmp = b.node('logic.compare', { op: '<', b: opts.airJumps ?? 1 }, { x: 480, y: 160 });
  const ifLeft = b.node('flow.if', {}, { x: 520, y: 0 });
  const jump =
    opts.mode === 'impulse'
      ? b.node('act.impulse', { impulse: { x: 0, y: -speed } }, { x: 780, y: 0 })
      : b.node('act.setVelocity', { axes: 'y', velocity: { x: 0, y: -speed } }, { x: 780, y: 0 });
  const count = b.node('var.addNumber', { name: 'Air Jumps Used', scope: 'character', value: 1 }, { x: 1040, y: 0 });
  b.flow(ev, 'then', ifAir).wire(grounded, 'out', not, 'a').wire(not, 'out', ifAir, 'cond');
  b.flow(ifAir, 'then', ifLeft).wire(used, 'out', cmp, 'a').wire(cmp, 'out', ifLeft, 'cond');
  b.flow(ifLeft, 'then', jump).flow(jump, 'then', count);
  const land = b.node('on.landing', {}, { x: 0, y: 320 });
  const reset = b.node('var.setNumber', { name: 'Air Jumps Used', scope: 'character', value: 0 }, { x: 260, y: 320 });
  b.flow(land, 'then', reset);
  return b.build();
}

/** Air dash: Q in the air sets your horizontal speed along your facing. Once per air time. */
export function airDashGraph(speed = 850): MechanicGraph {
  const b = new GraphBuilder('Air Dash');
  const ev = b.node('on.keyPressed', { key: 'Q' }, { x: 0, y: 0 });
  const grounded = b.node('state.grounded', {}, { x: 0, y: 140 });
  const not = b.node('logic.not', {}, { x: 180, y: 140 });
  const ifAir = b.node('flow.if', {}, { x: 260, y: 0 });
  const spent = b.node('var.getFlag', { name: 'Dashed', scope: 'character' }, { x: 300, y: 160 });
  const notSpent = b.node('logic.not', {}, { x: 480, y: 160 });
  const ifReady = b.node('flow.if', {}, { x: 520, y: 0 });
  const facing = b.node('vec.facing', {}, { x: 560, y: 300 });
  const scale = b.node('vec.scale', { s: speed }, { x: 740, y: 300 });
  const set = b.node('act.setVelocity', { axes: 'x' }, { x: 780, y: 0 });
  const mark = b.node('var.setFlag', { name: 'Dashed', scope: 'character', value: true }, { x: 1040, y: 0 });
  b.flow(ev, 'then', ifAir).wire(grounded, 'out', not, 'a').wire(not, 'out', ifAir, 'cond');
  b.flow(ifAir, 'then', ifReady).wire(spent, 'out', notSpent, 'a').wire(notSpent, 'out', ifReady, 'cond');
  b.flow(ifReady, 'then', set).flow(set, 'then', mark);
  b.wire(facing, 'out', scale, 'v').wire(scale, 'out', set, 'velocity');
  const land = b.node('on.landing', {}, { x: 0, y: 420 });
  const reset = b.node('var.setFlag', { name: 'Dashed', scope: 'character', value: false }, { x: 260, y: 420 });
  b.flow(land, 'then', reset);
  return b.build();
}

