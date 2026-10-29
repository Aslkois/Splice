import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { synth } from '../../../audio/Synth';
import { compileGraph } from '../../../mechanics/compile';
import { addNode, handlerRank, moveHandler, setLayout, setParam } from '../../../mechanics/edit';
import { presentationOf } from '../../../mechanics/presentation';
import { getPrimitive, nodeTitle } from '../../../mechanics/registry';
import type { NodeTrace } from '../../../mechanics/runtime';
import { blocksIn, detach, insert, isPureNode, moveInStack, removeBlock, toScratch, type DropTarget, type Fragment, type ScratchView } from '../../../mechanics/scratch';
import { autoPlace, commitView, deleteWithReporters, duplicateFrom, plug, reporterPort, unplug } from '../../../mechanics/scratchEdit';
import type { GraphEdge, LayoutPoint, MechanicGraph, ParamValue, PortType } from '../../../mechanics/schema';
import type { Issue, ValidateOptions } from '../../../mechanics/validate';
import { partLocked } from '../editorContext';
import { Block, Reporter, Script, Stack } from './blocks';
import { SbContext, type DragSource, type SbApi } from './sbContext';
import './scratch.css';

export interface ScratchEditorHandle {
  addNode(type: string): void;
  focusNode(id: string): void;
  beginPaletteDrag(type: string, e: React.PointerEvent): void;
}

interface Props {
  graph: MechanicGraph;
  rules: ValidateOptions;
  trace: Map<string, NodeTrace> | undefined;
  recent: Set<string>;
  selected: string | null;
  onSelect(id: string | null): void;
  onCommit(g: MechanicGraph): void;
  /** Saves layout-only changes without an undo step (placing scripts that had no position). */
  onQuietLayout(g: MechanicGraph): void;
  onToast(msg: string): void;
  onSwitchToBlueprint(): void;
  onHelp?(type: string): void;
}

type Carry = { kind: 'exec'; fragment: Fragment; root: string } | { kind: 'reporter'; node: string; port: string } | { kind: 'ref'; node: string; port: string };

type Zone =
  | { kind: 'after'; node: string; x: number; y: number }
  | { kind: 'mouth'; node: string; port: string; x: number; y: number }
  | { kind: 'above'; top: string; x: number; y: number }
  | { kind: 'slot'; node: string; port: string; type: PortType; rect: DOMRect };

interface Hover {
  zone: Zone;
  ok: boolean;
  reason?: string;
  graph?: MechanicGraph;
}

interface Drag {
  carry: Carry;
  graph: MechanicGraph;
  view: ScratchView;
  fresh: boolean;
  /** Pointer offset inside the ghost (screen px). */
  dx: number;
  dy: number;
  x: number;
  y: number;
  zones: Zone[] | null;
  hover: Hover | null;
  overPalette: boolean;
}

