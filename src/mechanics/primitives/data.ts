import type { Player } from '../../sim/entities/Player';
import { anyHeld, BINDINGS } from '../../sim/input';
import { len, norm, rotate } from '../../sim/math';
import { matchesFilter } from '../../sim/World';
import type { VecValue } from '../schema';
import type { PrimitiveDef } from '../types';
import { boolPort, keyParam, nameParam, num, targetPort, vecPort } from './common';

const CMP_OPS = [
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
];

const MATH_OPS = [
  { value: '+', label: '+' },
  { value: '-', label: '−' },
  { value: '*', label: '×' },
  { value: '/', label: '÷' },
  { value: 'min', label: 'min' },
  { value: 'max', label: 'max' },
  { value: 'pow', label: 'a^b' },
  { value: 'mod', label: 'mod' },
];

const STATES = [
  { value: 'blocking', label: 'is blocking' },
  { value: 'dashing', label: 'is dashing' },
  { value: 'channeling', label: 'is channelling' },
  { value: 'grounded', label: 'is grounded' },
  { value: 'moving', label: 'is moving' },
  { value: 'facingRight', label: 'faces right' },
  { value: 'stunned', label: 'is stunned' },
  { value: 'alive', label: 'is alive' },
];

const NEAREST = [
  { value: 'enemy', label: 'enemy' },
  { value: 'hostileProjectile', label: 'hostile projectile' },
  { value: 'projectile', label: 'any projectile' },
  { value: 'crate', label: 'crate' },
  { value: 'target', label: 'target' },
  { value: 'cell', label: 'energy cell' },
  { value: 'any', label: 'anything' },
];

const RESOURCES = [
  { value: 'energy', label: 'Energy' },
  { value: 'capacity', label: 'Energy Capacity' },
  { value: 'stamina', label: 'Stamina' },
  { value: 'health', label: 'Health' },
];

function compare(op: string, a: number, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '==':
      return Math.abs(a - b) < 1e-9 || a === b;
    case '!=':
      return !(Math.abs(a - b) < 1e-9 || a === b);
  }
  return false;
}

function math(op: string, a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? 0 : a / b;
    case 'min':
      return Math.min(a, b);
    case 'max':
      return Math.max(a, b);
    case 'pow':
      return Math.pow(a, b);
    case 'mod':
      return b === 0 ? 0 : ((a % b) + b) % b;
  }
  return 0;
}

const NUM_OUT = [{ id: 'out', label: 'Result', type: 'number' as const }];
const BOOL_OUT = [{ id: 'out', label: 'Result', type: 'boolean' as const }];
const VEC_OUT = [{ id: 'out', label: 'Vector', type: 'vector' as const }];

