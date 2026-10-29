import { presentationOf, type ScratchSpec } from './presentation';
import { getPrimitive, nodeTitle } from './registry';
import { uid, type GraphEdge, type GraphNode, type MechanicGraph } from './schema';

/**
 * Scratch Blocks is a *view* of the canonical mechanic graph. Only flow (execution) wires are
 * restructured into stacks; value wires are untouched and drawn as nested reporters.
 *
 * The mapping is exact:
 *   - a block's `continuation` output → the block drawn underneath it
 *   - other flow outputs → C-block mouths
 *   - a "choice" block (if/else, cooldown, toggle) followed by a block X → the end of every mouth is
 *     wired to X (a join); for any other block, the end of a mouth runs nothing further
 * `toScratch` builds stacks, then re-derives the flow wires from them and compares with the graph.
 * If they differ in any way, the graph is reported as not representable — never approximated.
 */

export interface SBlock {
  node: string;
  mouths: Record<string, SBlock[]>;
}
export type SStack = SBlock[];

export interface STop {
  /** Node id of the top block: the event for a script, otherwise the first block of a loose stack. */
  top: string;
  hat: boolean;
  /** Blocks under the hat (scripts) or the whole stack, top block included (loose stacks). */
  body: SStack;
}

export interface ScratchView {
  tops: STop[];
  /** Value blocks nobody reads, drawn loose on the workspace. */
  looseReporters: string[];
}

export type ToScratchResult = { ok: true; view: ScratchView } | { ok: false; problems: string[] };

interface Pin {
  node: string;
  port: string;
}

const EXIT = '#exit';

export function scratchSpecOf(g: MechanicGraph, nodeId: string): ScratchSpec | null {
  const n = g.nodes.find((x) => x.id === nodeId);
  if (!n || !getPrimitive(n.type)) return null;
  return presentationOf(n.type).scratch;
}

export function isExecNode(n: GraphNode): boolean {
  const def = getPrimitive(n.type);
  return !!def && (!!def.execIn || !!def.event);
}

export function isPureNode(n: GraphNode): boolean {
  const def = getPrimitive(n.type);
  return !!def && !def.execIn && !def.event;
}

function title(g: MechanicGraph, id: string): string {
  const n = g.nodes.find((x) => x.id === id);
  const def = n && getPrimitive(n.type);
  return def ? `‘${nodeTitle(def, n.params)}’` : `‘${id}’`;
}

function portLabel(g: MechanicGraph, id: string, port: string): string {
  const n = g.nodes.find((x) => x.id === id);
  const def = n && getPrimitive(n.type);
  const label = def?.execOut?.find((e) => e.id === port)?.label;
  return label ? ` (${label})` : '';
}

/** Flow wires of the graph, keyed "from|port". */
function execWires(g: MechanicGraph): Map<string, string> {
  const out = new Map<string, string>();
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const e of g.edges) {
    const a = byId.get(e.from);
    const def = a && getPrimitive(a.type);
    if (!def?.execOut?.some((o) => o.id === e.fromPort)) continue;
    out.set(`${e.from}|${e.fromPort}`, e.to);
  }
  return out;
}

export function deriveExecEdges(g: MechanicGraph, view: ScratchView): { from: string; fromPort: string; to: string }[] {
  const out: { from: string; fromPort: string; to: string }[] = [];
  const stack = (st: SStack, entry: Pin[]): Pin[] => {
    let pins = entry;
    for (const b of st) {
      for (const p of pins) out.push({ from: p.node, fromPort: p.port, to: b.node });
      const spec = scratchSpecOf(g, b.node);
      if (!spec) {
        pins = [];
        continue;
      }
      if (spec.choice) {
        const tails: Pin[] = [];
        for (const m of spec.mouths) tails.push(...stack(b.mouths[m.port] ?? [], [{ node: b.node, port: m.port }]));
        pins = tails;
      } else {
        for (const m of spec.mouths) stack(b.mouths[m.port] ?? [], [{ node: b.node, port: m.port }]);
        pins = spec.continuation ? [{ node: b.node, port: spec.continuation }] : [];
      }
    }
    return pins;
  };
  for (const t of view.tops) {
    if (t.hat) {
      const spec = scratchSpecOf(g, t.top);
      stack(t.body, spec?.continuation ? [{ node: t.top, port: spec.continuation }] : []);
    } else stack(t.body, []);
  }
  return out;
}

