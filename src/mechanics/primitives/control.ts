import { LIMITS } from '../runtime';
import type { PrimitiveDef } from '../types';
import { boolPort, nameParam, num, THEN } from './common';

export const CONTROL: PrimitiveDef[] = [
  {
    type: 'flow.if',
    label: 'If',
    category: 'control',
    tier: 0,
    description: 'Takes one path or the other depending on a condition.',
    execIn: true,
    execOut: [
      { id: 'then', label: 'True' },
      { id: 'else', label: 'False' },
    ],
    inputs: [boolPort('cond', 'Condition', false)],
    exec: (ctx, node) => (ctx.bool(node, 'cond') ? 'then' : 'else'),
  },
  {
    type: 'flow.sequence',
    label: 'Sequence',
    category: 'control',
    tier: 0,
    description: 'Runs each output in order, top to bottom.',
    execIn: true,
    execOut: [
      { id: 'a', label: 'First' },
      { id: 'b', label: 'Second' },
      { id: 'c', label: 'Third' },
    ],
    exec: (ctx, node) => {
      ctx.runBranch(node, 'a');
      ctx.runBranch(node, 'b');
      ctx.runBranch(node, 'c');
      return null;
    },
  },
  {
    type: 'flow.delay',
    label: 'Delay',
    category: 'control',
    tier: 0,
    description: 'Waits, then continues. The world keeps running while you wait.',
    execIn: true,
    execOut: THEN,
    inputs: [num('seconds', 'Seconds', 0.2, { min: 0, step: 0.05 })],
    exec: (ctx, node) => {
      ctx.schedule(node, 'then', ctx.num(node, 'seconds'));
      return null;
    },
  },
  {
    type: 'flow.cooldown',
    label: 'Cooldown Gate',
    category: 'control',
    tier: 0,
    description: 'Lets execution through at most once per interval.',
    execIn: true,
    execOut: [
      { id: 'pass', label: 'Pass' },
      { id: 'blocked', label: 'Cooling' },
    ],
    inputs: [num('seconds', 'Seconds', 0.5, { min: 0, step: 0.05 })],
    outputs: [{ id: 'remaining', label: 'Remaining (s)', type: 'number' }],
    exec: (ctx, node) => {
      const st = ctx.nodeState(node, () => ({ last: -Infinity }));
      const cd = Math.max(0, ctx.num(node, 'seconds'));
      const now = ctx.world.time;
      const remaining = Math.max(0, st.last + cd - now);
      if (remaining <= 1e-9) {
        st.last = now;
        ctx.setOutput(node, 'remaining', 0);
        return 'pass';
      }
      ctx.setOutput(node, 'remaining', remaining);
      return 'blocked';
    },
  },
  {
    type: 'flow.toggle',
    label: 'Toggle',
    category: 'control',
    tier: 0,
    description: 'Alternates between its two outputs each time it runs.',
    execIn: true,
    execOut: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    outputs: [{ id: 'isB', label: 'On B', type: 'boolean' }],
    exec: (ctx, node) => {
      const st = ctx.nodeState(node, () => ({ b: false }));
      const out = st.b ? 'b' : 'a';
      st.b = !st.b;
      ctx.setOutput(node, 'isB', out === 'b');
      return out;
    },
  },
  {
    type: 'flow.repeat',
    label: 'Repeat',
    category: 'control',
    tier: 2,
    description: `Runs the loop body N times (at most ${LIMITS.maxRepeat}), then continues.`,
    execIn: true,
    execOut: [
      { id: 'body', label: 'Loop' },
      { id: 'done', label: 'Done' },
    ],
    inputs: [num('count', 'Times', 3, { min: 0, max: LIMITS.maxRepeat, step: 1 })],
    outputs: [{ id: 'index', label: 'Index', type: 'number' }],
    exec: (ctx, node) => {
      const n = Math.max(0, Math.min(LIMITS.maxRepeat, Math.floor(ctx.num(node, 'count'))));
      for (let i = 0; i < n; i++) {
        ctx.setOutput(node, 'index', i);
        ctx.runBranch(node, 'body');
      }
      return 'done';
    },
  },
  {
    type: 'flow.emit',
    label: 'Emit Signal',
    category: 'control',
    tier: 2,
    description: 'Raises a named signal that any "On Signal" handler can react to (next in the queue, not instantly).',
    params: [nameParam('Signal', 'Ping')],
    execIn: true,
    execOut: THEN,
    inputs: [num('value', 'Value', 0)],
    exec: (ctx, node) => {
      ctx.emit(String(ctx.param(node, 'name')), ctx.num(node, 'value'));
      return 'then';
    },
    title: (p) => `Emit "${p.name ?? 'Ping'}"`,
  },
];
