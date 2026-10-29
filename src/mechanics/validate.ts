import { getPrimitive, inputPorts, nodeTitle, outputPorts, type PortInfo } from './registry';
import type { GraphEdge, GraphNode, MechanicGraph, PortType } from './schema';
import type { PrimitiveDef } from './types';

export interface Issue {
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidateOptions {
  /** Highest unlocked tier (campaign). Omit for everything. */
  maxTier?: number;
  /** Challenge Lab: only these primitive types may be used. */
  allowedTypes?: readonly string[];
  /** Challenge Lab: block budget for this graph. */
  maxBlocks?: number;
}

const TYPE_NAMES: Record<PortType, string> = {
  exec: 'flow',
  number: 'Number',
  boolean: 'True/False',
  vector: 'Vector',
  entity: 'Entity',
};

function conversionHint(from: PortType, to: PortType): string {
  if (from === 'number' && to === 'boolean') return ' Use Compare to turn a number into true/false.';
  if (from === 'vector' && to === 'number') return ' Use Vector Length or Break Vector.';
  if (from === 'number' && to === 'vector') return ' Use Make Vector.';
  if (from === 'entity' && to === 'vector') return ' Use Position Of or Direction To.';
  if (from === 'entity' && to === 'number') return ' Use Health Of or Distance To.';
  if (from === 'boolean' && to === 'number') return ' Use If to choose between two numbers.';
  return '';
}

/** Can a wire go from this output port to that input port? Used live by the editor too. */
export function checkConnection(from: PortInfo | undefined, to: PortInfo | undefined): string | null {
  if (!from || !to) return 'That port does not exist.';
  if ((from.type === 'exec') !== (to.type === 'exec')) {
    return from.type === 'exec'
      ? 'Flow wires carry "what happens next" — connect them to a flow input (the arrow on the left of an action).'
      : 'Value wires carry data — connect them to a matching value input, not a flow input.';
  }
  if (from.type !== to.type) return `Can't plug ${TYPE_NAMES[from.type]} into ${TYPE_NAMES[to.type]}.${conversionHint(from.type, to.type)}`;
  return null;
}

const HIT_EVENTS = new Set(['hit.incoming', 'block.success']);
const ASYNC_PORTS: Record<string, Set<string>> = {
  'flow.delay': new Set(['then']),
  'act.channelUntil': new Set(['charged', 'interrupted']),
};

export function validateGraph(g: MechanicGraph, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const nodes = new Map<string, { node: GraphNode; def: PrimitiveDef }>();
  const label = (id: string) => {
    const n = nodes.get(id);
    return n ? `'${nodeTitle(n.def, n.node.params)}'` : `'${id}'`;
  };

  for (const node of g.nodes) {
    if (nodes.has(node.id)) {
      issues.push({ severity: 'error', message: `Duplicate block id ${node.id}.`, nodeId: node.id });
      continue;
    }
    const def = getPrimitive(node.type);
    if (!def) {
      issues.push({ severity: 'error', message: `Unknown block type '${node.type}'.`, nodeId: node.id });
      continue;
    }
    nodes.set(node.id, { node, def });
    if (opts.allowedTypes) {
      if (!opts.allowedTypes.includes(def.type))
        issues.push({ severity: 'error', message: `'${def.label}' is not allowed in this lab.`, nodeId: node.id });
    } else if (opts.maxTier != null && def.tier > opts.maxTier)
      issues.push({ severity: 'error', message: `'${def.label}' is not unlocked yet — keep going in the campaign.`, nodeId: node.id });
    for (const p of def.params ?? []) {
      if (p.kind === 'text' && String(node.params[p.id] ?? p.default).trim() === '')
        issues.push({ severity: 'error', message: `'${def.label}' needs a ${p.label.toLowerCase()} name.`, nodeId: node.id });
      if ((p.kind === 'enum' || p.kind === 'key') && p.options && node.params[p.id] !== undefined && !p.options.some((o) => o.value === node.params[p.id]))
        issues.push({ severity: 'error', message: `'${def.label}' has an invalid ${p.label.toLowerCase()}.`, nodeId: node.id });
    }
  }

  // ---- edges ----
  const execOutUse = new Map<string, number>();
  const dataInUse = new Map<string, number>();
  const execAdj = new Map<string, { to: string; port: string }[]>();
  const dataDeps = new Map<string, string[]>(); // target node -> source nodes (data)
  const validEdges: GraphEdge[] = [];

  for (const e of g.edges) {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) {
      issues.push({ severity: 'error', message: 'A wire points at a block that no longer exists.', edgeId: e.id });
      continue;
    }
    const fromPort = outputPorts(a.def).find((p) => p.id === e.fromPort);
    const toPort = inputPorts(b.def).find((p) => p.id === e.toPort);
    const problem = checkConnection(fromPort, toPort);
    if (problem) {
      issues.push({ severity: 'error', message: `${label(e.from)} → ${label(e.to)}: ${problem}`, edgeId: e.id, nodeId: e.to });
      continue;
    }
    if (fromPort!.type === 'exec') {
      const k = `${e.from}:${e.fromPort}`;
      execOutUse.set(k, (execOutUse.get(k) ?? 0) + 1);
      if (execOutUse.get(k) === 2)
        issues.push({ severity: 'error', message: `${label(e.from)} has two wires leaving one flow output. Use a Sequence to do several things in order.`, nodeId: e.from, edgeId: e.id });
      if (!execAdj.has(e.from)) execAdj.set(e.from, []);
      execAdj.get(e.from)!.push({ to: e.to, port: e.fromPort });
    } else {
      const k = `${e.to}:${e.toPort}`;
      dataInUse.set(k, (dataInUse.get(k) ?? 0) + 1);
      if (dataInUse.get(k) === 2)
        issues.push({ severity: 'error', message: `${label(e.to)} has two wires into one input — which value should it use?`, nodeId: e.to, edgeId: e.id });
      if (e.from === e.to) {
        issues.push({ severity: 'error', message: `${label(e.to)} feeds its own input.`, nodeId: e.to, edgeId: e.id });
        continue;
      }
      if (!dataDeps.has(e.to)) dataDeps.set(e.to, []);
      dataDeps.get(e.to)!.push(e.from);
    }
    validEdges.push(e);
  }