export function canContinue(g: MechanicGraph, st: SStack): boolean {
  if (!st.length) return true;
  const spec = scratchSpecOf(g, st[st.length - 1].node);
  return !!spec && (spec.choice || !!spec.continuation);
}

/** Converts the canonical graph to stacks, or explains exactly why it can't be drawn that way. */
export function toScratch(g: MechanicGraph): ToScratchResult {
  const problems: string[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const unknown = g.nodes.filter((n) => !getPrimitive(n.type));
  if (unknown.length) return { ok: false, problems: unknown.map((n) => `Block type '${n.type}' is unknown to this version.`) };

  // 1. value wires must not loop
  const dataDeps = new Map<string, string[]>();
  for (const e of g.edges) {
    const a = byId.get(e.from);
    if (!a || !isPureNode(a)) continue;
    const b = byId.get(e.to);
    if (!b || !isPureNode(b)) continue;
    if (!dataDeps.has(e.to)) dataDeps.set(e.to, []);
    dataDeps.get(e.to)!.push(e.from);
  }
  {
    const color = new Map<string, number>();
    const visit = (id: string): boolean => {
      color.set(id, 1);
      for (const d of dataDeps.get(id) ?? []) {
        const c = color.get(d) ?? 0;
        if (c === 1) {
          problems.push(`Values loop back into ${title(g, d)}; a reporter can't be plugged into itself.`);
          return true;
        }
        if (c === 0 && visit(d)) return true;
      }
      color.set(id, 2);
      return false;
    };
    for (const n of g.nodes) if (isPureNode(n) && !color.get(n.id) && visit(n.id)) break;
  }

  // 2. flow wires must not loop
  const wires = execWires(g);
  const succAll = new Map<string, string[]>();
  for (const [k, to] of wires) {
    const from = k.split('|')[0];
    if (!succAll.has(from)) succAll.set(from, []);
    succAll.get(from)!.push(to);
  }
  {
    const color = new Map<string, number>();
    const visit = (id: string): boolean => {
      color.set(id, 1);
      for (const s of succAll.get(id) ?? []) {
        const c = color.get(s) ?? 0;
        if (c === 1) {
          problems.push(`Flow loops back into ${title(g, s)}. Scratch Blocks can only repeat with a repeat block.`);
          return true;
        }
        if (c === 0 && visit(s)) return true;
      }
      color.set(id, 2);
      return false;
    };
    for (const n of g.nodes) if (isExecNode(n) && !color.get(n.id) && visit(n.id)) break;
  }
  if (problems.length) return { ok: false, problems };

  // 3. structural successors and post-dominators
  const target = (id: string, port: string | null | undefined) => (port ? (wires.get(`${id}|${port}`) ?? null) : null);
  const structSucc = (id: string): string[] => {
    const spec = scratchSpecOf(g, id)!;
    if (spec.choice) return spec.mouths.map((m) => target(id, m.port) ?? EXIT);
    const t = target(id, spec.continuation);
    return t ? [t] : [EXIT];
  };
  const pdomMemo = new Map<string, Set<string>>();
  const pdom = (id: string): Set<string> => {
    if (id === EXIT) return new Set([EXIT]);
    const memo = pdomMemo.get(id);
    if (memo) return memo;
    const succ = structSucc(id);
    let acc: Set<string> = pdom(succ[0] ?? EXIT);
    for (const s of succ.slice(1)) {
      const ps = pdom(s);
      acc = new Set([...acc].filter((x) => ps.has(x)));
    }
    const res = new Set(acc);
    res.add(id);
    pdomMemo.set(id, res);
    return res;
  };
  const ipdom = (id: string): string | null => {
    let best: string | null = null;
    let bestSize = -1;
    for (const p of pdom(id)) {
      if (p === id) continue;
      const size = p === EXIT ? 1 : pdom(p).size;
      if (size > bestSize) {
        bestSize = size;
        best = p;
      }
    }
    return best === EXIT ? null : best;
  };

  // 4. build stacks from every root
  const owner = new Map<string, string>();
  const buildStack = (start: string | null, stopAt: string | null, root: string): SStack => {
    const st: SStack = [];
    let cur = start;
    let guard = 0;
    while (cur && cur !== stopAt && guard++ < 10000) {
      const prev = owner.get(cur);
      if (prev && prev !== root) {
        problems.push(`${title(g, cur)} is reached from both ${title(g, prev)} and ${title(g, root)}. In Scratch Blocks a block can belong to only one script.`);
        return st;
      }
      if (prev) {
        problems.push(`${title(g, cur)} is reached by two different paths inside ${title(g, root)}, which stacked blocks can't show.`);
        return st;
      }
      owner.set(cur, root);
      const spec = scratchSpecOf(g, cur)!;
      const block: SBlock = { node: cur, mouths: {} };
      if (spec.choice) {
        const join = ipdom(cur);
        for (const m of spec.mouths) block.mouths[m.port] = buildStack(target(cur, m.port), join, root);
        st.push(block);
        cur = join;
      } else {
        for (const m of spec.mouths) block.mouths[m.port] = buildStack(target(cur, m.port), null, root);
        st.push(block);
        cur = target(cur, spec.continuation);
      }
    }
    return st;
  };

  const hasIncoming = new Set(wires.values());
  const tops: STop[] = [];
  for (const n of g.nodes) {
    if (!isExecNode(n)) continue;
    const def = getPrimitive(n.type)!;
    if (def.event) {
      owner.set(n.id, n.id);
      const spec = presentationOf(n.type).scratch;
      tops.push({ top: n.id, hat: true, body: buildStack(target(n.id, spec.continuation), null, n.id) });
    } else if (!hasIncoming.has(n.id)) {
      tops.push({ top: n.id, hat: false, body: buildStack(n.id, null, n.id) });
    }
  }
  if (problems.length) return { ok: false, problems: [...new Set(problems)] };

  const view: ScratchView = {
    tops,
    looseReporters: g.nodes.filter((n) => isPureNode(n) && !g.edges.some((e) => e.from === n.id)).map((n) => n.id),
  };

  // 5. verify: the stacks must reproduce exactly the graph's flow wires
  const derived = deriveExecEdges(g, view);
  const want = new Map<string, number>();
  for (const [k, to] of wires) want.set(`${k}>${to}`, (want.get(`${k}>${to}`) ?? 0) + 1);
  const got = new Map<string, number>();
  for (const e of derived) got.set(`${e.from}|${e.fromPort}>${e.to}`, (got.get(`${e.from}|${e.fromPort}>${e.to}`) ?? 0) + 1);
  for (const [k, c] of want) {
    if ((got.get(k) ?? 0) === c) continue;
    const [from, rest] = k.split('|');
    const [port, to] = rest.split('>');
    problems.push(
      `The flow wire from ${title(g, from)}${portLabel(g, from, port)} to ${title(g, to)} jumps into another part of the script. Stacked blocks can only continue straight down, into a C-block mouth, or rejoin after an if/else.`,
    );
  }
  for (const [k, c] of got) {
    if ((want.get(k) ?? 0) >= c) continue;
    const [from, rest] = k.split('|');
    const [port, to] = rest.split('>');
    problems.push(
      `Drawn as stacks, ${title(g, from)}${portLabel(g, from, port)} would also continue into ${title(g, to)}, which the mechanic doesn't do. A failure path that rejoins the main stack can't be shown as blocks.`,
    );
  }
  const covered = new Set(owner.keys());
  for (const n of g.nodes) if (isExecNode(n) && !covered.has(n.id)) problems.push(`${title(g, n.id)} could not be placed in any script.`);
  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, view };
}

