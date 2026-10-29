import type { PrimitiveDef } from '../types';
import { boolPort, nameParam, num, scopeParam, THEN, vecPort } from './common';

const varTitle = (verb: string) => (p: Record<string, unknown>) => `${verb} "${p.name ?? 'x'}"${p.scope === 'character' ? ' ⟡' : ''}`;

export const VARIABLES: PrimitiveDef[] = [
  {
    type: 'var.getNumber',
    label: 'Get Number',
    category: 'variable',
    tier: 0,
    description: 'Reads a named number (0 if never set).',
    params: [nameParam('Name', 'count'), scopeParam()],
    outputs: [{ id: 'out', label: 'Value', type: 'number' }],
    evaluate: (ctx, node) => ctx.scope(String(ctx.param(node, 'scope'))).numbers.get(String(ctx.param(node, 'name'))) ?? 0,
    title: varTitle('Get'),
  },
  {
    type: 'var.setNumber',
    label: 'Set Number',
    category: 'variable',
    tier: 0,
    description: 'Stores a named number. Values are just values — they never create resources.',
    params: [nameParam('Name', 'count'), scopeParam()],
    execIn: true,
    execOut: THEN,
    inputs: [num('value', 'Value', 0)],
    exec: (ctx, node) => {
      const v = ctx.num(node, 'value');
      const name = String(ctx.param(node, 'name'));
      ctx.scope(String(ctx.param(node, 'scope'))).numbers.set(name, v);
      ctx.detail(name, v);
      return 'then';
    },
    title: varTitle('Set'),
  },
  {
    type: 'var.addNumber',
    label: 'Add To Number',
    category: 'variable',
    tier: 0,
    description: 'Adds to a named number (use negative to subtract).',
    params: [nameParam('Name', 'count'), scopeParam()],
    execIn: true,
    execOut: THEN,
    inputs: [num('value', 'Add', 1)],
    exec: (ctx, node) => {
      const s = ctx.scope(String(ctx.param(node, 'scope')));
      const name = String(ctx.param(node, 'name'));
      const v = (s.numbers.get(name) ?? 0) + ctx.num(node, 'value');
      s.numbers.set(name, v);
      ctx.detail(name, v);
      return 'then';
    },
    title: varTitle('Add to'),
  },
  {
    type: 'var.getFlag',
    label: 'Get Flag',
    category: 'variable',
    tier: 0,
    description: 'Reads a named true/false flag (false if never set).',
    params: [nameParam('Name', 'armed'), scopeParam()],
    outputs: [{ id: 'out', label: 'Value', type: 'boolean' }],
    evaluate: (ctx, node) => ctx.scope(String(ctx.param(node, 'scope'))).flags.get(String(ctx.param(node, 'name'))) ?? false,
    title: varTitle('Get'),
  },
  {
    type: 'var.setFlag',
    label: 'Set Flag',
    category: 'variable',
    tier: 0,
    description: 'Stores a named true/false flag.',
    params: [nameParam('Name', 'armed'), scopeParam()],
    execIn: true,
    execOut: THEN,
    inputs: [boolPort('value', 'Value', true)],
    exec: (ctx, node) => {
      const name = String(ctx.param(node, 'name'));
      const v = ctx.bool(node, 'value');
      ctx.scope(String(ctx.param(node, 'scope'))).flags.set(name, v);
      ctx.detail(name, v);
      return 'then';
    },
    title: varTitle('Set'),
  },
  {
    type: 'var.getVector',
    label: 'Get Vector',
    category: 'variable',
    tier: 2,
    description: 'Reads a named vector.',
    params: [nameParam('Name', 'dir'), scopeParam()],
    outputs: [{ id: 'out', label: 'Value', type: 'vector' }],
    evaluate: (ctx, node) => ctx.scope(String(ctx.param(node, 'scope'))).vectors.get(String(ctx.param(node, 'name'))) ?? { x: 0, y: 0 },
    title: varTitle('Get'),
  },
  {
    type: 'var.setVector',
    label: 'Set Vector',
    category: 'variable',
    tier: 2,
    description: 'Stores a named vector.',
    params: [nameParam('Name', 'dir'), scopeParam()],
    execIn: true,
    execOut: THEN,
    inputs: [vecPort('value', 'Value', 0, 0)],
    exec: (ctx, node) => {
      const name = String(ctx.param(node, 'name'));
      const v = ctx.vec(node, 'value');
      ctx.scope(String(ctx.param(node, 'scope'))).vectors.set(name, v);
      ctx.detail(name, v);
      return 'then';
    },
    title: varTitle('Set'),
  },
  {
    type: 'var.getEntity',
    label: 'Recall Entity',
    category: 'variable',
    tier: 2,
    description: 'Reads a remembered entity (nobody if forgotten or gone).',
    params: [nameParam('Name', 'mark'), scopeParam()],
    outputs: [{ id: 'out', label: 'Entity', type: 'entity' }],
    evaluate: (ctx, node) => {
      const id = ctx.scope(String(ctx.param(node, 'scope'))).entities.get(String(ctx.param(node, 'name'))) ?? 0;
      return id && ctx.world.get(id)?.alive ? id : 0;
    },
    title: varTitle('Recall'),
  },
  {
    type: 'var.setEntity',
    label: 'Remember Entity',
    category: 'variable',
    tier: 2,
    description: 'Remembers an entity under a name.',
    params: [nameParam('Name', 'mark'), scopeParam()],
    execIn: true,
    execOut: THEN,
    inputs: [{ id: 'value', label: 'Entity', type: 'entity', default: 'none' }],
    exec: (ctx, node) => {
      ctx.scope(String(ctx.param(node, 'scope'))).entities.set(String(ctx.param(node, 'name')), ctx.entityId(node, 'value'));
      return 'then';
    },
    title: varTitle('Remember'),
  },
  {
    type: 'timer.reset',
    label: 'Reset Timer',
    category: 'variable',
    tier: 1,
    description: 'Restarts a stopwatch from zero. Read it with "Timer Value".',
    params: [nameParam('Timer', 'Parry'), scopeParam()],
    execIn: true,
    execOut: THEN,
    exec: (ctx, node) => {
      const s = ctx.scope(String(ctx.param(node, 'scope')));
      const name = String(ctx.param(node, 'name'));
      const prev = s.timers.get(name);
      s.timers.set(name, { start: ctx.world.time, duration: prev?.duration ?? null, fired: false, running: true });
      return 'then';
    },
    title: (p) => `Reset Timer "${p.name ?? 'Parry'}"`,
  },
  {
    type: 'timer.start',
    label: 'Start Timer',
    category: 'variable',
    tier: 1,
    description: 'Starts a timer that fires "On Timer Elapsed" after the duration.',
    params: [nameParam('Timer', 'Cooldown'), scopeParam()],
    execIn: true,
    execOut: THEN,
    inputs: [num('duration', 'Seconds', 1, { min: 0, step: 0.1 })],
    exec: (ctx, node) => {
      const s = ctx.scope(String(ctx.param(node, 'scope')));
      const d = Math.max(0, ctx.num(node, 'duration'));
      s.timers.set(String(ctx.param(node, 'name')), { start: ctx.world.time, duration: Number.isFinite(d) ? d : null, fired: false, running: true });
      return 'then';
    },
    title: (p) => `Start Timer "${p.name ?? 'Cooldown'}"`,
  },
  {
    type: 'timer.stop',
    label: 'Stop Timer',
    category: 'variable',
    tier: 1,
    description: 'Stops a timer. Its value becomes ∞ and it will not fire.',
    params: [nameParam('Timer', 'Parry'), scopeParam()],
    execIn: true,
    execOut: THEN,
    exec: (ctx, node) => {
      ctx.scope(String(ctx.param(node, 'scope'))).timers.delete(String(ctx.param(node, 'name')));
      return 'then';
    },
    title: (p) => `Stop Timer "${p.name ?? 'Parry'}"`,
  },
  {
    type: 'timer.value',
    label: 'Timer Value',
    category: 'variable',
    tier: 1,
    description: 'Seconds since the timer was last reset or started (∞ if it is not running).',
    params: [nameParam('Timer', 'Parry'), scopeParam()],
    outputs: [{ id: 'out', label: 'Seconds', type: 'number' }],
    evaluate: (ctx, node) => {
      const t = ctx.scope(String(ctx.param(node, 'scope'))).timers.get(String(ctx.param(node, 'name')));
      return t && t.running ? ctx.world.time - t.start : Infinity;
    },
    title: (p) => `Timer "${p.name ?? 'Parry'}"`,
  },
];