  // ---- data cycles ----
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  let cycleReported = false;
  const visitData = (id: string) => {
    if (cycleReported) return;
    color.set(id, 1);
    stack.push(id);
    for (const dep of dataDeps.get(id) ?? []) {
      const c = color.get(dep) ?? 0;
      if (c === 1) {
        const loop = stack.slice(stack.indexOf(dep)).map(label).join(' → ');
        issues.push({ severity: 'error', message: `Values feed back into themselves: ${loop} → ${label(dep)}.`, nodeId: dep });
        cycleReported = true;
        return;
      }
      if (c === 0) visitData(dep);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of nodes.keys()) if ((color.get(id) ?? 0) === 0) visitData(id);

  // ---- exec reachability from events ----
  const reachedBy = new Map<string, Set<string>>(); // exec node -> event roots
  /** Exec nodes reachable on a path where no hit is open (non-hit event, or after a Delay). */
  const hitClosed = new Map<string, boolean>();
  /** Exec nodes whose only hit-carrying root is On Hit Resolved (the hit is closed there). */
  const viaResolved = new Map<string, boolean>();
  for (const [id, { def }] of nodes) {
    if (!def.event) continue;
    const seen = new Set<string>();
    const queue: { id: string; async: boolean }[] = [{ id, async: false }];
    while (queue.length) {
      const cur = queue.shift()!;
      const key = `${cur.id}:${cur.async}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!reachedBy.has(cur.id)) reachedBy.set(cur.id, new Set());
      reachedBy.get(cur.id)!.add(id);
      if (cur.async || !HIT_EVENTS.has(def.event.kind)) hitClosed.set(cur.id, true);
      if (def.event.kind === 'hit.resolved') viaResolved.set(cur.id, true);
      const curType = nodes.get(cur.id)?.node.type ?? '';
      for (const nxt of execAdj.get(cur.id) ?? []) {
        const becomesAsync = cur.async || !!ASYNC_PORTS[curType]?.has(nxt.port);
        queue.push({ id: nxt.to, async: becomesAsync });
      }
    }
    if (!(execAdj.get(id)?.length))
      issues.push({ severity: 'warning', message: `${label(id)} isn't connected to anything yet.`, nodeId: id });
  }

  const hitResolvedOnly = new Set([...viaResolved.keys()]);
  for (const [id, { def }] of nodes) {
    if (def.execIn && !reachedBy.has(id))
      issues.push({ severity: 'warning', message: `${label(id)} never runs — wire it to an event.`, nodeId: id });
    if (def.needsOpenHit && reachedBy.has(id) && hitClosed.get(id))
      issues.push({
        severity: 'warning',
        message: hitResolvedOnly.has(id)
          ? `${label(id)} runs from On Hit Resolved, after the hit has already landed — too late to change it. Use On Incoming Hit or On Guarded Hit.`
          : `${label(id)} only works while a hit is incoming — run it from On Incoming Hit or On Guarded Hit, without a Delay in between.`,
        nodeId: id,
      });
  }

  // ---- event data used outside its event ----
  const eventDeps = (id: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    if (seen.has(id)) return out;
    seen.add(id);
    for (const dep of dataDeps.get(id) ?? []) {
      const d = nodes.get(dep);
      if (!d) continue;
      if (d.def.event) out.add(dep);
      else if (d.def.evaluate) for (const x of eventDeps(dep, seen)) out.add(x);
    }
    return out;
  };
  for (const [id, { def }] of nodes) {
    if (!def.execIn) continue;
    const roots = reachedBy.get(id);
    if (!roots) continue;
    for (const ev of eventDeps(id)) {
      if (!roots.has(ev))
        issues.push({
          severity: 'warning',
          message: `${label(id)} reads a value from ${label(ev)}, but only runs from other events — that value will be empty.`,
          nodeId: id,
        });
    }
  }

  // ---- exec loops ----
  const ecolor = new Map<string, 0 | 1 | 2>();
  let execLoop = false;
  const visitExec = (id: string) => {
    if (execLoop) return;
    ecolor.set(id, 1);
    for (const nxt of execAdj.get(id) ?? []) {
      const c = ecolor.get(nxt.to) ?? 0;
      if (c === 1) {
        execLoop = true;
        issues.push({
          severity: 'warning',
          message: `Flow loops back into ${label(nxt.to)}. It will repeat until the step budget stops it — add a Delay or a condition.`,
          nodeId: nxt.to,
        });
        return;
      }
      if (c === 0) visitExec(nxt.to);
    }
    ecolor.set(id, 2);
  };
  for (const id of nodes.keys()) if ((ecolor.get(id) ?? 0) === 0) visitExec(id);

  if (opts.maxBlocks != null && g.nodes.length > opts.maxBlocks)
    issues.push({ severity: 'error', message: `Uses ${g.nodes.length} blocks; this lab allows ${opts.maxBlocks}.` });

  if (!g.nodes.some((n) => getPrimitive(n.type)?.event))
    issues.push({ severity: 'warning', message: 'This mechanic has no event, so nothing will ever start it.' });

  return issues;
}
