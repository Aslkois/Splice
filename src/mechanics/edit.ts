import { defaultParams, getPrimitive, inputPorts, outputPorts } from './registry';
import { uid, type GraphEdge, type GraphNode, type LayoutPoint, type MechanicGraph, type ParamValue, type PortType } from './schema';
import { checkConnection } from './validate';

/**
 * Model edits shared by both editors. Every function is pure: it returns a new graph and never
 * mutates its input, so undo/redo and editor switches always see a consistent mechanic.
 */

export type EditorKind = 'blueprint' | 'scratch';

export function touch(g: MechanicGraph): MechanicGraph {
  return { ...g, updated: Date.now() };
}

export function portType(g: MechanicGraph, nodeId: string, portId: string, side: 'in' | 'out'): PortType | undefined {
  const n = g.nodes.find((x) => x.id === nodeId);
  const def = n && getPrimitive(n.type);
  if (!def) return undefined;
  return (side === 'out' ? outputPorts(def) : inputPorts(def)).find((p) => p.id === portId)?.type;
}

export function addNode(
  g: MechanicGraph,
  type: string,
  opts: { params?: Record<string, ParamValue>; at?: { editor: EditorKind; pos: LayoutPoint }; id?: string } = {},
): { graph: MechanicGraph; id: string } {
  const def = getPrimitive(type);
  if (!def) throw new Error(`unknown block ${type}`);
  const id = opts.id ?? uid('n');
  const node: GraphNode = { id, type, params: { ...defaultParams(def), ...(opts.params ?? {}) } };
  const layout = { blueprint: { ...g.layout.blueprint }, scratch: { ...g.layout.scratch } };
  if (opts.at) layout[opts.at.editor][id] = { x: Math.round(opts.at.pos.x), y: Math.round(opts.at.pos.y) };
  return { graph: { ...g, nodes: [...g.nodes, node], layout }, id };
}

export function removeNodes(g: MechanicGraph, ids: Iterable<string>): MechanicGraph {
  const kill = new Set(ids);
  if (!kill.size) return g;
  const blueprint = { ...g.layout.blueprint };
  const scratch = { ...g.layout.scratch };
  for (const id of kill) {
    delete blueprint[id];
    delete scratch[id];
  }
  return {
    ...g,
    nodes: g.nodes.filter((n) => !kill.has(n.id)),
    edges: g.edges.filter((e) => !kill.has(e.from) && !kill.has(e.to)),
    layout: { blueprint, scratch },
  };
}

export function removeEdges(g: MechanicGraph, ids: Iterable<string>): MechanicGraph {
  const kill = new Set(ids);
  return kill.size ? { ...g, edges: g.edges.filter((e) => !kill.has(e.id)) } : g;
}

export type ConnectResult = { ok: true; graph: MechanicGraph; replaced: GraphEdge[] } | { ok: false; reason: string };

/**
 * Plugs an output into an input. One cable per flow output and one per value input: plugging in
 * replaces whatever was there (the replaced cables are reported, never silently lost).
 */
export function connect(g: MechanicGraph, from: string, fromPort: string, to: string, toPort: string): ConnectResult {
  const a = g.nodes.find((n) => n.id === from);
  const b = g.nodes.find((n) => n.id === to);
  const da = a && getPrimitive(a.type);
  const db = b && getPrimitive(b.type);
  if (!da || !db) return { ok: false, reason: 'One of those blocks no longer exists.' };
  const out = outputPorts(da).find((p) => p.id === fromPort);
  const inp = inputPorts(db).find((p) => p.id === toPort);
  const problem = checkConnection(out, inp);
  if (problem) return { ok: false, reason: problem };
  if (from === to && out!.type !== 'exec') return { ok: false, reason: 'A block cannot feed its own input.' };
  const replaced = g.edges.filter((e) =>
    out!.type === 'exec' ? e.from === from && e.fromPort === fromPort : e.to === to && e.toPort === toPort,
  );
  const kept = g.edges.filter((e) => !replaced.includes(e));
  const edge: GraphEdge = { id: uid('e'), from, fromPort, to, toPort };
  return { ok: true, graph: { ...g, edges: [...kept, edge] }, replaced };
}

export function setParam(g: MechanicGraph, nodeId: string, key: string, value: ParamValue): MechanicGraph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, params: { ...n.params, [key]: value } } : n)) };
}

export function setLayout(g: MechanicGraph, editor: EditorKind, positions: Record<string, LayoutPoint>, replace = false): MechanicGraph {
  const next = replace ? { ...positions } : { ...g.layout[editor], ...positions };
  return { ...g, layout: { ...g.layout, [editor]: next } };
}

/**
 * Copies blocks (and the cables between them). New ids everywhere; the copies are appended, so they
 * resolve after existing handlers of the same event.
 */
