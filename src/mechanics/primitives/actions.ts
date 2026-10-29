import { DT } from '../../sim/config';
import { clamp, norm } from '../../sim/math';
import type { CompiledNode, PrimitiveDef } from '../types';
import type { ExecContext } from '../runtime';
import { nameParam, num, targetPort, THEN, THEN_FAILED, vecPort } from './common';

const ok = (r: { ok: boolean }) => (r.ok ? 'then' : 'failed');

function needHit(ctx: ExecContext, node: CompiledNode) {
  const hit = ctx.hit;
  if (!hit) ctx.fail(node, 'only works while a hit is incoming');
  return hit;
}

export const ACTIONS: PrimitiveDef[] = [
  {
    type: 'act.impulse',
    label: 'Apply Impulse',
    category: 'action',
    tier: 0,
    description: 'An instant shove. Impulse is in kg·px/s — on your 1 kg body it equals the change of speed. Up is negative Y.',
    cost: 'E = (½·p + p²/2m) / 0.85, more at range',
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [targetPort(), vecPort('impulse', 'Impulse', 0, -650)],
    exec: (ctx, node) => {
      const target = ctx.entity(node, 'target');
      if (!target) {
        ctx.fail(node, 'no target');
        return 'failed';
      }
      return ok(ctx.perform(node, 'impulse', { target, impulse: ctx.vec(node, 'impulse') }));
    },
  },
  {
    type: 'act.force',
    label: 'Apply Force',
    category: 'action',
    tier: 0,
    description: 'Pushes for one tick (force × 1/60 s). Use with "While Key Held" or "Every Tick" for thrust.',
    cost: 'billed as the impulse it delivers each tick',
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [targetPort(), vecPort('force', 'Force', 0, -2600)],
    exec: (ctx, node) => {
      const target = ctx.entity(node, 'target');
      if (!target) {
        ctx.fail(node, 'no target');
        return 'failed';
      }
      const f = ctx.vec(node, 'force');
      return ok(ctx.perform(node, 'impulse', { target, impulse: { x: f.x * DT, y: f.y * DT } }));
    },
  },
  {
    type: 'act.setVelocity',
    label: 'Set Velocity',
    category: 'action',
    tier: 0,
    description: 'Sets speed directly. Billed as the impulse needed to make that change.',
    cost: 'as Apply Impulse for the velocity change',
    params: [
      {
        id: 'axes',
        label: 'Axes',
        kind: 'enum',
        options: [
          { value: 'both', label: 'X and Y' },
          { value: 'x', label: 'X only' },
          { value: 'y', label: 'Y only' },
        ],
        default: 'both',
      },
    ],
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [targetPort(), vecPort('velocity', 'Velocity', 0, 0)],
    exec: (ctx, node) => {
      const target = ctx.entity(node, 'target');
      if (!target) {
        ctx.fail(node, 'no target');
        return 'failed';
      }
      const want = ctx.vec(node, 'velocity');
      const cur = target.vel;
      const axes = String(ctx.param(node, 'axes'));
      const dv = { x: axes === 'y' ? 0 : want.x - cur.x, y: axes === 'x' ? 0 : want.y - cur.y };
      const m = target.mass;
      return ok(ctx.perform(node, 'impulse', { target, impulse: { x: dv.x * m, y: dv.y * m } }));
    },
  },
  {
    type: 'act.consume',
    label: 'Consume Resource',
    category: 'action',
    tier: 0,
    description: 'Spends a resource for nothing — a way to put a real price on your own logic.',
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
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [num('amount', 'Amount', 10, { min: 0 })],
    exec: (ctx, node) =>
      ok(ctx.perform(node, 'consume', { resource: String(ctx.param(node, 'resource')) === 'stamina' ? 'stamina' : 'energy', amount: ctx.num(node, 'amount') })),
  },
  {
    type: 'act.block',
    label: 'Activate Block',
    category: 'action',
    tier: 1,
    description: 'Raises your guard. Guarded frontal hits lose 60% damage. Costs stamina to raise and to hold.',
    cost: '6 stamina, then 3/s while up',
    execIn: true,
    execOut: THEN_FAILED,
    exec: (ctx, node) => ok(ctx.perform(node, 'guardUp', {})),
  },
  {
    type: 'act.unblock',
    label: 'Deactivate Block',
    category: 'action',
    tier: 1,
    description: 'Lowers your guard. It needs a moment to recover before it can rise again.',
    execIn: true,
    execOut: THEN,
    exec: (ctx) => {
      ctx.world.exchange.guardDown(ctx.actor);
      return 'then';
    },
  },
  {
    type: 'act.projectile',
    label: 'Spawn Projectile',
    category: 'action',
    tier: 1,
    description: 'Fires a kinetic projectile. Damage on impact comes from its kinetic energy (½mv²), never from a number you type. Recoil pushes you back.',
    cost: 'E = (½mv² + ½·p) / 0.8',
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [vecPort('dir', 'Direction (0 = facing)', 0, 0), num('speed', 'Speed px/s', 900, { min: 60, step: 50 }), num('mass', 'Mass kg', 0.3, { min: 0.05, step: 0.1 })],
    outputs: [{ id: 'projectile', label: 'Projectile', type: 'entity' }],
    exec: (ctx, node) => {
      const t = ctx.world.exchange.table.projectile;
      const raw = ctx.vec(node, 'dir');
      const dir = norm(raw, { x: ctx.actor.facing, y: 0 });
      const speed = clamp(ctx.num(node, 'speed'), t.minSpeed, ctx.world.physicsLimits.maxProjectileSpeed);
      const mass = clamp(ctx.num(node, 'mass'), t.minMass, t.maxMass);
      if (!Number.isFinite(speed) || !Number.isFinite(mass)) {
        ctx.fail(node, 'invalid numbers');
        return 'failed';
      }
      const r = ctx.perform(node, 'projectile', { dir, speed, mass });
      ctx.setOutput(node, 'projectile', typeof r.value === 'number' ? r.value : 0);
      return ok(r);
    },
  },
  {
    type: 'act.strike',
    label: 'Deal Damage',
    category: 'action',
    tier: 1,
    description: 'Strikes an entity within reach (96 px). Every point of damage is paid for in energy.',
    cost: '1 E per HP',
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [{ id: 'target', label: 'Target', type: 'entity', default: 'none' }, num('amount', 'Damage', 10, { min: 0 })],
    exec: (ctx, node) => {
      const target = ctx.entity(node, 'target');
      if (!target) {
        ctx.fail(node, 'no target');
        return 'failed';
      }
      return ok(ctx.perform(node, 'strike', { target, amount: ctx.num(node, 'amount') }));
    },
  },
  {
    type: 'act.reflect',
    label: 'Reflect Incoming',
    category: 'action',
    tier: 1,
    description:
      'Sends the incoming force back where it came from. Needs a guard that was up before impact. Reusing the force is cheap; the longer your guard was up, the more precision (stamina) it costs. Amplifying costs energy.',
    cost: 'ST = 3 + 60·age²; E = (amp² − 1)·energy / 0.75',
    needsOpenHit: true,
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [num('amplify', 'Amplify ×', 1, { min: 1, max: 4, step: 0.25 })],
    exec: (ctx, node) => {
      const hit = needHit(ctx, node);
      if (!hit) return 'failed';
      return ok(ctx.perform(node, 'redirect', { hit, dir: null, amplify: ctx.num(node, 'amplify') }));
    },
  },
  {
    type: 'act.redirect',
    label: 'Redirect Incoming',
    category: 'action',
    tier: 1,
    description: 'Like Reflect, but you choose the direction the force leaves in.',
    cost: 'as Reflect',
    needsOpenHit: true,
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [vecPort('dir', 'Direction', 0, -1), num('amplify', 'Amplify ×', 1, { min: 1, max: 4, step: 0.25 })],
    exec: (ctx, node) => {
      const hit = needHit(ctx, node);
      if (!hit) return 'failed';
      const d = ctx.vec(node, 'dir');
      return ok(ctx.perform(node, 'redirect', { hit, dir: d.x === 0 && d.y === 0 ? null : d, amplify: ctx.num(node, 'amplify') }));
    },
  },
  {
    type: 'act.prevent',
    label: 'Prevent Incoming Damage',
    category: 'action',
    tier: 2,
    description:
      'The incoming hit deals no health damage. If its force was already sent elsewhere this is nearly free; otherwise you must pay to dissipate it.',
    cost: '3 E after a redirect, else 1.5 E per HP',
    needsOpenHit: true,
    execIn: true,
    execOut: THEN_FAILED,
    exec: (ctx, node) => {
      const hit = needHit(ctx, node);
      if (!hit) return 'failed';
      return ok(ctx.perform(node, 'prevent', { hit }));
    },
  },
  {
    type: 'act.reduce',
    label: 'Reduce Incoming Damage',
    category: 'action',
    tier: 2,
    description: 'Removes up to the given amount of damage from the incoming hit.',
    cost: '1.5 E per HP removed',
    needsOpenHit: true,
    execIn: true,
    execOut: THEN_FAILED,
    inputs: [num('amount', 'Amount', 10, { min: 0 })],
    exec: (ctx, node) => {
      const hit = needHit(ctx, node);
      if (!hit) return 'failed';
      return ok(ctx.perform(node, 'reduce', { hit, amount: ctx.num(node, 'amount') }));
    },
  },
  {
    type: 'act.absorb',
    label: 'Absorb Incoming',
    category: 'action',
    tier: 2,
    description:
      "Stores the hit's kinetic energy in your battery (60% efficient) — the absorbed share deals no damage. Needs a guard that was up before impact and free battery space.",
    cost: '0.15 stamina per E absorbed',
    needsOpenHit: true,
    execIn: true,
    execOut: THEN_FAILED,
    outputs: [{ id: 'absorbed', label: 'Absorbed E', type: 'number' }],
    exec: (ctx, node) => {
      const hit = needHit(ctx, node);
      if (!hit) return 'failed';
      const r = ctx.perform(node, 'absorb', { hit });
      ctx.setOutput(node, 'absorbed', typeof r.value === 'number' ? r.value : 0);
      return ok(r);
    },
  },
  {
    type: 'act.beginCharge',
    label: 'Accumulate Charge',
    category: 'action',
    tier: 2,
    description: 'Starts channelling energy from your battery into a named charge, at most 30 E/s. You move slower while channelling, and getting hurt scatters half of it.',
    params: [nameParam('Charge', 'Shot')],
    execIn: true,
    execOut: THEN,
    exec: (ctx, node) => {
      ctx.world.exchange.beginCharge(ctx.actor, String(ctx.param(node, 'name')));
      return 'then';
    },
    title: (p) => `Accumulate "${p.name ?? 'Shot'}"`,
  },
  {
    type: 'act.holdCharge',
    label: 'Hold Charge',
    category: 'action',
    tier: 2,
    description: 'Stops channelling but keeps what is stored.',
    params: [nameParam('Charge', 'Shot')],
    execIn: true,
    execOut: THEN,
    exec: (ctx, node) => {
      ctx.world.exchange.stopCharge(ctx.actor, String(ctx.param(node, 'name')));
      return 'then';
    },
    title: (p) => `Hold Charge "${p.name ?? 'Shot'}"`,
  },
  {
    type: 'act.releaseCharge',
    label: 'Release Charge',
    category: 'action',
    tier: 2,
    description: 'Empties a charge into this execution. Actions after it are paid from the released energy first (no instant limit). Leftovers return to the battery.',
    params: [nameParam('Charge', 'Shot')],
    execIn: true,
    execOut: THEN,
    outputs: [{ id: 'energy', label: 'Energy', type: 'number' }],
    exec: (ctx, node) => {
      const e = ctx.world.exchange.releaseCharge(ctx.actor, String(ctx.param(node, 'name')));
      ctx.funding.energy += e;
      ctx.setOutput(node, 'energy', e);
      return 'then';
    },
    title: (p) => `Release Charge "${p.name ?? 'Shot'}"`,
  },
  {
    type: 'act.channelUntil',
    label: 'Channel Until',
    category: 'action',
    tier: 2,
    description: 'Channels into a charge and waits — the world keeps going — until it holds the amount, then releases it into this execution. Taking damage interrupts it.',
    params: [nameParam('Charge', 'Windup')],
    execIn: true,
    execOut: [
      { id: 'charged', label: 'Charged' },
      { id: 'interrupted', label: 'Interrupted' },
    ],
    inputs: [num('amount', 'Energy', 60, { min: 0 })],
    outputs: [{ id: 'energy', label: 'Energy', type: 'number' }],
    exec: (ctx, node) => {
      const name = String(ctx.param(node, 'name'));
      const target = Math.max(0, ctx.num(node, 'amount'));
      if (!Number.isFinite(target)) return ctx.fail(node, 'cannot channel an infinite amount');
      ctx.world.exchange.beginCharge(ctx.actor, name);
      ctx.watchCharge(node, name, target);
      return null;
    },
    title: (p) => `Channel "${p.name ?? 'Windup'}" Until`,
  },
  {
    type: 'act.setFacing',
    label: 'Set Facing',
    category: 'action',
    tier: 1,
    description: 'Turns you around.',
    params: [
      {
        id: 'mode',
        label: 'Face',
        kind: 'enum',
        options: [
          { value: 'left', label: 'left' },
          { value: 'right', label: 'right' },
          { value: 'flip', label: 'the other way' },
          { value: 'aim', label: 'toward the cursor' },
        ],
        default: 'flip',
      },
    ],
    execIn: true,
    execOut: THEN,
    exec: (ctx, node) => {
      const a = ctx.actor;
      switch (String(ctx.param(node, 'mode'))) {
        case 'left':
          a.facing = -1;
          break;
        case 'right':
          a.facing = 1;
          break;
        case 'flip':
          a.facing = a.facing > 0 ? -1 : 1;
          break;
        case 'aim':
          if (a.input.aim) a.facing = a.input.aim.x >= a.pos.x ? 1 : -1;
          break;
      }
      return 'then';
    },
  },
  {
    type: 'fx.sound',
    label: 'Play Sound',
    category: 'action',
    tier: 0,
    description: 'Purely cosmetic. Free.',
    params: [
      {
        id: 'sound',
        label: 'Sound',
        kind: 'enum',
        options: [
          { value: 'chime', label: 'chime' },
          { value: 'blip', label: 'blip' },
          { value: 'clang', label: 'clang' },
          { value: 'boom', label: 'boom' },
        ],
        default: 'chime',
      },
    ],
    execIn: true,
    execOut: THEN,
    inputs: [num('pitch', 'Pitch', 1, { min: 0.25, max: 4, step: 0.25 })],
    exec: (ctx, node) => {
      ctx.world.emit({ type: 'cosmetic', pos: ctx.actor.pos, sound: String(ctx.param(node, 'sound')), pitch: clamp(ctx.num(node, 'pitch'), 0.25, 4) });
      return 'then';
    },
  },
];
