import { connect, duplicateNodes, removeNodes } from './edit';
import { getPrimitive, outputPorts } from './registry';
import { applyScratch, blocksIn, isPureNode, toScratch, wellFormed, type ScratchView, type STop } from './scratch';
import type { LayoutPoint, MechanicGraph } from './schema';

/**
 * Edits that Scratch Blocks makes, expressed on the canonical graph. The editor holds no state of
 * its own beyond the drag in progress: every change goes through these functions, which either
 * produce a valid graph or refuse with a reason.
 */

const nodeOf = (g: MechanicGraph, id: string) => g.nodes.find((n) => n.id === id);

/** Pure value blocks that feed `id` (directly or through other value blocks). */
export function upstream(g: MechanicGraph, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (n: string) => {
    for (const e of g.edges) {
      if (e.to !== n || out.has(e.from)) continue;
      const src = nodeOf(g, e.from);
      if (!src || !isPureNode(src)) continue;
      out.add(e.from);
      walk(e.from);
    }
  };
  walk(id);
  return out;
}

/**
 * Value blocks that would be left feeding nothing once `ids` are gone — the reporters "inside" those
 * blocks. A reporter that also feeds a block that stays is kept.
 */
export function exclusiveReporters(g: MechanicGraph, ids: Iterable<string>): string[] {
  const gone = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of g.nodes) {
      if (gone.has(n.id) || !isPureNode(n)) continue;
      const consumers = g.edges.filter((e) => e.from === n.id).map((e) => e.to);
      if (consumers.length && consumers.every((c) => gone.has(c))) {
        gone.add(n.id);
        changed = true;
      }
    }
  }
  for (const id of ids) gone.delete(id);
  return [...gone];
}

/** Deletes blocks together with the reporters plugged into them (and only into them). */
export function deleteWithReporters(g: MechanicGraph, ids: string[]): { graph: MechanicGraph; removed: string[] } {
  const removed = [...ids, ...exclusiveReporters(g, ids)];
  return { graph: removeNodes(g, removed), removed };
}

export type PlugResult = { ok: true; graph: MechanicGraph; displaced: string[] } | { ok: false; reason: string };

/**
 * Plugs a value (a reporter, or an output of an event/action) into an input slot. A reporter that was
 * in the slot is not deleted: it is unplugged and left loose on the workspace.
 */
export function plug(g: MechanicGraph, src: string, srcPort: string, dst: string, dstPort: string): PlugResult {
  if (src === dst) return { ok: false, reason: 'A block cannot be plugged into itself.' };
  if (upstream(g, src).has(dst)) return { ok: false, reason: 'That would make the value depend on itself.' };
  const r = connect(g, src, srcPort, dst, dstPort);
  if (!r.ok) return r;
  const displaced = r.replaced.map((e) => e.from).filter((id) => {
    const n = nodeOf(r.graph, id);
    return !!n && isPureNode(n) && !r.graph.edges.some((e) => e.from === id);
  });
  return { ok: true, graph: r.graph, displaced };
}

export function unplug(g: MechanicGraph, dst: string, dstPort: string): MechanicGraph {
  return { ...g, edges: g.edges.filter((e) => !(e.to === dst && e.toPort === dstPort)) };
}

/** The output a reporter presents in a slot: the wired one, else the first matching or first output. */
export function reporterPort(g: MechanicGraph, id: string, wantType?: string): string {
  const def = getPrimitive(nodeOf(g, id)?.type ?? '');
  const outs = def ? outputPorts(def).filter((p) => p.type !== 'exec') : [];
  return (wantType ? outs.find((p) => p.type === wantType) : undefined)?.id ?? outs[0]?.id ?? 'out';
}

export type CommitResult = { ok: true; graph: MechanicGraph } | { ok: false; reason: string };

/**
 * Writes an edited view back to the graph. Refuses (graph untouched) unless the result is well
 * formed AND reads back as exactly the same stacks, so what you see is always what runs.
 */
