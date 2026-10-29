import type { Hit } from '../../sim/combat/Combat';
import type { PrimitiveDef, Value } from '../types';
import { keyParam, nameParam, scopeParam, THEN } from './common';

const hitOutputs = [
  { id: 'damage', label: 'Damage', type: 'number' as const },
  { id: 'energy', label: 'Energy', type: 'number' as const },
  { id: 'attacker', label: 'Attacker', type: 'entity' as const },
  { id: 'direction', label: 'Direction', type: 'vector' as const },
  { id: 'blockable', label: 'Is Blockable', type: 'boolean' as const },
  { id: 'projectile', label: 'Is Projectile', type: 'boolean' as const },
  { id: 'lethal', label: 'Will Be Lethal', type: 'boolean' as const },
  { id: 'guardAge', label: 'Guard Age', type: 'number' as const },
];

function hitData(hit: Hit | null, port: string, projected: (h: Hit) => number, hp: number): Value {
  if (!hit) return port === 'direction' ? { x: 0, y: 0 } : port === 'blockable' || port === 'projectile' || port === 'lethal' ? false : 0;
  switch (port) {
    case 'damage':
      return projected(hit);
    case 'energy':
      return Math.max(0, hit.energy - hit.absorbedEnergy);
    case 'attacker':
      return hit.attackerId ?? 0;
    case 'direction':
      return { ...hit.direction };
    case 'blockable':
      return hit.blockable;
    case 'projectile':
      return hit.kind === 'projectile';
    case 'lethal':
      return projected(hit) >= hp;
    case 'guardAge':
      return hit.guardAge >= 0 ? hit.guardAge : Infinity;
  }
  return 0;
}

const collisionFilters = [
  { value: 'any', label: 'anything' },
  { value: 'solid', label: 'walls & floors' },
  { value: 'crate', label: 'crates' },
  { value: 'enemy', label: 'enemies' },
  { value: 'target', label: 'targets' },
];

const destroyFilters = [
  { value: 'any', label: 'anything' },
  { value: 'enemy', label: 'an enemy' },
  { value: 'crate', label: 'a crate' },
  { value: 'target', label: 'a target' },
];