/**
 * Writes the view's structure back into the graph: flow wires are re-derived from the stacks
 * (re-using ids of unchanged wires); value wires, blocks and parameters are left exactly as they are.
 */
export function applyScratch(g: MechanicGraph, view: ScratchView): MechanicGraph {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const isFlowEdge = (e: GraphEdge) => {
    const def = getPrimitive(byId.get(e.from)?.type ?? '');
    return !!def?.execOut?.some((o) => o.id === e.fromPort);
  };
  const keep = g.edges.filter((e) => !isFlowEdge(e));
  const old = new Map(g.edges.filter(isFlowEdge).map((e) => [`${e.from}|${e.fromPort}>${e.to}`, e.id]));
  const flows = deriveExecEdges(g, view).map((e) => ({
    id: old.get(`${e.from}|${e.fromPort}>${e.to}`) ?? uid('e'),
    from: e.from,
    fromPort: e.fromPort,
    to: e.to,
    toPort: 'in',
  }));
  return { ...g, edges: [...keep, ...flows] };
}

// ---------------------------------------------------------------- structural edits

export type Fragment = { kind: 'stack'; blocks: SStack } | { kind: 'script'; top: STop };

export type DropTarget =
  | { kind: 'after'; node: string }
  | { kind: 'mouth'; node: string; port: string }
  | { kind: 'above'; top: string }
  | { kind: 'loose' };

