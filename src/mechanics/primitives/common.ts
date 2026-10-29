import { BINDABLE_KEYS } from '../../sim/input';
import type { ParamDef, PortDef } from '../types';

export const THEN = [{ id: 'then', label: '' }];
export const THEN_FAILED = [
  { id: 'then', label: 'Done' },
  { id: 'failed', label: 'Failed' },
];

export function keyParam(def: string): ParamDef {
  return { id: 'key', label: 'Key', kind: 'key', options: BINDABLE_KEYS.map((k) => ({ value: k, label: k })), default: def };
}

export function nameParam(label: string, def: string): ParamDef {
  return { id: 'name', label, kind: 'text', default: def };
}

export function scopeParam(): ParamDef {
  return {
    id: 'scope',
    label: 'Scope',
    kind: 'enum',
    options: [
      { value: 'mechanic', label: 'this mechanic' },
      { value: 'character', label: 'whole character' },
    ],
    default: 'mechanic',
  };
}

export const targetPort = (label = 'Target'): PortDef => ({ id: 'target', label, type: 'entity', default: 'self' });

export function num(id: string, label: string, def: number, extra: Partial<PortDef> = {}): PortDef {
  return { id, label, type: 'number', default: def, ...extra };
}

export function vecPort(id: string, label: string, x: number, y: number): PortDef {
  return { id, label, type: 'vector', default: { x, y } };
}

export function boolPort(id: string, label: string, def = false): PortDef {
  return { id, label, type: 'boolean', default: def };
}
