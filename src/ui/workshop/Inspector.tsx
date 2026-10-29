import { useEffect, useMemo, useState } from 'react';
import { livePlayerState } from '../../game/inspect';
import { BLOCK_DOCS } from '../../docs/blockDocs';
import { inspectCost, REST_STATE } from '../../mechanics/costInspector';
import { explainMechanic } from '../../mechanics/explain';
import { getPrimitive, nodeTitle } from '../../mechanics/registry';
import type { NodeTrace } from '../../mechanics/runtime';
import type { MechanicGraph } from '../../mechanics/schema';
import type { Issue } from '../../mechanics/validate';
import { useApp } from '../../store/store';
import { DebuggerPanel } from '../debugger/DebuggerPanel';
import { BlockPreview } from './scratch/ScratchPalette';

type Tab = 'block' | 'explain' | 'debug';

function BlockTab({ graph, nodeId, issues, trace }: { graph: MechanicGraph; nodeId: string | null; issues: Issue[]; trace: Map<string, NodeTrace> | undefined }) {
  const openDocs = useApp((s) => s.openDocs);
  const node = nodeId ? graph.nodes.find((n) => n.id === nodeId) : undefined;
  const def = node && getPrimitive(node.type);
  // Live: your state at the moment the game was paused for the Workshop.
  const state = useMemo(() => livePlayerState(), [graph, nodeId]);
  const cost = useMemo(() => (node ? inspectCost(graph, node.id, state ?? REST_STATE) : null), [graph, node, state]);
  if (!node || !def) {
    return (
      <div className="insp-empty">
        <p>Select a block to see what it does, what it costs and whether it could run right now.</p>
        <p>
          <button type="button" className="doc-link" onClick={() => openDocs({ kind: 'article', id: 'start' })}>
            Getting started
          </button>{' '}
          ·{' '}
          <button type="button" className="doc-link" onClick={() => openDocs({ kind: 'examples' })}>
            Examples
          </button>
        </p>
      </div>
    );
  }
  const doc = BLOCK_DOCS[def.type];
  const mine = issues.filter((i) => i.nodeId === node.id);
  const t = trace?.get(node.id);
  return (
    <div className="insp-block">
      <div className="insp-preview">
        <BlockPreview type={def.type} />
      </div>
      <h3>{nodeTitle(def, node.params)}</h3>
      <p className="insp-summary">{doc?.summary ?? def.description}</p>
      <p className="insp-when">
        <strong>Runs:</strong> {doc?.when}
      </p>
      {mine.map((i, k) => (
        <p key={k} className={`insp-issue ${i.severity}`}>
          {i.message}
        </p>
      ))}
      {cost && (
        <section className="insp-cost" aria-label="Cost">
          <h4>{cost.heading}</h4>
          <dl>
            {cost.lines.map((l, i) => (
              <div key={i} className={l.tone ?? ''}>
                <dt>{l.label}</dt>
                <dd>{l.value}</dd>
              </div>
            ))}
          </dl>
          <p className={`insp-status ${cost.status.tone}`} role="status">
            {cost.status.text}
          </p>
          {cost.notes.map((n, i) => (
            <p key={i} className="insp-note">
              {n}
            </p>
          ))}
          <p className="insp-note">{state ? 'Using your state when you opened the Workshop.' : 'No world running: assuming you stand still with a full reservoir.'}</p>
        </section>
      )}
      {t && t.count > 0 && (
        <p className="insp-ran">
          Ran {t.count}× in this playtest{t.fails ? `, failed ${t.fails}× (last: ${t.lastFail})` : ''}.
        </p>
      )}
      <button type="button" className="btn small" onClick={() => openDocs({ kind: 'block', type: def.type })}>
        Full reference <kbd>F1</kbd>
      </button>
    </div>
  );
}

function ExplainTab({ graph, onPick }: { graph: MechanicGraph; onPick: (id: string) => void }) {
  const lines = useMemo(() => explainMechanic(graph), [graph]);
  return (
    <div className="insp-explain">
      <p className="insp-note">Read straight off the blocks the engine will run — nothing is guessed.</p>
      <ol className="explain">
        {lines.map((l, i) => (
          <li key={i} className={l.tone ?? ''} style={{ paddingLeft: `${l.depth * 16 + 6}px` }}>
            {l.node ? (
              <button type="button" onClick={() => onPick(l.node!)}>
                {l.text}
              </button>
            ) : (
              l.text
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Inspector({
  graph,
  selected,
  issues,
  trace,
  onPick,
  width,
  onResize,
}: {
  graph: MechanicGraph;
  selected: string | null;
  issues: Issue[];
  trace: Map<string, NodeTrace> | undefined;
  onPick: (id: string) => void;
  width: number;
  onResize: (w: number) => void;
}) {
  const [tab, setTab] = useState<Tab>('block');
  const [drag, setDrag] = useState<{ x0: number; w0: number } | null>(null);
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => onResize(Math.min(720, Math.max(260, drag.w0 + (drag.x0 - e.clientX))));
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, onResize]);
  useEffect(() => {
    if (selected) setTab((t) => (t === 'debug' ? t : 'block'));
  }, [selected]);
  return (
    <aside className="ws-insp" style={{ width }} aria-label="Inspector">
      <div
        className="insp-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuenow={width}
        aria-valuemin={260}
        aria-valuemax={720}
        tabIndex={0}
        onPointerDown={(e) => setDrag({ x0: e.clientX, w0: width })}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onResize(Math.min(720, width + 20));
          if (e.key === 'ArrowRight') onResize(Math.max(260, width - 20));
        }}
      />
      <div className="insp-tabs" role="tablist">
        {(
          [
            ['block', 'Block'],
            ['explain', 'Explain'],
            ['debug', 'Debugger'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="insp-body">
        {tab === 'block' && <BlockTab graph={graph} nodeId={selected} issues={issues} trace={trace} />}
        {tab === 'explain' && <ExplainTab graph={graph} onPick={onPick} />}
        {tab === 'debug' && <DebuggerPanel mechId={graph.id} onPick={(e) => e.nodeId && e.mechId === graph.id && onPick(e.nodeId)} />}
      </div>
    </aside>
  );
}