function clone(view: ScratchView): ScratchView {
  return JSON.parse(JSON.stringify(view)) as ScratchView;
}

interface Located {
  stack: SStack;
  index: number;
  topIndex: number;
}

function locate(view: ScratchView, node: string): Located | null {
  const search = (stack: SStack, topIndex: number): Located | null => {
    for (let i = 0; i < stack.length; i++) {
      if (stack[i].node === node) return { stack, index: i, topIndex };
      for (const m of Object.values(stack[i].mouths)) {
        const r = search(m, topIndex);
        if (r) return r;
      }
    }
    return null;
  };
  for (let t = 0; t < view.tops.length; t++) {
    const r = search(view.tops[t].body, t);
    if (r) return r;
  }
  return null;
}

export function blocksIn(st: SStack): string[] {
  const out: string[] = [];
  for (const b of st) {
    out.push(b.node);
    for (const m of Object.values(b.mouths)) out.push(...blocksIn(m));
  }
  return out;
}

/** Lifts a block (and everything under it in its stack) out of the view. Hats take their whole script. */
export function detach(view: ScratchView, node: string): { view: ScratchView; fragment: Fragment } | null {
  const v = clone(view);
  const ti = v.tops.findIndex((t) => t.hat && t.top === node);
  if (ti >= 0) {
    const [top] = v.tops.splice(ti, 1);
    return { view: v, fragment: { kind: 'script', top } };
  }
  const at = locate(v, node);
  if (!at) return null;
  const blocks = at.stack.splice(at.index);
  const top = v.tops[at.topIndex];
  if (!top.hat && top.body.length === 0) v.tops.splice(at.topIndex, 1);
  return { view: v, fragment: { kind: 'stack', blocks } };
}

export type InsertResult = { ok: true; view: ScratchView } | { ok: false; reason: string };