interface Pending {
  src: DragSource;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

const SNAP = 30;

function edgeIndex(g: MechanicGraph) {
  const inEdge = new Map<string, GraphEdge>();
  const outCount = new Map<string, number>();
  for (const e of g.edges) {
    const n = g.nodes.find((x) => x.id === e.from);
    const def = n && getPrimitive(n.type);
    if (def?.execOut?.some((o) => o.id === e.fromPort)) continue;
    inEdge.set(`${e.to}:${e.toPort}`, e);
    outCount.set(e.from, (outCount.get(e.from) ?? 0) + 1);
  }
  return { inEdge, outCount };
}

function namesIn(g: MechanicGraph): Map<string, string[]> {
  const m = new Map<string, Set<string>>();
  for (const n of g.nodes) {
    const v = n.params.name;
    if (typeof v !== 'string' || !v) continue;
    if (!m.has('name')) m.set('name', new Set());
    m.get('name')!.add(v);
  }
  return new Map([...m].map(([k, s]) => [k, [...s].sort()]));
}

export const ScratchEditor = forwardRef<ScratchEditorHandle, Props>(function ScratchEditor(props, ref) {
  const { graph, rules, trace, recent, selected, onSelect, onCommit, onQuietLayout, onToast, onSwitchToBlueprint, onHelp } = props;
  const ws = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<LayoutPoint>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const pending = useRef<Pending | null>(null);
  const panning = useRef<{ x0: number; y0: number; px: number; py: number } | null>(null);
  const [failOpen, setFailOpen] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; node: string } | null>(null);
  const latest = useRef(graph);
  latest.current = graph;

  const conv = useMemo(() => toScratch(graph), [graph]);
  const view = conv.ok ? conv.view : null;

  // Scripts without a position get one, quietly (it isn't an edit you'd want to undo).
  useEffect(() => {
    if (!view) return;
    const placed = autoPlace(graph, view);
    if (placed !== graph) onQuietLayout(placed);
  }, [graph, view, onQuietLayout]);

  const compiled = useMemo(() => compileGraph(graph, rules), [graph, rules]);
  const issues = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of compiled.issues) if (i.nodeId) (m.get(i.nodeId) ?? m.set(i.nodeId, []).get(i.nodeId)!).push(i);
    return m;
  }, [compiled]);

  const commit = useCallback(
    (g: MechanicGraph, sound: 'drop' | 'plug' | 'unplug' | 'click' | null = 'drop') => {
      onCommit({ ...g, updated: Date.now() });
      if (sound === 'drop') synth.uiDrop();
      else if (sound === 'plug') synth.uiPlug();
      else if (sound === 'unplug') synth.uiUnplug();
      else if (sound === 'click') synth.uiClick();
    },
    [onCommit],
  );

  const refuse = useCallback(
    (reason: string) => {
      onToast(reason);
      synth.uiError();
    },
    [onToast],
  );

  /** Commits a structural change made on the view; refuses with a reason if it can't be shown or run. */
  const commitStructure = useCallback(
    (g: MechanicGraph, v: ScratchView, sound: 'drop' | 'unplug' = 'drop') => {
      const r = commitView(g, v);
      if (!r.ok) return refuse(r.reason);
      commit(r.graph, sound);
    },
    [commit, refuse],
  );

  const toWs = useCallback(
    (cx: number, cy: number): LayoutPoint => {
      const r = ws.current!.getBoundingClientRect();
      return { x: Math.round((cx - r.left - pan.x) / zoom), y: Math.round((cy - r.top - pan.y) / zoom) };
    },
    [pan, zoom],
  );

  const visibleCenter = useCallback((): LayoutPoint => {
    const r = ws.current?.getBoundingClientRect();
    if (!r) return { x: 80, y: 80 };
    const c = toWs(r.left + r.width * 0.35, r.top + r.height * 0.3);
    const jitter = (graph.nodes.length % 6) * 18;
    return { x: c.x + jitter, y: c.y + jitter };
  }, [toWs, graph.nodes.length]);

  // ---------------------------------------------------------------- drag lifecycle

  const begin = useCallback(
    (p: Pending, x: number, y: number) => {
      const g = latest.current;
      const v = toScratch(g);
      if (!v.ok) return;
      let d: Drag | null = null;
      const base = { dx: p.dx, dy: p.dy, x, y, zones: null, hover: null, overPalette: false };
      const src = p.src;
      if (src.kind === 'block') {
        const det = detach(v.view, src.node);
        if (!det) return;
        const root = det.fragment.kind === 'script' ? det.fragment.top.top : det.fragment.blocks[0].node;
        d = { carry: { kind: 'exec', fragment: det.fragment, root }, graph: g, view: det.view, fresh: false, ...base };
      } else if (src.kind === 'reporter') {
        const g2 = src.edge ? unplug(g, src.edge.to, src.edge.toPort) : g;
        const v2 = { ...v.view, looseReporters: v.view.looseReporters.filter((r) => r !== src.node) };
        d = { carry: { kind: 'reporter', node: src.node, port: src.port }, graph: g2, view: v2, fresh: false, ...base };
      } else if (src.kind === 'ref') {
        const g2 = src.edge ? unplug(g, src.edge.to, src.edge.toPort) : g;
        d = { carry: { kind: 'ref', node: src.node, port: src.port }, graph: g2, view: v.view, fresh: !src.edge, ...base };
      } else {
        const def = getPrimitive(src.type);
        if (!def || partLocked(src.type, rules)) return;
        const { graph: g2, id } = addNode(g, src.type);
        if (def.event) d = { carry: { kind: 'exec', fragment: { kind: 'script', top: { top: id, hat: true, body: [] } }, root: id }, graph: g2, view: v.view, fresh: true, ...base };
        else if (def.execIn) d = { carry: { kind: 'exec', fragment: { kind: 'stack', blocks: [{ node: id, mouths: {} }] }, root: id }, graph: g2, view: v.view, fresh: true, ...base };
        else d = { carry: { kind: 'reporter', node: id, port: reporterPort(g2, id) }, graph: g2, view: v.view, fresh: true, ...base };
      }
      setMenu(null);
      setDrag(d);
    },
    [rules],
  );

  // Collect drop zones once the workspace has re-rendered without the carried blocks.
  useLayoutEffect(() => {
    if (!drag || drag.zones || !ws.current) return;
    const zones: Zone[] = [];
    const root = ws.current;
    root.querySelectorAll<HTMLElement>('[data-sb-after]').forEach((el) => {
      const r = el.getBoundingClientRect();
      zones.push({ kind: 'after', node: el.dataset.sbAfter!, x: r.left, y: r.bottom });
    });
    root.querySelectorAll<HTMLElement>('[data-sb-mouth]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const [node, port] = el.dataset.sbMouth!.split('|');
      zones.push({ kind: 'mouth', node, port, x: r.left, y: r.top });
    });
    root.querySelectorAll<HTMLElement>('[data-sb-top][data-sb-hat="0"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      zones.push({ kind: 'above', top: el.dataset.sbTop!, x: r.left, y: r.top });
    });
    root.querySelectorAll<HTMLElement>('[data-sb-slot]').forEach((el) => {
      const [node, port, type] = el.dataset.sbSlot!.split('|');
      zones.push({ kind: 'slot', node, port, type: type as PortType, rect: el.getBoundingClientRect() });
    });
    setDrag({ ...drag, zones });
  }, [drag]);

  const tryDrop = useCallback(
    (d: Drag, zone: Zone): Hover => {
      if (d.carry.kind === 'exec') {
        if (zone.kind === 'slot') return { zone, ok: false, reason: 'Stack blocks go in stacks; only reporters fit in slots.' };
        const target: DropTarget = zone.kind === 'after' ? { kind: 'after', node: zone.node } : zone.kind === 'mouth' ? { kind: 'mouth', node: zone.node, port: zone.port } : { kind: 'above', top: zone.top };
        const ins = insert(d.graph, d.view, d.carry.fragment, target);
        if (!ins.ok) return { zone, ok: false, reason: ins.reason };
        let g = d.graph;
        if (zone.kind === 'above') {
          const old = d.graph.layout.scratch[zone.top];
          const h = (ghostRef.current?.getBoundingClientRect().height ?? 40) / zoom;
          if (old) g = setLayout(g, 'scratch', { [d.carry.root]: { x: old.x, y: Math.round(old.y - h + 4) } });
        }
        const r = commitView(g, ins.view);
        return r.ok ? { zone, ok: true, graph: r.graph } : { zone, ok: false, reason: r.reason };
      }
      if (zone.kind !== 'slot') return { zone, ok: false, reason: 'Reporters go into input slots.' };
      const r = plug(d.graph, d.carry.node, d.carry.port, zone.node, zone.port);
      if (!r.ok) return { zone, ok: false, reason: r.reason };
      let g = r.graph;
      if (r.displaced.length) {
        // The reporter that was there is not deleted: it pops out next to the slot.
        const at = toWs(zone.rect.left, zone.rect.bottom + 12);
        g = setLayout(g, 'scratch', Object.fromEntries(r.displaced.map((id, i) => [id, { x: at.x + i * 16, y: at.y + i * 16 }])));
      }
      return { zone, ok: true, graph: g };
    },
    [toWs, zoom],
  );

  const findHover = useCallback(
    (d: Drag): Hover | null => {
      if (!d.zones) return null;
      const gx = d.x - d.dx;
      const gy = d.y - d.dy;
      const gh = ghostRef.current?.getBoundingClientRect().height ?? 40;
      let best: Zone | null = null;
      let bestD = Infinity;
      if (d.carry.kind === 'exec') {
        const script = d.carry.fragment.kind === 'script';
        for (const z of d.zones) {
          if (z.kind === 'slot') continue;
          if (script && z.kind !== 'above') continue;
          const dist = z.kind === 'above' ? Math.hypot(gx - z.x, gy + gh - z.y) : Math.hypot(gx - z.x, gy - z.y);
          if (dist < SNAP * Math.max(zoom, 0.6) && dist < bestD) {
            best = z;
            bestD = dist;
          }
        }
      } else {
        const px = gx + 8;
        const py = gy + gh / 2;
        for (const z of d.zones) {
          if (z.kind !== 'slot') continue;
          const r = z.rect;
          if (px < r.left - 8 || px > r.right + 8 || py < r.top - 8 || py > r.bottom + 8) continue;
          const area = r.width * r.height;
          if (area < bestD) {
            best = z;
            bestD = area;
          }
        }
      }
      if (!best) return null;
      const prev = d.hover?.zone;
      if (prev && JSON.stringify(prev) === JSON.stringify(best)) return d.hover;
      return tryDrop(d, best);
    },
    [tryDrop, zoom],
  );

  const finish = useCallback(
    (d: Drag, x: number, y: number) => {
      setDrag(null);
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const overPalette = !!el?.closest('[data-sb-palette]');
      const overWs = !!el?.closest('.sb-ws');
      const c = d.carry;
      if (overPalette) {
        if (d.fresh) return;
        if (c.kind === 'exec') {
          const removed = c.fragment.kind === 'script' ? [c.fragment.top.top, ...blocksIn(c.fragment.top.body)] : blocksIn(c.fragment.blocks);
          const del = deleteWithReporters(d.graph, removed);
          return commitStructure(del.graph, d.view, 'unplug');
        }
        if (c.kind === 'reporter') return commit(deleteWithReporters(d.graph, [c.node]).graph, 'unplug');
        return commit(d.graph, 'unplug');
      }
      const hover = d.hover;
      if (hover) {
        if (!hover.ok) return refuse(hover.reason ?? 'That does not fit there.');
        return commit(hover.graph!, c.kind === 'exec' ? 'drop' : 'plug');
      }
      if (!overWs) return;
      const at = toWs(x - d.dx, y - d.dy);
      if (c.kind === 'exec') {
        const ins = insert(d.graph, d.view, c.fragment, { kind: 'loose' });
        if (!ins.ok) return refuse(ins.reason);
        return commitStructure(setLayout(d.graph, 'scratch', { [c.root]: at }), ins.view);
      }
      if (c.kind === 'reporter') return commit(setLayout(d.graph, 'scratch', { [c.node]: at }), d.fresh ? 'drop' : 'unplug');
      if (!d.fresh) commit(d.graph, 'unplug');
    },
    [commit, commitStructure, refuse, toWs],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (panning.current) {
        const p = panning.current;
        setPan({ x: p.px + e.clientX - p.x0, y: p.py + e.clientY - p.y0 });
        return;
      }
      const d = dragRef.current;
      if (d) {
        const next = { ...d, x: e.clientX, y: e.clientY };
        next.hover = findHover(next);
        setDrag(next);
        return;
      }
      const p = pending.current;
      if (p && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 4) {
        pending.current = null;
        begin(p, e.clientX, e.clientY);
      }
    };
    const up = (e: PointerEvent) => {
      panning.current = null;
      const d = dragRef.current;
      if (d) {
        finish(d, e.clientX, e.clientY);
        return;
      }
      const p = pending.current;
      pending.current = null;
      if (p) {
        if (p.src.kind === 'palette') addNodeRef.current?.(p.src.type);
        else if (p.src.kind !== 'ref') onSelect(p.src.node);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [begin, finish, findHover, onSelect]);

  const startDrag = useCallback((e: React.PointerEvent, src: DragSource) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('input,select,button,textarea,[data-sb-nodrag]')) return;
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pending.current = { src, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top };
  }, []);

  // ---------------------------------------------------------------- actions on blocks

  const deleteBlock = useCallback(
    (id: string) => {
      const g = latest.current;
      const v = toScratch(g);
      const n = g.nodes.find((x) => x.id === id);
      if (!n || !v.ok) return;
      if (isPureNode(n)) {
        commit(deleteWithReporters(g, [id]).graph, 'unplug');
        onSelect(null);
        return;
      }
      const r = removeBlock(g, v.view, id);
      if ('error' in r) return refuse(r.error);
      let g2 = deleteWithReporters(g, r.removed).graph;
      // A removed hat leaves its blocks as a loose stack where the hat was.
      const top = r.view.tops.find((t) => !g2.layout.scratch[t.top]);
      const at = g.layout.scratch[id];
      if (top && at) g2 = setLayout(g2, 'scratch', { [top.top]: { x: at.x, y: at.y + 40 } });
      commitStructure(g2, r.view, 'unplug');
      onSelect(null);
    },
    [commit, commitStructure, onSelect, refuse],
  );

  const duplicate = useCallback(
    (id: string) => {
      const g = latest.current;
      const v = toScratch(g);
      if (!v.ok) return;
      const r = duplicateFrom(g, v.view, id);
      if (!r) return;
      commit(r.graph);
      onSelect(r.top);
    },
    [commit, onSelect],
  );

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      const g = latest.current;
      const def = getPrimitive(g.nodes.find((n) => n.id === id)?.type ?? '');
      if (def?.event) {
        const next = moveHandler(g, id, dir);
        if (next !== g) commit(next, 'click');
        return;
      }
      const v = toScratch(g);
      if (!v.ok) return;
      const r = moveInStack(g, v.view, id, dir);
      if (!r.ok) return refuse(r.reason);
      commitStructure(g, r.view);
    },
    [commit, commitStructure, refuse],
  );

  const toggleFail = useCallback((id: string) => {
    setFailOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const addNodeAt = useCallback(
    (type: string) => {
      const def = getPrimitive(type);
      if (!def || partLocked(type, rules)) return;
      const g = latest.current;
      const v = toScratch(g);
      if (!v.ok) return;
      const at = visibleCenter();
      const { graph: g2, id } = addNode(g, type, { at: { editor: 'scratch', pos: at } });
      if (def.execIn && selected && g.nodes.some((n) => n.id === selected && !isPureNode(n))) {
        const ins = insert(g2, v.view, { kind: 'stack', blocks: [{ node: id, mouths: {} }] }, { kind: 'after', node: selected });
        if (ins.ok) {
          const r = commitView(g2, ins.view);
          if (r.ok) {
            commit(r.graph);
            onSelect(id);
            return;
          }
        }
      }
      commit(g2);
      onSelect(id);
    },
    [commit, onSelect, rules, selected, visibleCenter],
  );
  const addNodeRef = useRef(addNodeAt);
  addNodeRef.current = addNodeAt;

  const focusNode = useCallback(
    (id: string) => {
      onSelect(id);
      requestAnimationFrame(() => {
        const el = ws.current?.querySelector<HTMLElement>(`[data-sb-node="${id}"]`);
        const box = ws.current?.getBoundingClientRect();
        if (!el || !box) return;
        const r = el.getBoundingClientRect();
        setPan((p) => ({ x: p.x + (box.left + box.width / 2 - (r.left + r.width / 2)), y: p.y + (box.top + box.height / 3 - r.top) }));
        el.focus({ preventScroll: true });
      });
    },
    [onSelect],
  );

  useImperativeHandle(ref, () => ({
    addNode: addNodeAt,
    focusNode,
    beginPaletteDrag(type: string, e: React.PointerEvent) {
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      pending.current = { src: { kind: 'palette', type }, x0: e.clientX, y0: e.clientY, dx: Math.min(30, e.clientX - r.left), dy: Math.min(16, e.clientY - r.top) };
    },
  }));

  // Keyboard: Delete, Ctrl+D duplicate, Alt+↑/↓ reorder, Escape.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (drag) setDrag(null);
        setMenu(null);
        return;
      }
      if (!selected) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        deleteBlock(selected);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate(selected);
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        move(selected, e.key === 'ArrowUp' ? -1 : 1);
        requestAnimationFrame(() => ws.current?.querySelector<HTMLElement>(`[data-sb-node="${selected}"]`)?.focus({ preventScroll: true }));
      } else if (e.key === 'F1' && onHelp) {
        e.preventDefault();
        const n = graph.nodes.find((x) => x.id === selected);
        if (n) onHelp(n.type);
      }
    },
    [deleteBlock, drag, duplicate, graph.nodes, move, onHelp, selected],
  );

  // ---------------------------------------------------------------- render

  const rendered = drag ? drag.graph : graph;
  const renderedView = drag ? drag.view : view;
  const idx = useMemo(() => edgeIndex(rendered), [rendered]);
  const names = useMemo(() => namesIn(graph), [graph]);
  const api: SbApi = {
    graph: rendered,
    inEdge: idx.inEdge,
    outCount: idx.outCount,
    issues,
    trace,
    selected,
    failOpen,
    recent,
    inert: false,
    isLocked: (type) => partLocked(type, rules),
    setParam: (node, key, value: ParamValue) => commit(setParam(latest.current, node, key, value), 'click'),
    setEdgePort: (edgeId, port) => commit({ ...latest.current, edges: latest.current.edges.map((e) => (e.id === edgeId ? { ...e, fromPort: port } : e)) }, 'click'),
    startDrag,
    select: (id) => onSelect(id),
    menu: (e, id) => {
      e.preventDefault();
      onSelect(id);
      setMenu({ x: e.clientX, y: e.clientY, node: id });
    },
    moveHandler: (id, dir) => move(id, dir),
    rank: (id) => handlerRank(graph, id),
    names,
  };
  const ghostApi: SbApi = { ...api, inert: true, selected: null, recent: new Set() };

  if (!view) {
    return (
      <div className="sb-ws sb-incompatible" role="alert">
        <div className="sb-incompat-card">
          <h3>This mechanic can’t be shown as Scratch Blocks</h3>
          <p>Nothing has been changed — it is exactly as you left it in Blueprint Blocks, and it still runs. Stacked blocks can’t express:</p>
          <ul>
            {!conv.ok && conv.problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          <button className="btn go" onClick={onSwitchToBlueprint}>
            Back to Blueprint Blocks
          </button>
        </div>
      </div>
    );
  }

  const pos = (id: string): LayoutPoint => rendered.layout.scratch[id] ?? graph.layout.scratch[id] ?? { x: 40, y: 40 };
  const menuNode = menu ? graph.nodes.find((n) => n.id === menu.node) : undefined;
  const menuDef = menuNode && getPrimitive(menuNode.type);
  const menuSpec = menuDef ? presentationOf(menuDef.type).scratch : null;
  const optional = menuSpec?.optionalMouths ?? [];
  const menuRank = menu ? handlerRank(graph, menu.node) : null;

  return (
    <SbContext.Provider value={api}>
      <div
        className={`sb-ws ${drag ? 'dragging' : ''}`}
        ref={ws}
        tabIndex={-1}
        aria-label="Scratch Blocks workspace"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('sb-canvas')) return;
          setMenu(null);
          onSelect(null);
          panning.current = { x0: e.clientX, y0: e.clientY, px: pan.x, py: pan.y };
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            const r = ws.current!.getBoundingClientRect();
            const nz = Math.min(2, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
            const mx = e.clientX - r.left;
            const my = e.clientY - r.top;
            setPan((p) => ({ x: mx - ((mx - p.x) * nz) / zoom, y: my - ((my - p.y) * nz) / zoom }));
            setZoom(nz);
          } else setPan((p) => ({ x: p.x - (e.shiftKey ? e.deltaY : e.deltaX), y: p.y - (e.shiftKey ? 0 : e.deltaY) }));
        }}
      >
        <div className="sb-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {renderedView!.tops.map((t) => (
            <Script key={t.top} top={t} pos={pos(t.top)} />
          ))}
          {renderedView!.looseReporters.map((id) => (
            <div key={id} className="sb-loose" style={{ left: pos(id).x, top: pos(id).y }}>
              <Reporter id={id} port={reporterPort(rendered, id)} />
            </div>
          ))}
        </div>
        {graph.nodes.length === 0 && (
          <div className="sb-empty">
            <p>Every script starts with a hat block.</p>
            <p>
              Drag <b>when F key pressed</b> from the palette, then snap a block like <b>try to push me</b> underneath it. Close the workbench to try it.
            </p>
          </div>
        )}
        <div className="sb-zoom" data-sb-nodrag>
          <button type="button" className="btn small quiet" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z / 1.15))}>
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn small quiet" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, z * 1.15))}>
            +
          </button>
          <button
            type="button"
            className="btn small quiet"
            title="Line all scripts up in a column (undoable)"
            onClick={() => {
              commit(autoPlace({ ...graph, layout: { ...graph.layout, scratch: {} } }, view));
              setPan({ x: 0, y: 0 });
              setZoom(1);
            }}
          >
            Tidy up
          </button>
        </div>
      </div>

      {drag && (
        <>
          {drag.hover && <DropMarker hover={drag.hover} />}
          <div className="sb-ghost" ref={ghostRef} style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, transform: `scale(${zoom})` }}>
            <SbContext.Provider value={ghostApi}>
              <Ghost carry={drag.carry} graph={drag.graph} />
            </SbContext.Provider>
          </div>
        </>
      )}

      {menu && menuDef && (
        <ul className="sb-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <li role="menuitem">
            <button onClick={() => (duplicate(menu.node), setMenu(null))}>Duplicate{!menuDef.event && !isPureNode(menuNode!) ? ' (with blocks below)' : ''} <kbd>Ctrl D</kbd></button>
          </li>
          <li role="menuitem">
            <button onClick={() => (deleteBlock(menu.node), setMenu(null))}>
              Delete block <kbd>Del</kbd>
            </button>
          </li>
          {optional.length > 0 && (
            <li role="menuitem">
              <button onClick={() => (toggleFail(menu.node), setMenu(null))}>
                {failOpen.has(menu.node) ? 'Hide' : 'Show'} “{menuSpec!.mouths.find((m) => optional.includes(m.port))?.label}”
              </button>
            </li>
          )}
          {menuRank && (
            <>
              <li role="menuitem">
                <button disabled={menuRank.rank === 1} onClick={() => (move(menu.node, -1), setMenu(null))}>
                  Run earlier <kbd>Alt ↑</kbd>
                </button>
              </li>
              <li role="menuitem">
                <button disabled={menuRank.rank === menuRank.of} onClick={() => (move(menu.node, 1), setMenu(null))}>
                  Run later <kbd>Alt ↓</kbd>
                </button>
              </li>
            </>
          )}
          {onHelp && (
            <li role="menuitem">
              <button onClick={() => (onHelp(menuDef.type), setMenu(null))}>
                Help: {nodeTitle(menuDef, menuNode!.params)} <kbd>F1</kbd>
              </button>
            </li>
          )}
        </ul>
      )}
      {[...names].map(([k, list]) => (
        <datalist key={k} id={`sb-names-${k}`}>
          {list.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ))}
    </SbContext.Provider>
  );
});

