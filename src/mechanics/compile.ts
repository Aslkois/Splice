import type { SimEventKind } from '../sim/driver';
import { getPrimitive, inputPorts, outputPorts } from './registry';
import type { MechanicGraph } from './schema';
import type { CompiledNode } from './types';
import { validateGraph, type Issue, type ValidateOptions } from './validate';

export interface CompiledMechanic {
  id: string;
  name: string;
  color: string;
  nodes: Map<string, CompiledNode>;
  /** Event handlers per kind, in model order (the order of the node list). */
  events: Map<SimEventKind, CompiledNode[]>;
  issues: Issue[];
  /** False when the graph has errors; such mechanics are never executed. */
  ok: boolean;
}

/**
 * Turns a saved graph into an executable structure. No code is generated or evaluated:
 * the result is plain lookup tables the bounded interpreter walks.
 */
export function compileGraph(g: MechanicGraph, opts: ValidateOptions = {}): CompiledMechanic {
  const issues = validateGraph(g, opts);
  const ok = !issues.some((i) => i.severity === 'error');
  const nodes = new Map<string, CompiledNode>();
  // Resolution order is the node list order — never screen position, which differs per editor.
  g.nodes.forEach((n, order) => {
    const def = getPrimitive(n.type);
    if (!def) return;
    nodes.set(n.id, { id: n.id, type: n.type, def, params: { ...n.params }, order, execOut: new Map(), dataIn: new Map() });
  });
  for (const e of g.edges) {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) continue;
    const fp = outputPorts(a.def).find((p) => p.id === e.fromPort);
    const tp = inputPorts(b.def).find((p) => p.id === e.toPort);
    if (!fp || !tp || (fp.type === 'exec') !== (tp.type === 'exec') || fp.type !== tp.type) continue;
    if (fp.type === 'exec') {
      if (!a.execOut.has(e.fromPort)) a.execOut.set(e.fromPort, e.to);
    } else if (!b.dataIn.has(e.toPort)) b.dataIn.set(e.toPort, { node: e.from, port: e.fromPort });
  }
  const events = new Map<SimEventKind, CompiledNode[]>();
  for (const n of [...nodes.values()].sort((a, b) => a.order - b.order)) {
    const kind = n.def.event?.kind;
    if (!kind) continue;
    if (!events.has(kind)) events.set(kind, []);
    events.get(kind)!.push(n);
  }
  return { id: g.id, name: g.name, color: g.color, nodes, events, issues, ok };
}