export function commitView(g: MechanicGraph, view: ScratchView): CommitResult {
  const bad = wellFormed(g, view);
  if (bad) return { ok: false, reason: bad };
  const next = applyScratch(g, view);
  const back = toScratch(next);
  if (!back.ok) return { ok: false, reason: back.problems[0] };
  return { ok: true, graph: tidyScratchLayout(next, back.view) };
}

/** Removes Scratch positions of blocks that no longer start a stack (they live inside one now). */
export function tidyScratchLayout(g: MechanicGraph, view: ScratchView): MechanicGraph {
  const keep = new Set([...view.tops.map((t) => t.top), ...view.looseReporters]);
  const scratch: Record<string, LayoutPoint> = {};
  for (const [id, p] of Object.entries(g.layout.scratch)) if (keep.has(id)) scratch[id] = p;
  if (Object.keys(scratch).length === Object.keys(g.layout.scratch).length) return g;
  return { ...g, layout: { ...g.layout, scratch } };
}

const ROW = 44;

/** Rough height of a script on screen, used only to place scripts that have no position yet. */
export function estimateHeight(top: STop): number {
  const stack = (st: STop['body']): number =>
    st.reduce((h, b) => {
      const mouths = Object.values(b.mouths);
      return h + ROW + mouths.reduce((m, s) => m + Math.max(24, stack(s)) + 28, 0);
    }, 0);
  return (top.hat ? 64 : 0) + stack(top.body);
}

/**
 * Gives every script and loose reporter without a position one, in a column to the right of what is
 * already placed. Existing positions never move.
 */
export function autoPlace(g: MechanicGraph, view: ScratchView): MechanicGraph {
  const missing = [...view.tops.map((t) => t.top), ...view.looseReporters].filter((id) => !g.layout.scratch[id]);
  if (!missing.length) return g;
  const scratch = { ...g.layout.scratch };
  const placed = Object.values(scratch);
  let x = placed.length ? Math.max(...placed.map((p) => p.x)) + 420 : 40;
  if (!placed.length) x = 40;
  let y = 40;
  for (const t of view.tops) {
    if (scratch[t.top]) continue;
    scratch[t.top] = { x, y };
    y += estimateHeight(t) + 48;
    if (y > 1600) {
      y = 40;
      x += 420;
    }
  }
  for (const id of view.looseReporters) {
    if (scratch[id]) continue;
    scratch[id] = { x, y };
    y += 56;
  }
  return { ...g, layout: { ...g.layout, scratch } };
}

/**
 * Duplicates a block and everything under it in its stack (a hat duplicates its whole script; a
 * reporter duplicates itself and what is plugged into it). Reporters plugged into the copied blocks
 * are copied too. Returns the copy's top block.
 */
export function duplicateFrom(g: MechanicGraph, view: ScratchView, node: string, offset: LayoutPoint = { x: 32, y: 32 }): { graph: MechanicGraph; top: string } | null {
  const n = nodeOf(g, node);
  if (!n) return null;
  let ids: string[];
  if (isPureNode(n)) ids = [node];
  else {
    const hatTop = view.tops.find((t) => t.hat && t.top === node);
    if (hatTop) ids = [node, ...blocksIn(hatTop.body)];
    else {
      const find = (st: STop['body']): string[] | null => {
        for (let i = 0; i < st.length; i++) {
          if (st[i].node === node) return blocksIn(st.slice(i));
          for (const m of Object.values(st[i].mouths)) {
            const r = find(m);
            if (r) return r;
          }
        }
        return null;
      };
      ids = view.tops.map((t) => find(t.body)).find((r) => r) ?? [node];
    }
  }
  const withValues = new Set(ids);
  for (const id of ids) for (const u of upstream(g, id)) withValues.add(u);
  const { graph, map } = duplicateNodes(g, [...withValues], offset);
  const top = map.get(node)!;
  const at = g.layout.scratch[node];
  const scratch = { ...graph.layout.scratch };
  scratch[top] = at ? { x: at.x + offset.x, y: at.y + offset.y } : { x: 80, y: 80 };
  return { graph: { ...graph, layout: { ...graph.layout, scratch } }, top };
}
