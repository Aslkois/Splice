import type { PlayerState } from '../mechanics/costInspector';
import { Cell, Dynamo } from '../sim/entities/props';
import { runner } from './bridge';

/** Your state right now, as the Workshop's cost inspector needs it. Null when no world is running. */
export function livePlayerState(): PlayerState | null {
  const w = runner.world;
  const p = w?.player;
  if (!w || !p) return null;
  let dynamoInRange = 0;
  let cellsLeft = 0;
  let cellEnergy = w.exchange.table.pickups.cellEnergy;
  for (const e of w.entities) {
    if (!e.alive) continue;
    if (e instanceof Dynamo && Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y) <= e.radius) dynamoInRange += e.reserve;
    if (e instanceof Cell) {
      cellsLeft++;
      cellEnergy = e.amount;
    }
  }
  return {
    energy: p.account.energy,
    capacity: p.account.capacity,
    stamina: p.account.stamina,
    velocity: p.alive ? p.vel : { x: 0, y: 0 },
    mass: p.mass,
    facing: p.facing > 0 ? 1 : -1,
    charges: [...p.account.charges.entries()].map(([name, c]) => ({ name, amount: c.amount, channeling: c.channeling, windup: w.exchange.chargeWindup(c) })),
    supply: { dynamoInRange, cellsLeft, cellEnergy },
  };
}
