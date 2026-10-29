import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { getPrimitive, nodeTitle } from '../../mechanics/registry';
import type { ParamValue, VecValue } from '../../mechanics/schema';
import type { ParamDef, PortDef } from '../../mechanics/types';
import { useEditor } from './editorContext';
import { NumField, TextField } from './fields';

export type ModuleNodeType = Node<{ type: string }, 'module'>;

function ParamControl({ nodeId, p, value }: { nodeId: string; p: ParamDef; value: ParamValue }) {
  const ed = useEditor();
  if (p.kind === 'key' || p.kind === 'enum') {
    return (
      <label className="param">
        <span>{p.label}</span>
        <select className="nodrag" value={String(value)} onChange={(e) => ed.setParam(nodeId, p.id, e.target.value)}>
          {p.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (p.kind === 'text')
    return (
      <label className="param">
        <span>{p.label}</span>
        <TextField label={p.label} value={String(value)} onCommit={(v) => ed.setParam(nodeId, p.id, v.trim())} />
      </label>
    );
  return (
    <label className="param">
      <span>{p.label}</span>
      <NumField label={p.label} value={Number(value)} onCommit={(v) => ed.setParam(nodeId, p.id, v)} />
    </label>
  );
}

function Literal({ nodeId, port, value }: { nodeId: string; port: PortDef; value: ParamValue | undefined }) {
  const ed = useEditor();
  const v = value ?? port.default;
  switch (port.type) {
    case 'number':
      return <NumField label={port.label} value={Number(v ?? 0)} step={port.step ?? (Math.abs(Number(v)) < 5 ? 0.1 : 10)} min={port.min} max={port.max} onCommit={(x) => ed.setParam(nodeId, port.id, x)} />;
    case 'boolean':
      return <input className="nodrag check" type="checkbox" aria-label={port.label} checked={v === true} onChange={(e) => ed.setParam(nodeId, port.id, e.target.checked)} />;
    case 'vector': {
      const vv = (typeof v === 'object' ? v : { x: 0, y: 0 }) as VecValue;
      return (
        <span className="vec">
          <NumField label={`${port.label} x`} value={vv.x} step={50} onCommit={(x) => ed.setParam(nodeId, port.id, { x, y: vv.y })} />
          <NumField label={`${port.label} y`} value={vv.y} step={50} onCommit={(y) => ed.setParam(nodeId, port.id, { x: vv.x, y })} />
        </span>
      );
    }
    case 'entity':
      return (
        <select className="nodrag" aria-label={port.label} value={String(v ?? 'self')} onChange={(e) => ed.setParam(nodeId, port.id, e.target.value)}>
          <option value="self">you</option>
          <option value="none">nobody</option>
        </select>
      );
    default:
      return null;
  }
}

function fmtFail(s: string): string {
  return s.length > 60 ? s.slice(0, 58) + '…' : s;
}

/** A mechanic block, drawn as a synth module: faceplate, screws, a tape label, jacks for every port. */
export const ModuleNode = memo(function ModuleNode({ id, selected }: NodeProps<ModuleNodeType>) {
  const ed = useEditor();
  const node = ed.nodeById(id);
  const def = node ? getPrimitive(node.type) : undefined;
  if (!node || !def) return <div className="mod mod-missing">Unknown block</div>;
  const issues = ed.issuesByNode.get(id) ?? [];
  const error = issues.find((i) => i.severity === 'error');
  const warning = issues.find((i) => i.severity === 'warning');
  const trace = ed.trace?.get(id);
  const locked = ed.maxTier != null && def.tier > ed.maxTier;
  const execOuts = def.execOut ?? [];
  const inputs = def.inputs ?? [];
  const outputs = def.outputs ?? [];

  return (
    <div className={`mod cat-${def.category} ${selected ? 'sel' : ''} ${error ? 'has-error' : ''} ${locked ? 'locked' : ''}`} data-type={def.type}>
      <span className="screw tl" />
      <span className="screw tr" />
      <div className="mod-head">
        {def.execIn && (
          <div className="port-row exec-in">
            <Handle type="target" position={Position.Left} id="in" className="jack t-exec" />
          </div>
        )}
        <span className="tape" title={def.description}>
          {nodeTitle(def, node.params)}
        </span>
      </div>

      {(def.params?.length ?? 0) > 0 && (
        <div className="mod-params">
          {def.params!.map((p) => (
            <ParamControl key={p.id} nodeId={id} p={p} value={node.params[p.id] ?? p.default} />
          ))}
        </div>
      )}

      {(inputs.length > 0 || outputs.length > 0 || execOuts.length > 0) && (
        <div className="mod-ports">
          <div className="col in">
            {inputs.map((p) => {
              const wired = ed.connectedInputs.has(`${id}:${p.id}`);
              return (
                <div className="port-row" key={p.id}>
                  <Handle type="target" position={Position.Left} id={p.id} className={`jack t-${p.type}`} />
                  <span className="plabel">{p.label}</span>
                  {!wired && <Literal nodeId={id} port={p} value={node.params[p.id]} />}
                </div>
              );
            })}
          </div>
          <div className="col out">
            {execOuts.map((o) => (
              <div className="port-row" key={o.id}>
                <span className="plabel">{o.label}</span>
                <Handle type="source" position={Position.Right} id={o.id} className="jack t-exec" />
              </div>
            ))}
            {outputs.map((p) => (
              <div className="port-row" key={p.id}>
                <span className="plabel">{p.label}</span>
                <Handle type="source" position={Position.Right} id={p.id} className={`jack t-${p.type}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {def.cost && <div className="mod-cost">{def.cost}</div>}
      {trace && trace.count > 0 && (
        <div className={`mod-trace ${trace.lastFail && trace.lastFailTick === trace.lastTick ? 'bad' : ''}`}>
          <span>Ran {trace.count}×</span>
          {trace.fails > 0 && trace.lastFail && <span>Last failure: {fmtFail(trace.lastFail)}</span>}
        </div>
      )}
      {(error || warning) && <div className={`mod-issue ${error ? 'err' : 'warn'}`}>{(error ?? warning)!.message}</div>}
    </div>
  );
});
