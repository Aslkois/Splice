import { CATEGORY_INFO, getPrimitive, nodeTitle } from '../mechanics/registry';
import { presentationOf } from '../mechanics/presentation';
import type { ParamValue, PortType } from '../mechanics/schema';
import { BLOCK_DOCS, type BlockDoc } from './blockDocs';

/**
 * The reference page for a block, assembled from the registry (names, types, defaults, tiers) and
 * the written docs (explanations). Defaults shown here are read from the registry itself.
 */
export interface RefRow {
  id: string;
  label: string;
  kind: 'input' | 'output' | 'param' | 'flow';
  type: PortType | 'choice' | 'text' | 'key' | 'flow';
  /** Default as shown to the player, e.g. "0", "(0, −650)", "me", "F". */
  defaultText?: string;
  options?: string[];
  description: string;
}

export interface Reference {
  type: string;
  label: string;
  blueprintTitle: string;
  scratchText: string;
  category: string;
  tier: number;
  doc: BlockDoc;
  rows: RefRow[];
}

const TIER_NAME = ['from the start', 'after Cross the Gap', 'after Return to Sender', 'after Survive the Impossible'];
export const tierName = (t: number) => TIER_NAME[t] ?? `tier ${t}`;

export function formatDefault(type: PortType, v: ParamValue | undefined): string {
  if (v === undefined) return type === 'boolean' ? 'false' : type === 'vector' ? '(0, 0)' : type === 'entity' ? 'me' : '0';
  if (type === 'entity') return v === 'none' ? 'nobody' : 'me';
  if (typeof v === 'object') return `(${v.x}, ${v.y})`;
  return String(v);
}

export function referenceFor(type: string): Reference | null {
  const def = getPrimitive(type);
  const doc = BLOCK_DOCS[type];
  if (!def || !doc) return null;
  const rows: RefRow[] = [];
  for (const p of def.params ?? []) {
    const opt = p.options?.find((o) => o.value === p.default);
    rows.push({
      id: p.id,
      label: p.label,
      kind: 'param',
      type: p.kind === 'enum' ? 'choice' : p.kind === 'number' ? 'number' : p.kind === 'key' ? 'key' : 'text',
      defaultText: opt ? opt.label : String(p.default),
      options: p.options?.map((o) => o.label),
      description: doc.ports[p.id] ?? '',
    });
  }
  for (const p of def.inputs ?? [])
    rows.push({ id: p.id, label: p.label, kind: 'input', type: p.type, defaultText: formatDefault(p.type, p.default), description: doc.ports[p.id] ?? '' });
  for (const p of def.outputs ?? []) rows.push({ id: p.id, label: p.label, kind: 'output', type: p.type, description: doc.ports[p.id] ?? '' });
  for (const e of def.execOut ?? []) rows.push({ id: e.id, label: e.label || 'then', kind: 'flow', type: 'flow', description: doc.ports[e.id] ?? '' });
  const pres = presentationOf(type);
  return {
    type,
    label: def.label,
    blueprintTitle: pres.blueprintTitle ?? nodeTitle(def, {}),
    scratchText: pres.scratch.text.replace(/\{p:(\w+)\}|\{i:(\w+)\}/g, (_m, p: string | undefined, i: string | undefined) => `[${def.params?.find((x) => x.id === p)?.label ?? def.inputs?.find((x) => x.id === i)?.label ?? p ?? i}]`).replace('{o}', '[X/Y]'),
    category: CATEGORY_INFO[def.category].label,
    tier: def.tier,
    doc,
    rows,
  };
}

/** Plain-text version of a reference page (search index and tests). */
export function referenceText(type: string): string {
  const r = referenceFor(type);
  if (!r) return '';
  const d = r.doc;
  return [
    r.label,
    r.category,
    d.summary,
    d.details,
    d.when,
    d.behavior,
    d.sideEffects,
    d.cost,
    ...r.rows.map((x) => `${x.label} ${x.type} ${x.defaultText ?? ''} ${x.description}`),
    ...d.mistakes,
    d.limitations,
    d.scratchDiff ?? '',
    ...presentationOf(type).aliases,
  ].join('\n');
}
