import { formatDefault } from '../docs/reference';
import { parseTemplate, presentationOf } from './presentation';
import { getPrimitive, nodeTitle } from './registry';
import { toScratch, type SBlock } from './scratch';
import type { GraphNode, MechanicGraph } from './schema';
import { handlerRank } from './edit';

/**
 * Explain Mechanic: a plain-language reading of a mechanic, generated deterministically from its
 * structure — the same structure the runtime executes. No guessing, no summarising beyond what the
 * blocks say. Lines carry an indent depth so C-blocks read as nested.
 */
export interface ExplainLine {
  depth: number;
  text: string;
  /** The block this line describes (click to select it). */
  node?: string;
  tone?: 'note' | 'warn';
}

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

function describeValue(g: MechanicGraph, node: GraphNode, port: string, depth = 0): string {
  const def = getPrimitive(node.type)!;
  const pdef = def.inputs?.find((p) => p.id === port);
  const edge = g.edges.find((e) => e.to === node.id && e.toPort === port);
  if (!edge) {
    if (!pdef) return '?';
    const v = node.params[port] ?? pdef.default;
    const zero = pdef.type === 'vector' && typeof v === 'object' && v.x === 0 && v.y === 0;
    if (zero && node.type === 'act.projectile') return 'your facing';
    if (zero && node.type === 'act.redirect') return 'straight back';
    return formatDefault(pdef.type, v);
  }
  const src = g.nodes.find((n) => n.id === edge.from);
  const sdef = src && getPrimitive(src.type);
  if (!src || !sdef) return '?';
  if (sdef.execIn || sdef.event) {
    const out = sdef.outputs?.find((o) => o.id === edge.fromPort);
    return `the ${out?.label.toLowerCase() ?? edge.fromPort} from “${nodeTitle(sdef, src.params)}”`;
  }
  if (depth > 6) return '…';
  return `(${phrase(g, src, depth + 1, edge.fromPort)})`;
}

/** A block's template with its fields and slots filled in. */
export function phrase(g: MechanicGraph, node: GraphNode, depth = 0, outPort?: string): string {
  const def = getPrimitive(node.type)!;
  const parts = parseTemplate(presentationOf(node.type).scratch.text);
  return parts
    .map((p) => {
      if (p.kind === 'text') return p.text.trim();
      if (p.kind === 'param') {
        const pd = def.params?.find((x) => x.id === p.id);
        const v = node.params[p.id] ?? pd?.default;
        const label = pd?.options?.find((o) => o.value === v)?.label ?? String(v);
        return pd?.kind === 'text' ? `“${label}”` : label;
      }
      if (p.kind === 'input') return describeValue(g, node, p.id, depth);
      return (def.outputs?.find((o) => o.id === outPort)?.label ?? outPort ?? '').toLowerCase();
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .replace(/ ([,.?:])/g, '$1');
}

function fallible(g: MechanicGraph, node: GraphNode): boolean {
  const def = getPrimitive(node.type);
  return !!def?.execOut?.some((o) => o.id === 'failed') && !g.edges.some((e) => e.from === node.id && e.fromPort === 'failed');
}

export function explainMechanic(g: MechanicGraph): ExplainLine[] {
  const lines: ExplainLine[] = [];
  if (!g.nodes.length) return [{ depth: 0, text: 'This mechanic is empty.', tone: 'note' }];
  const view = toScratch(g);
  const byId = (id: string) => g.nodes.find((n) => n.id === id)!;

  const stack = (blocks: SBlock[], depth: number) => {
    for (const b of blocks) {
      const n = byId(b.node);
      const spec = presentationOf(n.type).scratch;
      lines.push({ depth, text: capital(phrase(g, n)) + (spec.mouths[0] && !spec.mouths[0].label ? ':' : '.'), node: n.id });
      for (const [i, m] of spec.mouths.entries()) {
        const inner = b.mouths[m.port] ?? [];
        if (spec.optionalMouths.includes(m.port) && !inner.length) continue;
        if (i > 0 && !inner.length) continue;
        if (m.label) lines.push({ depth, text: `${capital(m.label)}:`, node: n.id });
        if (inner.length) stack(inner, depth + 1);
        else lines.push({ depth: depth + 1, text: 'nothing.', tone: 'note' });
      }
      if (fallible(g, n)) lines.push({ depth: depth + 1, text: 'If it can’t (cost, target, timing), it spends nothing and this script stops here.', tone: 'note' });
    }
  };

  if (view.ok) {
    for (const t of view.view.tops) {
      const n = byId(t.top);
      const def = getPrimitive(n.type)!;
      if (t.hat) {
        const r = handlerRank(g, n.id);
        const order = r ? ` (runs ${ORD[r.rank] ?? r.rank} of ${r.of} scripts on this event)` : '';
        lines.push({ depth: 0, text: `${capital(phrase(g, n))}${order}:`, node: n.id });
        if (!t.body.length) lines.push({ depth: 1, text: 'nothing is attached yet.', tone: 'warn' });
        stack(t.body, 1);
      } else {
        lines.push({ depth: 0, text: `Not attached to any event, so this never runs:`, node: n.id, tone: 'warn' });
        stack(t.body, 1);
        void def;
      }
    }
    for (const id of view.view.looseReporters) lines.push({ depth: 0, text: `A loose “${phrase(g, byId(id))}” that nothing reads.`, node: id, tone: 'note' });
    return lines;
  }

  // Not representable as stacks: follow the flow wires instead.
  lines.push({ depth: 0, text: 'This mechanic’s wiring can’t be drawn as stacks; reading it wire by wire:', tone: 'note' });
  const visited = new Set<string>();
  const follow = (id: string, depth: number) => {
    const n = byId(id);
    if (visited.has(id)) {
      lines.push({ depth, text: `Continues at “${nodeTitle(getPrimitive(n.type)!, n.params)}” (described above).`, node: id, tone: 'note' });
      return;
    }
    visited.add(id);
    const def = getPrimitive(n.type)!;
    lines.push({ depth, text: capital(phrase(g, n)) + '.', node: id });
    const outs = def.execOut ?? [];
    for (const o of outs) {
      const e = g.edges.find((x) => x.from === id && x.fromPort === o.id);
      if (!e) continue;
      if (outs.length > 1) lines.push({ depth, text: `${o.label || o.id}:`, node: id });
      follow(e.to, outs.length > 1 ? depth + 1 : depth);
    }
  };
  for (const n of g.nodes) if (getPrimitive(n.type)?.event) follow(n.id, 0);
  return lines;
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
