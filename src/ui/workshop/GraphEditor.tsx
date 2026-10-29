import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
} from '@xyflow/react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { synth } from '../../audio/Synth';
import { compileGraph } from '../../mechanics/compile';
import { defaultParams, getPrimitive, inputPorts, outputPorts } from '../../mechanics/registry';
import type { NodeTrace } from '../../mechanics/runtime';
import { uid, type GraphEdge, type MechanicGraph, type ParamValue, type PortType } from '../../mechanics/schema';
import { checkConnection, type Issue, type ValidateOptions } from '../../mechanics/validate';
import { partLocked } from './editorContext';
import { CableConnectionLine, CableEdge, type CableEdgeType } from './CableEdge';
import { EditorContext, type EditorApi } from './editorContext';
import { ModuleNode, type ModuleNodeType } from './ModuleNode';
import { DRAG_MIME } from './PartsDrawer';

const nodeTypes = { module: ModuleNode };
const edgeTypes = { cable: CableEdge };

function portTypeOf(graph: MechanicGraph, nodeId: string, portId: string, side: 'out' | 'in'): PortType | undefined {
  const n = graph.nodes.find((x) => x.id === nodeId);
  const def = n && getPrimitive(n.type);
  if (!def) return undefined;
  return (side === 'out' ? outputPorts(def) : inputPorts(def)).find((p) => p.id === portId)?.type;
}

function toFlowEdges(g: MechanicGraph): CableEdgeType[] {
  return g.edges.map((e) => ({
    id: e.id,
    source: e.from,
    sourceHandle: e.fromPort,
    target: e.to,
    targetHandle: e.toPort,
    type: 'cable',
    data: { portType: portTypeOf(g, e.from, e.fromPort, 'out') ?? 'exec' },
  }));
}

function toFlowNodes(g: MechanicGraph, prev: ModuleNodeType[] = []): ModuleNodeType[] {
  const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
  return g.nodes.map((n) => ({ id: n.id, type: 'module', position: { x: n.x, y: n.y }, data: { type: n.type }, selected: sel.has(n.id) }));
}

export interface GraphEditorHandle {
  addNode(type: string): void;
  focusNode(id: string): void;
}

interface Props {
  graph: MechanicGraph;
  rules: ValidateOptions;
  trace: Map<string, NodeTrace> | undefined;
  onCommit: (g: MechanicGraph) => void;
  onToast: (msg: string) => void;
}

let clipboard: { nodes: MechanicGraph['nodes']; edges: GraphEdge[] } | null = null;