export function duplicateNodes(
  g: MechanicGraph,
  ids: string[],
  offset: LayoutPoint = { x: 40, y: 40 },
): { graph: MechanicGraph; map: Map<string, string> } {
  const pick = new Set(ids);
  const map = new Map<string, string>();
  for (const n of g.nodes) if (pick.has(n.id)) map.set(n.id, uid('n'));
  const nodes = g.nodes.filter((n) => pick.has(n.id)).map((n) => ({ ...n, id: map.get(n.id)!, params: JSON.parse(JSON.stringify(n.params)) }));
  const edges = g.edges.filter((e) => pick.has(e.from) && pick.has(e.to)).map((e) => ({ ...e, id: uid('e'), from: map.get(e.from)!, to: map.get(e.to)! }));
  const blueprint = { ...g.layout.blueprint };
  const scratch = { ...g.layout.scratch };
  for (const [old, nu] of map) {
    const b = g.layout.blueprint[old];
    if (b) blueprint[nu] = { x: b.x + offset.x, y: b.y + offset.y };
    const s = g.layout.scratch[old];
    if (s) scratch[nu] = { x: s.x + offset.x, y: s.y + offset.y };
  }
  return { graph: { ...g, nodes: [...g.nodes, ...nodes], edges: [...g.edges, ...edges], layout: { blueprint, scratch } }, map };
}

/**
 * Moves an event handler earlier or later among handlers of the SAME event — the only thing node
 * order changes. Returns the graph unchanged when there is nothing to swap with.
 */
export function moveHandler(g: MechanicGraph, nodeId: string, dir: -1 | 1): MechanicGraph {
  const node = g.nodes.find((n) => n.id === nodeId);
  const kind = node && getPrimitive(node.type)?.event?.kind;
  if (!node || !kind) return g;
  const peers = g.nodes.map((n, i) => ({ n, i })).filter(({ n }) => getPrimitive(n.type)?.event?.kind === kind);
  const at = peers.findIndex((p) => p.n.id === nodeId);
  const other = peers[at + dir];
  if (!other) return g;
  const nodes = [...g.nodes];
  const i = peers[at].i;
  [nodes[i], nodes[other.i]] = [nodes[other.i], nodes[i]];
  return { ...g, nodes };
}

/** "1st", "2nd"… among handlers of the same event, or null when it is the only one. */
export function handlerRank(g: MechanicGraph, nodeId: string): { rank: number; of: number } | null {
  const node = g.nodes.find((n) => n.id === nodeId);
  const kind = node && getPrimitive(node.type)?.event?.kind;
  if (!kind) return null;
  const peers = g.nodes.filter((n) => getPrimitive(n.type)?.event?.kind === kind);
  if (peers.length < 2) return null;
  return { rank: peers.findIndex((n) => n.id === nodeId) + 1, of: peers.length };
}

/**
 * Gives every block without a Blueprint position one: flow runs left to right in columns, and the
 * value blocks a block reads sit underneath it. Existing positions are never moved.
 */
export function ensureBlueprintLayout(g: MechanicGraph): MechanicGraph {
  const missing = new Set(g.nodes.filter((n) => !g.layout.blueprint[n.id]).map((n) => n.id));
  if (!missing.size) return g;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const isExec = (id: string) => {
    const d = getPrimitive(byId.get(id)?.type ?? '');
    return !!d && (!!d.execIn || !!d.event);
  };
  const flowOut = new Map<string, string[]>();
  const dataIn = new Map<string, string[]>();
  for (const e of g.edges) {
    if (portType(g, e.from, e.fromPort, 'out') === 'exec') (flowOut.get(e.from) ?? flowOut.set(e.from, []).get(e.from)!).push(e.to);
    else (dataIn.get(e.to) ?? dataIn.set(e.to, []).get(e.to)!).push(e.from);
  }
  // Flow depth: longest distance from an event (cycles cut).
  const depth = new Map<string, number>();
  const visit = (id: string, d: number, path: Set<string>) => {
    if (path.has(id) || (depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    path.add(id);
    for (const n of flowOut.get(id) ?? []) visit(n, d + 1, path);
    path.delete(id);
  };
  for (const n of g.nodes) if (getPrimitive(n.type)?.event) visit(n.id, 0, new Set());
  for (const n of g.nodes) if (isExec(n.id) && !depth.has(n.id)) visit(n.id, 0, new Set());

  const placed: Record<string, LayoutPoint> = { ...g.layout.blueprint };
  const existing = Object.values(g.layout.blueprint);
  const top = existing.length ? Math.max(...existing.map((p) => p.y)) + 260 : 0;
  const colY = new Map<number, number>();
  const owned = new Set<string>();
  // Value blocks under the block that reads them (each placed once, under its first reader).
  const placeValues = (reader: string, x: number, y: number): number => {
    let yy = y;
    for (const src of dataIn.get(reader) ?? []) {
      if (owned.has(src) || isExec(src)) continue;
      owned.add(src);
      if (missing.has(src)) placed[src] = { x: x + 24, y: yy };
      yy = placeValues(src, x + 24, yy + 110);
    }
    return yy;
  };
  const execs = g.nodes.filter((n) => isExec(n.id));
  for (const n of execs) {
    const col = depth.get(n.id) ?? 0;
    const x = col * 380;
    const y = colY.get(col) ?? top;
    if (missing.has(n.id)) placed[n.id] = { x, y };
    const p = placed[n.id];
    const end = placeValues(n.id, p.x, p.y + 170);
    colY.set(col, Math.max(y + 200, end + 40));
  }
  // Loose value blocks.
  let ly = Math.max(top, ...[...colY.values()]);
  for (const n of g.nodes) {
    if (placed[n.id]) continue;
    placed[n.id] = { x: 0, y: ly };
    ly = placeValues(n.id, 0, ly + 110) + 20;
  }
  return { ...g, layout: { ...g.layout, blueprint: placed } };
}
