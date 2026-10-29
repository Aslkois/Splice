import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { synth } from '../../audio/Synth';
import { runner } from '../../game/bridge';
import { compileGraph } from '../../mechanics/compile';
import { toScratch } from '../../mechanics/scratch';
import type { MechanicGraph } from '../../mechanics/schema';
import type { EditorMode } from '../../persistence/storage';
import { LAB_BY_ID } from '../../sim/levels/labs';
import { rulesFor, useApp } from '../../store/store';
import { GraphEditor, type GraphEditorHandle } from './GraphEditor';
import { Inspector } from './Inspector';
import { Library } from './Library';
import { PartsDrawer } from './PartsDrawer';
import { TextField } from './fields';
import { ScratchEditor, type ScratchEditorHandle } from './scratch/ScratchEditor';
import { ScratchPalette } from './scratch/ScratchPalette';
import './workshop.css';

/** A switch between the two editors. Both edit the one mechanic; switching never changes it. */
function ModeSwitch({ mode, onChange }: { mode: EditorMode; onChange: (m: EditorMode) => void }) {
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Editor">
      {(['scratch', 'blueprint'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className={mode === m ? 'on' : ''}
          onClick={() => onChange(m)}
          title={m === 'scratch' ? 'Stacked blocks that snap together (Ctrl+1)' : 'Free nodes joined by wires (Ctrl+2)'}
        >
          {m === 'scratch' ? 'Scratch Blocks' : 'Blueprint Blocks'}
        </button>
      ))}
    </div>
  );
}

