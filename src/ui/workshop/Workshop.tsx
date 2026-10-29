import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { synth } from '../../audio/Synth';
import { runner } from '../../game/bridge';
import { compileGraph } from '../../mechanics/compile';
import type { MechanicGraph } from '../../mechanics/schema';
import { unlockedTier } from '../../persistence/storage';
import { useApp } from '../../store/store';
import { GraphEditor, type GraphEditorHandle } from './GraphEditor';
import { Library } from './Library';
import { PartsDrawer } from './PartsDrawer';
import { TextField } from './fields';
import './workshop.css';

export function Workshop() {
  const library = useApp((s) => s.library);
  const selectedId = useApp((s) => s.selectedId);
  const mode = useApp((s) => s.mode);
  const progress = useApp((s) => s.progress);
  const history = useApp((s) => (selectedId ? s.history[selectedId] : undefined));
  const justUnlocked = useApp((s) => s.justUnlockedTier);
  const commitGraph = useApp((s) => s.commitGraph);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const close = useApp((s) => s.closeWorkshop);
  const rename = useApp((s) => s.renameMechanic);
  const create = useApp((s) => s.createMechanic);
  const graph = library.mechanics.find((m) => m.id === selectedId) ?? null;
  const editor = useRef<GraphEditorHandle>(null);
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const [newTier] = useState(justUnlocked);

  const maxTier = mode === 'sandbox' ? undefined : unlockedTier(progress);
  const compiled = useMemo(() => (graph ? compileGraph(graph, { maxTier }) : null), [graph, maxTier]);
  const errors = compiled?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = compiled?.issues.filter((i) => i.severity === 'warning') ?? [];
  const equipped = graph ? library.equipped.includes(graph.id) : false;
  // The last playtest's execution trace, so you can see what ran and what failed.
  const trace = useMemo(() => (graph ? runner.attach?.host.traces.get(graph.id) : undefined), [graph]);

  const onToast = useCallback((msg: string) => setToast({ msg, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (!(e.ctrlKey || e.metaKey)) return;
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
  }, [undo, redo]);

  const onCommit = useCallback((g: MechanicGraph) => commitGraph(g), [commitGraph]);

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
        </div>
        <div className="ws-tools">
          <button className="btn small quiet" onClick={undo} disabled={!history?.past.length} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="btn small quiet" onClick={redo} disabled={!history?.future.length} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button className="btn go" onClick={close} title="Close the workbench and play (Tab)">
            Test it
          </button>
        </div>
      </header>

      <aside className="ws-side">
        <Library />
        <PartsDrawer maxTier={maxTier} newTier={newTier} onAdd={(t) => editor.current?.addNode(t)} />
      </aside>

      <main className="ws-main">
        {graph ? (
          <ReactFlowProvider key={graph.id}>
            <GraphEditor ref={editor} graph={graph} maxTier={maxTier} trace={trace} onCommit={onCommit} onToast={onToast} />
          </ReactFlowProvider>
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
                <button onClick={() => i.nodeId && editor.current?.focusNode(i.nodeId)} disabled={!i.nodeId}>
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
    </div>
  );
}