export const EVENTS: PrimitiveDef[] = [
  {
    type: 'on.keyPressed',
    label: 'On Key Pressed',
    category: 'event',
    tier: 0,
    description: 'Fires once on the tick a key goes down.',
    params: [keyParam('F')],
    execOut: THEN,
    event: { kind: 'key.pressed', match: (p, pl) => String(p.key ?? 'F') === pl.key },
    title: (p) => `On ${p.key ?? 'F'} Pressed`,
  },
  {
    type: 'on.keyReleased',
    label: 'On Key Released',
    category: 'event',
    tier: 0,
    description: 'Fires once when a key comes back up. Knows how long it was held.',
    params: [keyParam('F')],
    execOut: THEN,
    outputs: [{ id: 'heldFor', label: 'Held For (s)', type: 'number' }],
    event: {
      kind: 'key.released',
      match: (p, pl) => String(p.key ?? 'F') === pl.key,
      data: (ctx) => Number(ctx.payload.heldFor ?? 0),
    },
    title: (p) => `On ${p.key ?? 'F'} Released`,
  },
  {
    type: 'on.keyHeld',
    label: 'While Key Held',
    category: 'event',
    tier: 0,
    description: 'Fires every tick (60×/s) while the key is down.',
    params: [keyParam('F')],
    execOut: THEN,
    outputs: [{ id: 'heldFor', label: 'Held For (s)', type: 'number' }],
    event: {
      kind: 'key.held',
      match: (p, pl) => String(p.key ?? 'F') === pl.key,
      data: (ctx) => Number(ctx.payload.heldFor ?? 0),
    },
    title: (p) => `While ${p.key ?? 'F'} Held`,
  },
  {
    type: 'on.tick',
    label: 'Every Tick',
    category: 'event',
    tier: 0,
    description: 'Fires every simulation tick (60 times a second). Keep it light.',
    execOut: THEN,
    outputs: [{ id: 'dt', label: 'Tick Length (s)', type: 'number' }],
    event: { kind: 'tick', data: () => 1 / 60 },
  },
  {
    type: 'on.landing',
    label: 'On Landing',
    category: 'event',
    tier: 0,
    description: 'Fires when you touch down after being airborne.',
    execOut: THEN,
    outputs: [{ id: 'fallSpeed', label: 'Fall Speed', type: 'number' }],
    event: { kind: 'landing', data: (ctx) => Number(ctx.payload.fallSpeed ?? 0) },
  },
  {
    type: 'on.collision',
    label: 'On Collision',
    category: 'event',
    tier: 1,
    description: 'Fires when your body starts touching something.',
    params: [{ id: 'filter', label: 'With', kind: 'enum', options: collisionFilters, default: 'any' }],
    execOut: THEN,
    outputs: [
      { id: 'other', label: 'Other', type: 'entity' },
      { id: 'speed', label: 'Impact Speed', type: 'number' },
    ],
    event: {
      kind: 'collision',
      match: (p, pl) => {
        const f = String(p.filter ?? 'any');
        return f === 'any' || f === pl.kind || (f === 'enemy' && pl.team === 'enemy');
      },
      data: (ctx, port) => (port === 'other' ? Number(ctx.payload.otherId ?? 0) : Number(ctx.payload.speed ?? 0)),
    },
  },
  {
    type: 'on.incomingHit',
    label: 'On Incoming Hit',
    category: 'event',
    tier: 1,
    description:
      'Fires the instant something is about to hit you — before any damage. Defensive actions here can change what happens.',
    execOut: THEN,
    outputs: hitOutputs,
    event: {
      kind: 'hit.incoming',
      sync: true,
      data: (ctx, port) => hitData(ctx.hit, port, (h) => ctx.world.combat.projectedDamage(h), ctx.actor.hp),
    },
  },
  {
    type: 'on.successfulBlock',
    label: 'On Successful Block',
    category: 'event',
    tier: 1,
    description: 'Fires when an incoming hit meets a guard that was already up. The hit is still open.',
    execOut: THEN,
    outputs: hitOutputs,
    event: {
      kind: 'block.success',
      sync: true,
      data: (ctx, port) => hitData(ctx.hit, port, (h) => ctx.world.combat.projectedDamage(h), ctx.actor.hp),
    },
  },
  {
    type: 'on.damageTaken',
    label: 'On Damage Taken',
    category: 'event',
    tier: 1,
    description: 'Fires after health damage has landed.',
    execOut: THEN,
    outputs: [
      { id: 'amount', label: 'Amount', type: 'number' },
      { id: 'attacker', label: 'Attacker', type: 'entity' },
    ],
    event: {
      kind: 'damage.taken',
      data: (ctx, port) => (port === 'amount' ? Number(ctx.payload.amount ?? 0) : Number(ctx.payload.attackerId ?? 0)),
    },
  },
  {
    type: 'on.timerElapsed',
    label: 'On Timer Elapsed',
    category: 'event',
    tier: 1,
    description: 'Fires when a timer started with a duration runs out.',
    params: [nameParam('Timer', 'Cooldown'), scopeParam()],
    execOut: THEN,
    event: {
      kind: 'timer.elapsed',
      match: (p, pl, mechId) => {
        if (String(p.name ?? '') !== pl.name) return false;
        const charScope = String(p.scope ?? 'mechanic') === 'character';
        return charScope ? pl.mechanicId === null : pl.mechanicId === mechId;
      },
    },
    title: (p) => `On "${p.name ?? 'Cooldown'}" Elapsed`,
  },
  {
    type: 'on.entityDestroyed',
    label: 'On Entity Destroyed',
    category: 'event',
    tier: 2,
    description: 'Fires when something in the world is destroyed.',
    params: [{ id: 'filter', label: 'When', kind: 'enum', options: destroyFilters, default: 'any' }],
    execOut: THEN,
    outputs: [{ id: 'entity', label: 'Entity', type: 'entity' }],
    event: {
      kind: 'entity.destroyed',
      match: (p, pl) => {
        const f = String(p.filter ?? 'any');
        if (f === 'any') return true;
        if (f === 'enemy') return pl.kind === 'turret' || pl.kind === 'walker' || pl.kind === 'cannon';
        return f === pl.kind;
      },
      data: (ctx) => Number(ctx.payload.entityId ?? 0),
    },
  },
  {
    type: 'on.signal',
    label: 'On Signal',
    category: 'event',
    tier: 2,
    description: 'Fires when any equipped mechanic emits a signal with this name.',
    params: [nameParam('Signal', 'Ping')],
    execOut: THEN,
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    event: {
      kind: 'custom',
      match: (p, pl) => String(p.name ?? '') === pl.name,
      data: (ctx) => Number(ctx.payload.value ?? 0),
    },
    title: (p) => `On Signal "${p.name ?? 'Ping'}"`,
  },
  {
    type: 'on.chargeInterrupted',
    label: 'On Charge Interrupted',
    category: 'event',
    tier: 2,
    description: 'Fires when taking damage breaks your channelling.',
    execOut: THEN,
    event: { kind: 'charge.interrupted' },
  },
];