export function Workshop() {
  const library = useApp((s) => s.library);
  const selectedId = useApp((s) => s.selectedId);
  const mode = useApp((s) => s.mode);
  const progress = useApp((s) => s.progress);
  const history = useApp((s) => (selectedId ? s.history[selectedId] : undefined));
  const justUnlocked = useApp((s) => s.justUnlockedTier);
  const commitGraph = useApp((s) => s.commitGraph);
  const saveQuietly = useApp((s) => s.saveQuietly);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const close = useApp((s) => s.closeWorkshop);
  const rename = useApp((s) => s.renameMechanic);
  const create = useApp((s) => s.createMechanic);
  const editorMode = useApp((s) => s.settings.editorMode);
  const inspectorWidth = useApp((s) => s.settings.inspectorWidth);
  const setSettings = useApp((s) => s.setSettings);
  const openDocs = useApp((s) => s.openDocs);
  const trial = useApp((s) => s.trial);
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 1100);
  const graph = library.mechanics.find((m) => m.id === selectedId) ?? null;
  const blueprint = useRef<GraphEditorHandle>(null);
  const scratch = useRef<ScratchEditorHandle>(null);
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const [newTier] = useState(justUnlocked);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const levelId = useApp((s) => s.levelId);
  const rules = useMemo(() => rulesFor(mode, levelId, progress), [mode, levelId, progress]);
  const lab = mode === 'lab' ? LAB_BY_ID[levelId] : undefined;
  const equippedBlocks = library.equipped.reduce((n, id) => n + (library.mechanics.find((m) => m.id === id)?.nodes.length ?? 0), 0);
  const compiled = useMemo(() => (graph ? compileGraph(graph, rules) : null), [graph, rules]);
  const errors = compiled?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = compiled?.issues.filter((i) => i.severity === 'warning') ?? [];
  const equipped = graph ? library.equipped.includes(graph.id) : false;
  // The last playtest's execution trace, so you can see what ran and what failed.
  const trace = useMemo(() => (graph ? runner.attach?.host.traces.get(graph.id) : undefined), [graph]);
  // Blocks of this mechanic that ran in the last second of play before the Workshop opened.
  const recent = useMemo(() => {
    const out = new Set<string>();
    const log = runner.attach?.host.traceLog;
    const now = runner.world?.time ?? 0;
    if (!graph || !log) return out;
    for (const e of log.entries()) if (e.mechId === graph.id && e.nodeId && e.time >= now - 1) out.add(e.nodeId);
    return out;
  }, [graph?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSelectedNode(null), [selectedId]);

  const onToast = useCallback((msg: string) => setToast({ msg, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const switchMode = useCallback(
    (m: EditorMode) => {
      if (m === editorMode) return;
      // A field still being typed in commits on blur — before the other editor takes over.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setSettings({ editorMode: m });
      synth.uiClick();
      if (m === 'scratch' && graph) {
        const r = toScratch(useApp.getState().library.mechanics.find((x) => x.id === graph.id) ?? graph);
        if (!r.ok) onToast('This mechanic can’t be drawn as stacked blocks — nothing was changed. The reasons are on the workspace.');
      }
    },
    [editorMode, graph, onToast, setSettings],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === 'F1') {
        e.preventDefault();
        const st = useApp.getState();
        const g = st.library.mechanics.find((m) => m.id === st.selectedId);
        const n = g?.nodes.find((x) => x.id === selectedNodeRef.current);
        openDocs(n ? { kind: 'block', type: n.type } : undefined);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '1' || e.key === '2') {
        e.preventDefault();
        switchMode(e.key === '1' ? 'scratch' : 'blueprint');
        return;
      }
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        synth.uiClick();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
        synth.uiClick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, switchMode, openDocs]);
  const selectedNodeRef = useRef<string | null>(null);
  selectedNodeRef.current = selectedNode;

  const onCommit = useCallback((g: MechanicGraph) => commitGraph(g), [commitGraph]);
  const onQuiet = useCallback((g: MechanicGraph) => saveQuietly(g), [saveQuietly]);
  const focusNode = (id: string) => (editorMode === 'scratch' ? scratch.current?.focusNode(id) : blueprint.current?.focusNode(id));
  const addNode = (type: string) => (editorMode === 'scratch' ? scratch.current?.addNode(type) : blueprint.current?.addNode(type));

  let status: { text: string; tone: 'ok' | 'warn' | 'err' };
  if (!graph) status = { text: 'Nothing selected', tone: 'warn' };
  else if (errors.length) status = { text: errors.length === 1 ? '1 problem stops it running' : `${errors.length} problems stop it running`, tone: 'err' };
  else if (!equipped) status = { text: 'Ready, but not plugged in', tone: 'warn' };
  else if (warnings.length) status = { text: warnings.length === 1 ? 'Runs, with 1 note' : `Runs, with ${warnings.length} notes`, tone: 'warn' };
  else status = { text: 'Ready', tone: 'ok' };

  return (
    <div className="workshop" role="dialog" aria-label="Workbench">
      <header className="ws-head">
        <div className="ws-title">
          {graph ? (
            <TextField className="tape-name" label="Mechanic name" value={graph.name} onCommit={(v) => rename(graph.id, v)} />
          ) : (
            <span className="tape-name">Workbench</span>
          )}
          <span className={`status ${status.tone}`} role="status">
            {status.text}
          </span>
          {lab && (
            <span className={`status ${equippedBlocks > lab.maxBlocks ? 'err' : 'ok'}`}>
              Lab budget: {equippedBlocks} of {lab.maxBlocks} blocks equipped
            </span>
          )}
        </div>
        <ModeSwitch mode={editorMode} onChange={switchMode} />
        <div className="ws-tools">
          <button className="btn small quiet" onClick={() => openDocs()} title="SPLICE Docs (F1)">
            Docs
          </button>
          <button className="btn small quiet" onClick={() => setInspectorOpen((o) => !o)} aria-pressed={inspectorOpen} title="Show or hide the inspector">
            Inspector
          </button>
          <button className="btn small quiet" onClick={undo} disabled={!history?.past.length} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="btn small quiet" onClick={redo} disabled={!history?.future.length} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button className="btn go" onClick={close} title="Close the workbench and play (Tab)">
            {trial ? 'Back to the testbench' : 'Test it'}
          </button>
        </div>
      </header>

      <aside className="ws-side">
        <Library />
        {editorMode === 'scratch' ? (
          <ScratchPalette rules={rules} newTier={newTier} onAdd={addNode} onDragStart={(t, e) => scratch.current?.beginPaletteDrag(t, e)} />
        ) : (
          <PartsDrawer rules={rules} newTier={newTier} onAdd={addNode} />
        )}
      </aside>

      <main className="ws-main">
        {graph ? (
          editorMode === 'scratch' ? (
            <ScratchEditor
              key={graph.id}
              ref={scratch}
              graph={graph}
              rules={rules}
              trace={trace}
              recent={recent}
              selected={selectedNode}
              onSelect={setSelectedNode}
              onCommit={onCommit}
              onQuietLayout={onQuiet}
              onToast={onToast}
              onSwitchToBlueprint={() => switchMode('blueprint')}
              onHelp={(type) => openDocs({ kind: 'block', type })}
            />
          ) : (
            <ReactFlowProvider key={graph.id}>
              <GraphEditor ref={blueprint} graph={graph} rules={rules} trace={trace} onCommit={onCommit} onToast={onToast} onSelect={setSelectedNode} />
            </ReactFlowProvider>
          )
        ) : (
          <div className="mat mat-empty-lib">
            <p>Your shelf is empty.</p>
            <button className="btn go" onClick={() => create()}>
              Start a new mechanic
            </button>
          </div>
        )}
        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="issues" aria-label="Problems">
            {[...errors, ...warnings].slice(0, 6).map((i, k) => (
              <li key={k} className={i.severity}>
                <button onClick={() => i.nodeId && focusNode(i.nodeId)} disabled={!i.nodeId}>
                  {i.message}
                </button>
              </li>
            ))}
          </ul>
        )}
        {toast && (
          <div className="toast" key={toast.key} role="alert">
            {toast.msg}
          </div>
        )}
      </main>
      {graph && inspectorOpen && (
        <Inspector
          graph={graph}
          selected={selectedNode}
          issues={compiled?.issues ?? []}
          trace={trace}
          onPick={focusNode}
          width={inspectorWidth}
          onResize={(w) => setSettings({ inspectorWidth: Math.round(w) })}
        />
      )}
    </div>
  );
}