/** Puts a fragment somewhere. Explains when the shapes don't fit. */
export function insert(g: MechanicGraph, view: ScratchView, fragment: Fragment, target: DropTarget): InsertResult {
  const v = clone(view);
  if (fragment.kind === 'script') {
    if (target.kind === 'loose') {
      v.tops.push(fragment.top);
      return { ok: true, view: v };
    }
    if (target.kind === 'above') {
      const ti = v.tops.findIndex((t) => t.top === target.top && !t.hat);
      if (ti < 0) return { ok: false, reason: 'Hat blocks can only go on top of a stack that has no hat yet.' };
      if (!canContinue(g, fragment.top.body))
        return { ok: false, reason: `Nothing can be attached under ${title(g, fragment.top.body[fragment.top.body.length - 1].node)}.` };
      const merged: STop = { ...fragment.top, body: [...fragment.top.body, ...v.tops[ti].body] };
      v.tops.splice(ti, 1, merged);
      return { ok: true, view: v };
    }
    return { ok: false, reason: 'A hat block starts a script; it can only go on top of a stack, not inside one.' };
  }
  const blocks = fragment.blocks;
  if (!blocks.length) return { ok: true, view: v };
  if (target.kind === 'loose') {
    v.tops.push({ top: blocks[0].node, hat: false, body: blocks });
    return { ok: true, view: v };
  }
  if (target.kind === 'above') {
    const ti = v.tops.findIndex((t) => t.top === target.top && !t.hat);
    if (ti < 0) return { ok: false, reason: 'That stack already starts with a hat block.' };
    if (!canContinue(g, blocks)) return { ok: false, reason: `Nothing can be attached under ${title(g, blocks[blocks.length - 1].node)}.` };
    v.tops[ti] = { top: blocks[0].node, hat: false, body: [...blocks, ...v.tops[ti].body] };
    return { ok: true, view: v };
  }
  if (target.kind === 'after') {
    const hatIdx = v.tops.findIndex((t) => t.hat && t.top === target.node);
    let stack: SStack;
    let index: number;
    if (hatIdx >= 0) {
      stack = v.tops[hatIdx].body;
      index = -1;
    } else {
      const at = locate(v, target.node);
      if (!at) return { ok: false, reason: 'That block is no longer there.' };
      stack = at.stack;
      index = at.index;
      if (!canContinue(g, [stack[index]])) return { ok: false, reason: `Nothing can be attached under ${title(g, target.node)}: it ends its stack.` };
    }
    const rest = stack.slice(index + 1);
    if (rest.length && !canContinue(g, blocks))
      return { ok: false, reason: `${title(g, blocks[blocks.length - 1].node)} ends a stack, so it can't go above other blocks.` };
    stack.splice(index + 1, 0, ...blocks);
    return { ok: true, view: v };
  }
  // mouth
  const at = locate(v, target.node);
  if (!at) return { ok: false, reason: 'That block is no longer there.' };
  const owner = at.stack[at.index];
  const spec = scratchSpecOf(g, owner.node);
  if (!spec?.mouths.some((m) => m.port === target.port)) return { ok: false, reason: `${title(g, owner.node)} has no such slot.` };
  const existing = owner.mouths[target.port] ?? [];
  if (existing.length && !canContinue(g, blocks))
    return { ok: false, reason: `${title(g, blocks[blocks.length - 1].node)} ends a stack, so it can't go above other blocks.` };
  owner.mouths[target.port] = [...blocks, ...existing];
  return { ok: true, view: v };
}

/**
 * Removes one block. Blocks underneath it close the gap; what was inside its mouths is removed with
 * it (returned so the caller can delete those blocks from the mechanic). Removing a hat turns its
 * script into a loose stack.
 */
export function removeBlock(g: MechanicGraph, view: ScratchView, node: string): { view: ScratchView; removed: string[] } | { error: string } {
  const v = clone(view);
  const ti = v.tops.findIndex((t) => t.hat && t.top === node);
  if (ti >= 0) {
    const t = v.tops[ti];
    if (t.body.length) v.tops.splice(ti, 1, { top: t.body[0].node, hat: false, body: t.body });
    else v.tops.splice(ti, 1);
    return { view: v, removed: [node] };
  }
  const at = locate(v, node);
  if (!at) return { error: 'That block is no longer there.' };
  const [b] = at.stack.splice(at.index, 1);
  const after = at.stack.slice(at.index);
  const before = at.stack.slice(0, at.index);
  if (after.length && before.length && !canContinue(g, before)) return { error: 'The block above cannot continue into the blocks below.' };
  const removed = [b.node, ...Object.values(b.mouths).flatMap(blocksIn)];
  const top = v.tops[at.topIndex];
  if (!top.hat) {
    if (!top.body.length) v.tops.splice(at.topIndex, 1);
    else top.top = top.body[0].node;
  }
  return { view: v, removed };
}

/** Moves top-level items so the view lists scripts in model order (used after edits). */
export function sortTops(g: MechanicGraph, view: ScratchView): ScratchView {
  const order = new Map(g.nodes.map((n, i) => [n.id, i]));
  return { ...view, tops: [...view.tops].sort((a, b) => (order.get(a.top) ?? 0) - (order.get(b.top) ?? 0)) };
}