function Ghost({ carry, graph }: { carry: Carry; graph: MechanicGraph }) {
  if (carry.kind === 'exec') {
    if (carry.fragment.kind === 'script')
      return (
        <div className="sb-script ghost">
          <Block b={{ node: carry.fragment.top.top, mouths: {} }} hat />
          <Stack blocks={carry.fragment.top.body} />
        </div>
      );
    return (
      <div className="sb-script ghost">
        <Stack blocks={carry.fragment.blocks} />
      </div>
    );
  }
  if (carry.kind === 'reporter') return <Reporter id={carry.node} port={carry.port} />;
  const n = graph.nodes.find((x) => x.id === carry.node);
  const def = n && getPrimitive(n.type);
  const out = def?.outputs?.find((o) => o.id === carry.port);
  return <span className={`sb-rep sb-ref shape-${out?.type ?? 'number'} cat-${def?.category ?? 'data'}`}>{out?.label ?? carry.port}</span>;
}

function DropMarker({ hover }: { hover: Hover }) {
  const z = hover.zone;
  if (z.kind === 'slot')
    return (
      <>
        <div className={`sb-drop-slot ${hover.ok ? 'ok' : 'bad'}`} style={{ left: z.rect.left - 3, top: z.rect.top - 3, width: z.rect.width + 6, height: z.rect.height + 6 }} />
        {!hover.ok && (
          <div className="sb-drop-why" style={{ left: z.rect.left, top: z.rect.bottom + 6 }} role="status">
            {hover.reason}
          </div>
        )}
      </>
    );
  return (
    <>
      <div className={`sb-drop-line ${hover.ok ? 'ok' : 'bad'}`} style={{ left: z.x, top: z.y - 3 }} />
      {!hover.ok && (
        <div className="sb-drop-why" style={{ left: z.x, top: z.y + 8 }} role="status">
          {hover.reason}
        </div>
      )}
    </>
  );
}