export const GraphEditor = forwardRef<GraphEditorHandle, Props>(function GraphEditor({ graph, rules, trace, onCommit, onToast }, ref) {
  const rf = useReactFlow<ModuleNodeType, CableEdgeType>();
  const [nodes, setNodes] = useState<ModuleNodeType[]>(() => toFlowNodes(graph));
  const [edges, setEdges] = useState<CableEdgeType[]>(() => toFlowEdges(graph));
  const synced = useRef(graph);
  const lastInvalid = useRef<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  // Re-sync when the graph changes from outside (undo/redo, switching mechanics).
  useEffect(() => {
    if (graph === synced.current) return;
    const switched = graph.id !== synced.current.id;
    synced.current = graph;
    setNodes((prev) => toFlowNodes(graph, switched ? [] : prev));
    setEdges(toFlowEdges(graph));
    if (switched) requestAnimationFrame(() => rf.fitView({ padding: 0.25, maxZoom: 1 }));
  }, [graph, rf]);

  const commit = useCallback(
    (next: MechanicGraph) => {
      const g = { ...next, updated: Date.now() };
      synced.current = g;
      onCommit(g);
    },
    [onCommit],
  );

  const compiled = useMemo(() => compileGraph(graph, rules), [graph, rules]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of compiled.issues) {
      if (!i.nodeId) continue;
      if (!m.has(i.nodeId)) m.set(i.nodeId, []);
      m.get(i.nodeId)!.push(i);
    }
    return m;
  }, [compiled]);
  const connectedInputs = useMemo(() => new Set(graph.edges.map((e) => `${e.to}:${e.toPort}`)), [graph]);

  const setParam = useCallback(
    (nodeId: string, key: string, value: ParamValue) => {
      const g = synced.current;
      commit({ ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, params: { ...n.params, [key]: value } } : n)) });
      synth.uiClick();
    },
    [commit],
  );

  const api: EditorApi = useMemo(
    () => ({
      graph,
      nodeById: (id: string) => graph.nodes.find((n) => n.id === id),
      connectedInputs,
      issuesByNode,
      trace,
      setParam,
      isLocked: (type: string) => partLocked(type, rules),
    }),
    [graph, connectedInputs, issuesByNode, trace, setParam, rules],
  );

  const addNodeAt = useCallback(
    (type: string, pos: { x: number; y: number }) => {
      const def = getPrimitive(type);
      if (!def) return;
      const g = synced.current;
      const id = uid('n');
      commit({ ...g, nodes: [...g.nodes, { id, type, x: Math.round(pos.x), y: Math.round(pos.y), params: defaultParams(def) }] });
      setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), { id, type: 'module', position: pos, data: { type }, selected: true }]);
      synth.uiDrop();
    },
    [commit],
  );

  useImperativeHandle(ref, () => ({
    addNode(type: string) {
      const box = wrapper.current?.getBoundingClientRect();
      const center = box ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
      const jitter = (synced.current.nodes.length % 5) * 24;
      addNodeAt(type, { x: center.x - 110 + jitter, y: center.y - 60 + jitter });
    },
    focusNode(id: string) {
      const n = rf.getNode(id);
      if (!n) return;
      setNodes((prev) => prev.map((x) => ({ ...x, selected: x.id === id })));
      rf.setCenter(n.position.x + 110, n.position.y + 60, { zoom: 1.1, duration: 300 });
    },
  }));

  const onNodesChange = useCallback((changes: NodeChange<ModuleNodeType>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<CableEdgeType>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);

  const onNodeDragStop = useCallback(() => {
    const g = synced.current;
    const pos = new Map(rf.getNodes().map((n) => [n.id, n.position]));
    let moved = false;
    const next = g.nodes.map((n) => {
      const p = pos.get(n.id);
      if (!p || (Math.round(p.x) === n.x && Math.round(p.y) === n.y)) return n;
      moved = true;
      return { ...n, x: Math.round(p.x), y: Math.round(p.y) };
    });
    if (moved) commit({ ...g, nodes: next });
  }, [commit, rf]);

  const onDelete = useCallback(
    ({ nodes: dn, edges: de }: { nodes: ModuleNodeType[]; edges: CableEdgeType[] }) => {
      const g = synced.current;
      const nodeIds = new Set(dn.map((n) => n.id));
      const edgeIds = new Set(de.map((e) => e.id));
      if (!nodeIds.size && !edgeIds.size) return;
      commit({
        ...g,
        nodes: g.nodes.filter((n) => !nodeIds.has(n.id)),
        edges: g.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.from) && !nodeIds.has(e.to)),
      });
      synth.uiUnplug();
    },
    [commit],
  );

  const reasonFor = useCallback((c: Connection | CableEdgeType): string | null => {
    const g = synced.current;
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return 'Plug an output into an input.';
    const a = g.nodes.find((n) => n.id === c.source);
    const b = g.nodes.find((n) => n.id === c.target);
    const da = a && getPrimitive(a.type);
    const db = b && getPrimitive(b.type);
    if (!da || !db) return 'Unknown block.';
    const from = outputPorts(da).find((p) => p.id === c.sourceHandle);
    const to = inputPorts(db).find((p) => p.id === c.targetHandle);
    const problem = checkConnection(from, to);
    if (problem) return problem;
    if (c.source === c.target && from?.type !== 'exec') return 'A block cannot feed its own input.';
    return null;
  }, []);

  const isValidConnection = useCallback(
    (c: Connection | CableEdgeType) => {
      const r = reasonFor(c);
      lastInvalid.current = r;
      return r === null;
    },
    [reasonFor],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (reasonFor(c)) return;
      const g = synced.current;
      const type = portTypeOf(g, c.source, c.sourceHandle!, 'out')!;
      // One cable per flow output and per value input: plugging in replaces what was there.
      const kept = g.edges.filter((e) =>
        type === 'exec' ? !(e.from === c.source && e.fromPort === c.sourceHandle) : !(e.to === c.target && e.toPort === c.targetHandle),
      );
      const edge: GraphEdge = { id: uid('e'), from: c.source, fromPort: c.sourceHandle!, to: c.target, toPort: c.targetHandle! };
      commit({ ...g, edges: [...kept, edge] });
      setEdges(toFlowEdges({ ...g, edges: [...kept, edge] }));
      synth.uiPlug();
    },
    [commit, reasonFor],
  );

  const onConnectEnd = useCallback(
    (_e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (!state.isValid && state.toHandle && lastInvalid.current) {
        onToast(lastInvalid.current);
        synth.uiError();
      }
      lastInvalid.current = null;
    },
    [onToast],
  );

  const onEdgeDoubleClick = useCallback(
    (_: React.MouseEvent, edge: CableEdgeType) => {
      onDelete({ nodes: [], edges: [edge] });
      setEdges((es) => es.filter((e) => e.id !== edge.id));
    },
    [onDelete],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const type = e.dataTransfer.getData(DRAG_MIME);
      if (!type) return;
      e.preventDefault();
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNodeAt(type, { x: pos.x - 100, y: pos.y - 24 });
    },
    [addNodeAt, rf],
  );

  // Copy / paste of selected blocks (with the cables between them).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) {
        const dn = rf.getNodes().filter((n) => n.selected);
        const de = rf.getEdges().filter((ed) => ed.selected);
        if (!dn.length && !de.length) return;
        e.preventDefault();
        const ids = new Set(dn.map((n) => n.id));
        onDelete({ nodes: dn, edges: de });
        setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
        setEdges((es) => es.filter((ed) => !ed.selected && !ids.has(ed.source) && !ids.has(ed.target)));
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'c' || k === 'd') {
        const sel = new Set(rf.getNodes().filter((n) => n.selected).map((n) => n.id));
        if (!sel.size) return;
        const g = synced.current;
        clipboard = { nodes: g.nodes.filter((n) => sel.has(n.id)), edges: g.edges.filter((ed) => sel.has(ed.from) && sel.has(ed.to)) };
        if (k === 'c') return;
        e.preventDefault();
      }
      if ((k === 'v' || k === 'd') && clipboard) {
        e.preventDefault();
        const g = synced.current;
        const map = new Map(clipboard.nodes.map((n) => [n.id, uid('n')]));
        const nn = clipboard.nodes.map((n) => ({ ...n, id: map.get(n.id)!, x: n.x + 40, y: n.y + 40, params: { ...n.params } }));
        const ne = clipboard.edges.map((ed) => ({ ...ed, id: uid('e'), from: map.get(ed.from)!, to: map.get(ed.to)! }));
        const next = { ...g, nodes: [...g.nodes, ...nn], edges: [...g.edges, ...ne] };
        commit(next);
        setNodes(toFlowNodes(next).map((n) => ({ ...n, selected: map.has(n.id) ? false : nn.some((x) => x.id === n.id) })));
        setEdges(toFlowEdges(next));
        synth.uiDrop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, rf, onDelete]);

  return (
    <EditorContext.Provider value={api}>
      <div className="mat" ref={wrapper} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow<ModuleNodeType, CableEdgeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onSelectionDragStop={onNodeDragStop}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onEdgeDoubleClick={onEdgeDoubleClick}
          isValidConnection={isValidConnection}
          connectionLineComponent={CableConnectionLine}
          deleteKeyCode={null}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          minZoom={0.25}
          maxZoom={2}
          snapToGrid
          snapGrid={[10, 10]}
          colorMode="dark"
        >
          <Background id="minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="#36553f" />
          <Background id="major" variant={BackgroundVariant.Lines} gap={120} lineWidth={2} color="#436a51" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
        {graph.nodes.length === 0 && (
          <div className="mat-empty">
            <p>Every mechanic starts with an event.</p>
            <p>
              Drag <b>On Key Pressed</b> onto the mat, then an action such as <b>Apply Impulse</b>, and plug the white jack of one into the other.
              Close the workbench to try it.
            </p>
          </div>
        )}
      </div>
    </EditorContext.Provider>
  );
});