export const CONDITIONS: PrimitiveDef[] = [
  {
    type: 'logic.compare',
    label: 'Compare',
    category: 'condition',
    tier: 0,
    description: 'Compares two numbers.',
    params: [{ id: 'op', label: 'Op', kind: 'enum', options: CMP_OPS, default: '<' }],
    inputs: [num('a', 'A', 0), num('b', 'B', 0)],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => compare(String(ctx.param(node, 'op')), ctx.num(node, 'a'), ctx.num(node, 'b')),
    title: (p) => `Compare (A ${CMP_OPS.find((o) => o.value === p.op)?.label ?? '<'} B)`,
  },
  {
    type: 'logic.and',
    label: 'AND',
    category: 'condition',
    tier: 0,
    description: 'True when both inputs are true.',
    inputs: [boolPort('a', 'A'), boolPort('b', 'B')],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => ctx.bool(node, 'a') && ctx.bool(node, 'b'),
  },
  {
    type: 'logic.or',
    label: 'OR',
    category: 'condition',
    tier: 0,
    description: 'True when either input is true.',
    inputs: [boolPort('a', 'A'), boolPort('b', 'B')],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => ctx.bool(node, 'a') || ctx.bool(node, 'b'),
  },
  {
    type: 'logic.not',
    label: 'NOT',
    category: 'condition',
    tier: 0,
    description: 'Flips true and false.',
    inputs: [boolPort('a', 'In')],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => !ctx.bool(node, 'a'),
  },
  {
    type: 'state.grounded',
    label: 'Is Grounded',
    category: 'condition',
    tier: 0,
    description: 'True while your feet are on something.',
    outputs: BOOL_OUT,
    evaluate: (ctx) => ctx.actor.grounded,
  },
  {
    type: 'state.keyHeld',
    label: 'Is Key Held',
    category: 'condition',
    tier: 0,
    description: 'True while the key is down.',
    params: [keyParam('F')],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => ctx.actor.input.held.has(String(ctx.param(node, 'key'))),
    title: (p) => `Is ${p.key ?? 'F'} Held`,
  },
  {
    type: 'state.check',
    label: 'Check State',
    category: 'condition',
    tier: 0,
    description: "Reads an entity's state.",
    params: [{ id: 'state', label: 'State', kind: 'enum', options: STATES, default: 'blocking' }],
    inputs: [targetPort('Entity')],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => {
      const e = ctx.entity(node, 'target');
      const st = String(ctx.param(node, 'state'));
      if (!e) return false;
      const p = e.kind === 'player' ? (e as Player) : null;
      switch (st) {
        case 'blocking':
          return !!p?.guard.active;
        case 'dashing':
          return !!p?.isDashing;
        case 'channeling':
          return !!p?.isChanneling;
        case 'grounded':
          return p ? p.grounded : ctx.world.isGrounded(e);
        case 'moving':
          return len(e.vel) > 20;
        case 'facingRight':
          return e.facing > 0;
        case 'stunned':
          return e.stun > 0;
        case 'alive':
          return e.alive;
      }
      return false;
    },
    title: (p) => `Check: ${STATES.find((s) => s.value === p.state)?.label ?? 'is blocking'}`,
  },
  {
    type: 'res.canAfford',
    label: 'Can Afford',
    category: 'condition',
    tier: 0,
    description: 'True if you currently hold at least this much of a resource.',
    params: [
      {
        id: 'resource',
        label: 'Resource',
        kind: 'enum',
        options: [
          { value: 'energy', label: 'Energy' },
          { value: 'stamina', label: 'Stamina' },
        ],
        default: 'energy',
      },
    ],
    inputs: [num('amount', 'Amount', 10, { min: 0 })],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => {
      if (!ctx.world.lawEnabled) return true;
      const a = ctx.actor.account;
      const amt = ctx.num(node, 'amount');
      return String(ctx.param(node, 'resource')) === 'stamina' ? a.stamina >= amt : a.energy + ctx.funding.energy >= amt;
    },
  },
  {
    type: 'entity.exists',
    label: 'Exists',
    category: 'condition',
    tier: 1,
    description: 'True if the entity reference points at something alive.',
    inputs: [{ id: 'target', label: 'Entity', type: 'entity', default: 'none' }],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => !!ctx.entity(node, 'target'),
  },
  {
    type: 'entity.within',
    label: 'Within Distance',
    category: 'condition',
    tier: 1,
    description: 'True if the entity is within a distance of you.',
    inputs: [{ id: 'target', label: 'Entity', type: 'entity', default: 'none' }, num('distance', 'Distance', 120, { min: 0 })],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => {
      const e = ctx.entity(node, 'target');
      if (!e) return false;
      const a = ctx.actor.pos;
      return Math.hypot(e.pos.x - a.x, e.pos.y - a.y) <= ctx.num(node, 'distance');
    },
  },
  {
    type: 'vec.isFacing',
    label: 'Is Facing',
    category: 'condition',
    tier: 1,
    description: 'True if a direction points the way you face (within the given angle).',
    inputs: [vecPort('dir', 'Direction', 1, 0), num('angle', 'Half-angle°', 60, { min: 0, max: 180 })],
    outputs: BOOL_OUT,
    evaluate: (ctx, node) => {
      const d = norm(ctx.vec(node, 'dir'));
      const ang = (Math.acos(Math.max(-1, Math.min(1, d.x * ctx.actor.facing))) * 180) / Math.PI;
      return ang <= ctx.num(node, 'angle');
    },
  },
];

