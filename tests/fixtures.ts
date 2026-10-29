import { GraphBuilder } from '../src/mechanics/builder';
import type { MechanicGraph } from '../src/mechanics/schema';
import { Target } from '../src/sim/entities/props';
import type { World } from '../src/sim/World';

/**
 * Mechanics assembled from primitives the same way a player would wire them in the Workshop.
 * None of these exist in the game as premade abilities.
 */

/** On F Pressed: Activate Block + Reset Timer("Parry"). On F Released: Deactivate Block. */
export function guardGraph(b: GraphBuilder): void {
  const press = b.node('on.keyPressed', { key: 'F' }, { x: 0, y: 0 });
  const block = b.node('act.block', {}, { x: 220, y: 0 });
  const reset = b.node('timer.reset', { name: 'Parry' }, { x: 440, y: 0 });
  b.flow(press, 'then', block).flow(block, 'then', reset);
  const release = b.node('on.keyReleased', { key: 'F' }, { x: 0, y: 140 });
  const unblock = b.node('act.unblock', {}, { x: 220, y: 140 });
  b.flow(release, 'then', unblock);
}

/** The spec's Death Parry, built from general primitives. */
export function deathParry(opts: { window?: number; prevent?: boolean; event?: 'on.successfulBlock' | 'on.incomingHit' } = {}): MechanicGraph {
  const b = new GraphBuilder('Death Parry');
  guardGraph(b);
  const ev = b.node(opts.event ?? 'on.successfulBlock', {}, { x: 0, y: 300 });
  const timer = b.node('timer.value', { name: 'Parry' }, { x: 100, y: 420 });
  const cmp = b.node('logic.compare', { op: '<', b: opts.window ?? 0.5 }, { x: 260, y: 420 });
  const iff = b.node('flow.if', {}, { x: 220, y: 300 });
  const blk = b.node('flow.if', {}, { x: 420, y: 300 });
  const reflect = b.node('act.reflect', { amplify: 1 }, { x: 620, y: 300 });
  b.flow(ev, 'then', iff).wire(timer, 'out', cmp, 'a').wire(cmp, 'out', iff, 'cond');
  b.flow(iff, 'then', blk).wire(ev, 'blockable', blk, 'cond');
  b.flow(blk, 'then', reflect);
  if (opts.prevent !== false) {
    const prevent = b.node('act.prevent', {}, { x: 820, y: 300 });
    b.flow(reflect, 'then', prevent);
  }
  return b.build();
}

/** Only a guard on F. */
export function blockOnly(): MechanicGraph {
  const b = new GraphBuilder('Guard');
  guardGraph(b);
  return b.build();
}

/** Reflects anything, with no guard and no timing — the "lazy" build. */
export function reflectAlways(withPrevent = true): MechanicGraph {
  const b = new GraphBuilder('Mirror');
  const ev = b.node('on.incomingHit');
  const reflect = b.node('act.reflect');
  b.flow(ev, 'then', reflect);
  if (withPrevent) {
    const prevent = b.node('act.prevent');
    b.flow(reflect, 'then', prevent);
  }
  return b.build();
}

/** A sturdy dummy that "owns" incoming shots, so reflections have somewhere to go. */
export function addShooter(w: World, x: number, y: number, hp = 350): Target {
  const t = w.add(new Target(x, y, hp))!;
  return t;
}

/** A lethal slug (≈397 E of kinetic energy) flying at the player from `fromX`. */
export function fireSlug(w: World, ownerId: number, fromX: number, y: number, speed = 1150, mass = 6) {
  return w.spawnProjectile({ x: fromX, y }, { x: -speed, y: 0 }, { mass, radius: 13, ownerId, team: 'enemy', style: 'slug' })!;
}
