import { ACTIONS } from './primitives/actions';
import { CONTROL } from './primitives/control';
import { CONDITIONS, DATA } from './primitives/data';
import { EVENTS } from './primitives/events';
import { VARIABLES } from './primitives/variables';
import type { ParamValue, PortType } from './schema';
import type { Category, PrimitiveDef } from './types';

/**
 * The primitive registry. Adding a primitive means adding a definition here — the validator,
 * compiler, runtime and Workshop all work from these definitions alone.
 */
export const PRIMITIVES: PrimitiveDef[] = [...EVENTS, ...CONTROL, ...CONDITIONS, ...DATA, ...VARIABLES, ...ACTIONS];

const BY_TYPE = new Map<string, PrimitiveDef>();
for (const p of PRIMITIVES) {
  if (BY_TYPE.has(p.type)) throw new Error(`duplicate primitive ${p.type}`);
  BY_TYPE.set(p.type, p);
}

export function getPrimitive(type: string): PrimitiveDef | undefined {
  return BY_TYPE.get(type);
}

export function registerPrimitive(def: PrimitiveDef): void {
  if (BY_TYPE.has(def.type)) throw new Error(`duplicate primitive ${def.type}`);
  BY_TYPE.set(def.type, def);
  PRIMITIVES.push(def);
}

export const CATEGORY_INFO: Record<Category, { label: string; blurb: string }> = {
  event: { label: 'Events', blurb: 'Where every mechanic starts.' },
  control: { label: 'Control', blurb: 'Branch, wait, gate and repeat.' },
  condition: { label: 'Conditions', blurb: 'True or false questions.' },
  data: { label: 'Values', blurb: 'Numbers, vectors and things in the world.' },
  variable: { label: 'Variables & Timers', blurb: 'Remember things between runs.' },
  action: { label: 'Actions', blurb: 'Change the world. Most cost something.' },
};

export const CATEGORY_ORDER: Category[] = ['event', 'action', 'control', 'condition', 'data', 'variable'];

export interface PortInfo {
  id: string;
  label: string;
  type: PortType;
  default?: ParamValue;
}

/** All input handles (exec 'in' first). */
export function inputPorts(def: PrimitiveDef): PortInfo[] {
  const out: PortInfo[] = [];
  if (def.execIn) out.push({ id: 'in', label: '', type: 'exec' });
  for (const p of def.inputs ?? []) out.push(p);
  return out;
}

/** All output handles (exec outs first). */
export function outputPorts(def: PrimitiveDef): PortInfo[] {
  const out: PortInfo[] = [];
  for (const e of def.execOut ?? []) out.push({ id: e.id, label: e.label, type: 'exec' });
  for (const p of def.outputs ?? []) out.push(p);
  return out;
}

export function defaultParams(def: PrimitiveDef): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const p of def.params ?? []) params[p.id] = p.default;
  return params;
}

export function nodeTitle(def: PrimitiveDef, params: Record<string, ParamValue>): string {
  try {
    return def.title ? def.title(params) : def.label;
  } catch {
    return def.label;
  }
}