export const DATA: PrimitiveDef[] = [
  {
    type: 'num.const',
    label: 'Number',
    category: 'data',
    tier: 0,
    description: 'A constant number.',
    inputs: [num('value', 'Value', 1)],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => ctx.num(node, 'value'),
  },
  {
    type: 'num.math',
    label: 'Math',
    category: 'data',
    tier: 0,
    description: 'Arithmetic on two numbers. Division by zero gives 0.',
    params: [{ id: 'op', label: 'Op', kind: 'enum', options: MATH_OPS, default: '+' }],
    inputs: [num('a', 'A', 0), num('b', 'B', 0)],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => math(String(ctx.param(node, 'op')), ctx.num(node, 'a'), ctx.num(node, 'b')),
    title: (p) => `Math (A ${MATH_OPS.find((o) => o.value === p.op)?.label ?? '+'} B)`,
  },
  {
    type: 'num.clamp',
    label: 'Clamp',
    category: 'data',
    tier: 1,
    description: 'Keeps a number between a minimum and maximum.',
    inputs: [num('value', 'Value', 0), num('min', 'Min', 0), num('max', 'Max', 1)],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => {
      const lo = ctx.num(node, 'min');
      const hi = ctx.num(node, 'max');
      return Math.min(Math.max(ctx.num(node, 'value'), lo), hi);
    },
  },
  {
    type: 'num.random',
    label: 'Random',
    category: 'data',
    tier: 2,
    description: 'A deterministic random number between min and max.',
    inputs: [num('min', 'Min', 0), num('max', 'Max', 1)],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => ctx.world.rng.range(ctx.num(node, 'min'), ctx.num(node, 'max')),
  },
  {
    type: 'time.now',
    label: 'World Time',
    category: 'data',
    tier: 1,
    description: 'Seconds since this world started.',
    outputs: [{ id: 'out', label: 'Seconds', type: 'number' }],
    evaluate: (ctx) => ctx.world.time,
  },
  {
    type: 'vec.make',
    label: 'Make Vector',
    category: 'data',
    tier: 0,
    description: 'Builds a vector from X and Y. Up is negative Y.',
    inputs: [num('x', 'X', 0), num('y', 'Y', 0)],
    outputs: VEC_OUT,
    evaluate: (ctx, node) => ({ x: ctx.num(node, 'x'), y: ctx.num(node, 'y') }),
  },
  {
    type: 'vec.break',
    label: 'Break Vector',
    category: 'data',
    tier: 1,
    description: 'Splits a vector into X and Y.',
    inputs: [vecPort('v', 'Vector', 0, 0)],
    outputs: [
      { id: 'x', label: 'X', type: 'number' },
      { id: 'y', label: 'Y', type: 'number' },
    ],
    evaluate: (ctx, node, port) => ctx.vec(node, 'v')[port === 'y' ? 'y' : 'x'],
  },
  {
    type: 'vec.add',
    label: 'Add Vectors',
    category: 'data',
    tier: 1,
    description: 'A + B.',
    inputs: [vecPort('a', 'A', 0, 0), vecPort('b', 'B', 0, 0)],
    outputs: VEC_OUT,
    evaluate: (ctx, node) => {
      const a = ctx.vec(node, 'a');
      const b = ctx.vec(node, 'b');
      return { x: a.x + b.x, y: a.y + b.y };
    },
  },
  {
    type: 'vec.scale',
    label: 'Scale Vector',
    category: 'data',
    tier: 0,
    description: 'Multiplies a vector by a number.',
    inputs: [vecPort('v', 'Vector', 1, 0), num('s', 'By', 1)],
    outputs: VEC_OUT,
    evaluate: (ctx, node) => {
      const v = ctx.vec(node, 'v');
      const s = ctx.num(node, 's');
      return { x: v.x * s, y: v.y * s };
    },
  },
  {
    type: 'vec.normalize',
    label: 'Normalize',
    category: 'data',
    tier: 1,
    description: 'Same direction, length 1.',
    inputs: [vecPort('v', 'Vector', 1, 0)],
    outputs: VEC_OUT,
    evaluate: (ctx, node) => norm(ctx.vec(node, 'v'), { x: 0, y: 0 }),
  },
  {
    type: 'vec.length',
    label: 'Vector Length',
    category: 'data',
    tier: 1,
    description: 'How long a vector is.',
    inputs: [vecPort('v', 'Vector', 0, 0)],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => len(ctx.vec(node, 'v')),
  },
  {
    type: 'vec.rotate',
    label: 'Rotate Vector',
    category: 'data',
    tier: 2,
    description: 'Rotates a vector by degrees (clockwise on screen).',
    inputs: [vecPort('v', 'Vector', 1, 0), num('deg', 'Degrees', 90)],
    outputs: VEC_OUT,
    evaluate: (ctx, node) => rotate(ctx.vec(node, 'v'), (ctx.num(node, 'deg') * Math.PI) / 180),
  },
  {
    type: 'vec.facing',
    label: 'Facing Direction',
    category: 'data',
    tier: 0,
    description: '(1, 0) when facing right, (−1, 0) when facing left.',
    outputs: VEC_OUT,
    evaluate: (ctx) => ({ x: ctx.actor.facing, y: 0 }),
  },
  {
    type: 'vec.moveInput',
    label: 'Move Input',
    category: 'data',
    tier: 0,
    description: 'Direction you are holding (A/D/W/S or arrows).',
    outputs: VEC_OUT,
    evaluate: (ctx) => {
      const i = ctx.actor.input;
      const x = (anyHeld(i, BINDINGS.right) ? 1 : 0) - (anyHeld(i, BINDINGS.left) ? 1 : 0);
      const y = (anyHeld(i, BINDINGS.down) ? 1 : 0) - (anyHeld(i, ['W', 'Up']) ? 1 : 0);
      return norm({ x, y }, { x: 0, y: 0 });
    },
  },
  {
    type: 'vec.aim',
    label: 'Aim Direction',
    category: 'data',
    tier: 1,
    description: 'From you toward the mouse cursor.',
    outputs: VEC_OUT,
    evaluate: (ctx) => {
      const aim = ctx.actor.input.aim;
      if (!aim) return { x: ctx.actor.facing, y: 0 };
      const p = ctx.actor.pos;
      return norm({ x: aim.x - p.x, y: aim.y - p.y }, { x: ctx.actor.facing, y: 0 });
    },
  },
  {
    type: 'entity.self',
    label: 'Self',
    category: 'data',
    tier: 0,
    description: 'You.',
    outputs: [{ id: 'out', label: 'Entity', type: 'entity' }],
    evaluate: (ctx) => ctx.actor.id,
  },
  {
    type: 'entity.nearest',
    label: 'Nearest',
    category: 'data',
    tier: 1,
    description: 'The closest matching entity within a radius (or nobody).',
    params: [{ id: 'filter', label: 'Kind', kind: 'enum', options: NEAREST, default: 'enemy' }],
    inputs: [num('radius', 'Radius', 400, { min: 0 })],
    outputs: [{ id: 'out', label: 'Entity', type: 'entity' }],
    evaluate: (ctx, node) => {
      const f = String(ctx.param(node, 'filter'));
      const e = ctx.world.nearest(f, ctx.actor.pos, Math.min(ctx.num(node, 'radius'), 5000), ctx.actor.id);
      return e && matchesFilter(e, f) ? e.id : 0;
    },
    title: (p) => `Nearest ${NEAREST.find((o) => o.value === p.filter)?.label ?? 'enemy'}`,
  },
  {
    type: 'entity.position',
    label: 'Position Of',
    category: 'data',
    tier: 1,
    description: 'Where an entity is.',
    inputs: [targetPort('Entity')],
    outputs: VEC_OUT,
    evaluate: (ctx, node) => ctx.entity(node, 'target')?.pos ?? { x: 0, y: 0 },
  },
  {
    type: 'entity.velocity',
    label: 'Velocity Of',
    category: 'data',
    tier: 1,
    description: 'How fast and which way an entity moves (px/s).',
    inputs: [targetPort('Entity')],
    outputs: VEC_OUT,
    evaluate: (ctx, node) => ctx.entity(node, 'target')?.vel ?? { x: 0, y: 0 },
  },
  {
    type: 'entity.directionTo',
    label: 'Direction To',
    category: 'data',
    tier: 1,
    description: 'Unit vector from you toward an entity.',
    inputs: [{ id: 'target', label: 'Entity', type: 'entity', default: 'none' }],
    outputs: VEC_OUT,
    evaluate: (ctx, node): VecValue => {
      const e = ctx.entity(node, 'target');
      if (!e) return { x: 0, y: 0 };
      const p = ctx.actor.pos;
      return norm({ x: e.pos.x - p.x, y: e.pos.y - p.y }, { x: ctx.actor.facing, y: 0 });
    },
  },
  {
    type: 'entity.distanceTo',
    label: 'Distance To',
    category: 'data',
    tier: 1,
    description: 'Distance from you to an entity (∞ if nobody).',
    inputs: [{ id: 'target', label: 'Entity', type: 'entity', default: 'none' }],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => {
      const e = ctx.entity(node, 'target');
      if (!e) return Infinity;
      const p = ctx.actor.pos;
      return Math.hypot(e.pos.x - p.x, e.pos.y - p.y);
    },
  },
  {
    type: 'entity.health',
    label: 'Health Of',
    category: 'data',
    tier: 1,
    description: "An entity's remaining health.",
    inputs: [targetPort('Entity')],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => ctx.entity(node, 'target')?.hp ?? 0,
  },
  {
    type: 'res.read',
    label: 'Resource',
    category: 'data',
    tier: 0,
    description: 'How much of a resource you have right now.',
    params: [{ id: 'resource', label: 'Resource', kind: 'enum', options: RESOURCES, default: 'energy' }],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => {
      const a = ctx.actor.account;
      switch (String(ctx.param(node, 'resource'))) {
        case 'energy':
          return a.energy;
        case 'capacity':
          return a.capacity;
        case 'stamina':
          return a.stamina;
        case 'health':
          return ctx.actor.hp;
      }
      return 0;
    },
    title: (p) => RESOURCES.find((r) => r.value === p.resource)?.label ?? 'Resource',
  },
  {
    type: 'res.charge',
    label: 'Charge Amount',
    category: 'data',
    tier: 2,
    description: 'Energy currently stored in a named charge.',
    params: [nameParam('Charge', 'Shot')],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => ctx.actor.account.charges.get(String(ctx.param(node, 'name')))?.amount ?? 0,
    title: (p) => `Charge "${p.name ?? 'Shot'}"`,
  },
  {
    type: 'exchange.quote',
    label: 'Exchange Quote',
    category: 'data',
    tier: 2,
    description: 'What a given amount of energy buys under the Law of Equivalent Exchange.',
    params: [
      {
        id: 'what',
        label: 'Buys',
        kind: 'enum',
        options: [
          { value: 'damage', label: 'strike damage (HP)' },
          { value: 'impulse', label: 'impulse on a body' },
          { value: 'speed', label: 'projectile speed' },
        ],
        default: 'damage',
      },
    ],
    inputs: [num('energy', 'Energy', 10, { min: 0 }), num('mass', 'Mass', 1, { min: 0.05 })],
    outputs: NUM_OUT,
    evaluate: (ctx, node) => {
      const ex = ctx.world.exchange;
      const e = ctx.num(node, 'energy');
      const m = Math.max(0.05, ctx.num(node, 'mass'));
      switch (String(ctx.param(node, 'what'))) {
        case 'damage':
          return ex.quoteDamage(e);
        case 'impulse':
          return ex.quoteImpulse(e, m);
        case 'speed':
          return ex.quoteProjectileSpeed(e, m);
      }
      return 0;
    },
  },
];
