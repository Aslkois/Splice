import { Fragment, useEffect, useState } from 'react';
import { parseTemplate, presentationOf, type TemplatePart } from '../../../mechanics/presentation';
import { getPrimitive, nodeTitle } from '../../../mechanics/registry';
import type { SBlock, STop } from '../../../mechanics/scratch';
import type { GraphEdge, GraphNode, LayoutPoint, ParamValue, PortType, VecValue } from '../../../mechanics/schema';
import type { ParamDef, PortDef, PrimitiveDef } from '../../../mechanics/types';
import { useSb } from './sbContext';

const ORD = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** Inputs inside blocks: commit on blur or Enter, so typing doesn't flood the undo history. */
function SbNum({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v)) return setText(String(value));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      className="sb-num"
      inputMode="decimal"
      aria-label={label}
      value={text}
      size={Math.max(2, text.length)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

function SbText({ value, onCommit, label, list }: { value: string; onCommit: (v: string) => void; label: string; list?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="sb-text"
      aria-label={label}
      value={text}
      list={list}
      maxLength={40}
      size={Math.max(3, text.length)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text.trim() ? text.trim() !== value && onCommit(text.trim()) : setText(value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

function ParamField({ node, p }: { node: GraphNode; p: ParamDef }) {
  const sb = useSb();
  const value = node.params[p.id] ?? p.default;
  if (sb.inert) {
    const label = p.options?.find((o) => o.value === value)?.label ?? String(value);
    return <span className={p.kind === 'text' ? 'sb-text static' : 'sb-dd static'}>{label}</span>;
  }
  if (p.kind === 'key' || p.kind === 'enum')
    return (
      <select className="sb-dd" aria-label={p.label} value={String(value)} onChange={(e) => sb.setParam(node.id, p.id, e.target.value)}>
        {p.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (p.kind === 'text') {
    const listId = sb.names.has(p.id) ? `sb-names-${p.id}` : undefined;
    return <SbText label={p.label} value={String(value)} list={listId} onCommit={(v) => sb.setParam(node.id, p.id, v)} />;
  }
  return <SbNum label={p.label} value={Number(value)} onCommit={(v) => sb.setParam(node.id, p.id, v)} />;
}

/** What an empty input slot shows: an editable literal, shaped like what fits there. */
function Literal({ node, port }: { node: GraphNode; port: PortDef }) {
  const sb = useSb();
  const raw: ParamValue | undefined = node.params[port.id] ?? port.default;
  const set = (v: ParamValue) => sb.setParam(node.id, port.id, v);
  if (sb.inert) {
    const txt =
      port.type === 'vector'
        ? `${(raw as VecValue | undefined)?.x ?? 0}, ${(raw as VecValue | undefined)?.y ?? 0}`
        : port.type === 'entity'
          ? raw === 'none'
            ? 'nobody'
            : 'me'
          : String(raw ?? (port.type === 'boolean' ? false : 0));
    return <span className="sb-lit static">{txt}</span>;
  }
  switch (port.type) {
    case 'number':
      return <SbNum label={port.label} value={Number(raw ?? 0)} onCommit={set} />;
    case 'boolean':
      return (
        <select className="sb-dd sb-bool" aria-label={port.label} value={raw === true ? 'true' : 'false'} onChange={(e) => set(e.target.value === 'true')}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      );
    case 'vector': {
      const v = (typeof raw === 'object' ? raw : { x: 0, y: 0 }) as VecValue;
      return (
        <span className="sb-vec">
          <SbNum label={`${port.label} x`} value={v.x} onCommit={(x) => set({ x, y: v.y })} />
          <span className="sb-w">,</span>
          <SbNum label={`${port.label} y`} value={v.y} onCommit={(y) => set({ x: v.x, y })} />
        </span>
      );
    }
    case 'entity':
      return (
        <select className="sb-dd" aria-label={port.label} value={String(raw ?? 'self')} onChange={(e) => set(e.target.value)}>
          <option value="self">me</option>
          <option value="none">nobody</option>
        </select>
      );
    default:
      return null;
  }
}

function Slot({ node, port }: { node: GraphNode; port: PortDef }) {
  const sb = useSb();
  const edge = sb.inEdge.get(`${node.id}:${port.id}`);
  const src = edge ? sb.graph.nodes.find((n) => n.id === edge.from) : undefined;
  const srcDef = src && getPrimitive(src.type);
  let content: React.ReactNode;
  if (edge && src && srcDef) content = srcDef.execIn || srcDef.event ? <RefPill src={src} def={srcDef} edge={edge} /> : <Reporter id={src.id} port={edge.fromPort} edge={edge} />;
  else content = <Literal node={node} port={port} />;
  return (
    <span className={`sb-slot t-${port.type} ${edge ? 'filled' : ''}`} data-sb-slot={`${node.id}|${port.id}|${port.type}`} title={port.label}>
      {content}
    </span>
  );
}

function Line({ node, def, pick }: { node: GraphNode; def: PrimitiveDef; pick?: { port: string; edge?: GraphEdge } }) {
  const sb = useSb();
  const parts = parseTemplate(presentationOf(def.type).scratch.text);
  const render = (part: TemplatePart, i: number) => {
    if (part.kind === 'text') return <span key={i} className="sb-w">{part.text.trim()}</span>;
    if (part.kind === 'param') {
      const p = def.params?.find((x) => x.id === part.id);
      return p ? <ParamField key={i} node={node} p={p} /> : null;
    }
    if (part.kind === 'input') {
      const p = def.inputs?.find((x) => x.id === part.id);
      return p ? <Slot key={i} node={node} port={p} /> : null;
    }
    // Which output this reporter presents (only Break Vector has more than one).
    const outs = def.outputs ?? [];
    const cur = pick?.port ?? outs[0]?.id;
    if (sb.inert || !pick?.edge) return <span key={i} className="sb-dd static">{outs.find((o) => o.id === cur)?.label ?? cur}</span>;
    const edge = pick.edge;
    return (
      <select
        key={i}
        className="sb-dd"
        aria-label="Output"
        value={cur}
        onChange={(e) => sb.setEdgePort(edge.id, e.target.value)}
      >
        {outs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };
  return <>{parts.map(render)}</>;
}

function typeOfOutput(def: PrimitiveDef, port: string): PortType {
  return def.outputs?.find((o) => o.id === port)?.type ?? 'number';
}

/** A value block plugged into a slot (or lying loose). */
export function Reporter({ id, port, edge }: { id: string; port: string; edge?: GraphEdge }) {
  const sb = useSb();
  const node = sb.graph.nodes.find((n) => n.id === id);
  const def = node && getPrimitive(node.type);
  if (!node || !def) return <span className="sb-rep missing">?</span>;
  const shared = sb.outCount.get(id) ?? 0;
  const issue = sb.issues.get(id)?.[0];
  return (
    <span
      className={`sb-rep shape-${typeOfOutput(def, port)} cat-${def.category} ${sb.selected === id ? 'sel' : ''} ${issue ? `has-${issue.severity}` : ''}`}
      data-sb-node={id}
      tabIndex={sb.inert ? -1 : 0}
      role="group"
      aria-label={nodeTitle(def, node.params)}
      title={issue?.message}
      onPointerDown={(e) => {
        e.stopPropagation();
        sb.startDrag(e, { kind: 'reporter', node: id, port, edge });
      }}
      onFocus={(e) => {
        e.stopPropagation();
        if (!sb.inert) sb.select(id);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        sb.menu(e, id);
      }}
    >
      <Line node={node} def={def} pick={{ port, edge }} />
      {shared > 1 && (
        <span className="sb-shared" title={`This reporter feeds ${shared} inputs. Changing it changes all of them.`}>
          ⛓{shared}
        </span>
      )}
    </span>
  );
}

/** A value produced by an event or action (e.g. the incoming hit's damage), plugged into a slot. */
function RefPill({ src, def, edge }: { src: GraphNode; def: PrimitiveDef; edge: GraphEdge }) {
  const sb = useSb();
  const out = def.outputs?.find((o) => o.id === edge.fromPort);
  return (
    <span
      className={`sb-rep sb-ref shape-${out?.type ?? 'number'} cat-${def.category}`}
      title={`${out?.label ?? edge.fromPort} — from ‘${nodeTitle(def, src.params)}’`}
      onPointerDown={(e) => {
        e.stopPropagation();
        sb.startDrag(e, { kind: 'ref', node: src.id, port: edge.fromPort, edge });
      }}
    >
      {out?.label ?? edge.fromPort}
    </span>
  );
}

/** Values an event or action hands out, as chips you drag into slots. */
function OutputChips({ node, def }: { node: GraphNode; def: PrimitiveDef }) {
  const sb = useSb();
  const outs = def.outputs ?? [];
  if (!outs.length) return null;
  return (
    <span className="sb-chips" aria-label="Values you can drag out">
      {outs.map((o) => (
        <span
          key={o.id}
          className={`sb-chip shape-${o.type}`}
          title={`Drag into a ${o.type} slot to use “${o.label}”`}
          onPointerDown={(e) => {
            e.stopPropagation();
            sb.startDrag(e, { kind: 'ref', node: node.id, port: o.id });
          }}
        >
          {o.label}
        </span>
      ))}
    </span>
  );
}

function Badges({ node }: { node: GraphNode }) {
  const sb = useSb();
  if (sb.inert) return null;
  const t = sb.trace?.get(node.id);
  const r = sb.rank(node.id);
  return (
    <>
      {r && (
        <span className="sb-rank" data-sb-nodrag title="Handlers of the same event run in this order">
          runs {ORD(r.rank)} of {r.of}
          <button type="button" aria-label="Run earlier" disabled={r.rank === 1} onClick={() => sb.moveHandler(node.id, -1)}>
            ▲
          </button>
          <button type="button" aria-label="Run later" disabled={r.rank === r.of} onClick={() => sb.moveHandler(node.id, 1)}>
            ▼
          </button>
        </span>
      )}
      {t && t.count > 0 && (
        <span className={`sb-ran ${t.fails > 0 && t.lastFailTick === t.lastTick ? 'bad' : ''}`} title={t.lastFail ? `Last failure: ${t.lastFail}` : 'Times this block ran in the last playtest'}>
          ×{t.count}
          {t.fails > 0 ? ' !' : ''}
        </span>
      )}
    </>
  );
}

export function Block({ b, hat = false }: { b: SBlock; hat?: boolean }) {
  const sb = useSb();
  const node = sb.graph.nodes.find((n) => n.id === b.node);
  const def = node && getPrimitive(node.type);
  if (!node || !def) return <div className="sb-block missing">Unknown block</div>;
  const spec = presentationOf(def.type).scratch;
  const mouths = spec.mouths.filter((m) => !spec.optionalMouths.includes(m.port) || (b.mouths[m.port]?.length ?? 0) > 0 || sb.failOpen.has(node.id));
  const issues = sb.issues.get(node.id) ?? [];
  const issue = issues.find((i) => i.severity === 'error') ?? issues[0];
  const continues = hat || spec.choice || !!spec.continuation;
  const kind = hat ? 'hat' : mouths.length ? 'c' : continues ? 'stack' : 'cap';
  const title = nodeTitle(def, node.params);
  return (
    <div
      className={`sb-block kind-${kind} cat-${def.category} ${sb.selected === node.id ? 'sel' : ''} ${issue ? `has-${issue.severity}` : ''} ${sb.isLocked(def.type) ? 'locked' : ''} ${sb.recent.has(node.id) ? 'recent' : ''}`}
      data-sb-node={node.id}
      data-sb-after={continues && !sb.inert ? node.id : undefined}
      tabIndex={sb.inert ? -1 : 0}
      role="group"
      aria-label={title}
      title={issue?.message}
      onPointerDown={(e) => sb.startDrag(e, { kind: 'block', node: node.id })}
      onFocus={(e) => {
        e.stopPropagation();
        if (!sb.inert) sb.select(node.id);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        sb.menu(e, node.id);
      }}
    >
      <div className="sb-row sb-head">
        <Line node={node} def={def} />
        <OutputChips node={node} def={def} />
        <Badges node={node} />
      </div>
      {mouths.map((m) => (
        <Fragment key={m.port}>
          {m.label && <div className="sb-row sb-arm">{m.label}</div>}
          <div className="sb-mouth" data-sb-mouth={sb.inert ? undefined : `${node.id}|${m.port}`}>
            <Stack blocks={b.mouths[m.port] ?? []} />
          </div>
        </Fragment>
      ))}
      {mouths.length > 0 && <div className="sb-row sb-foot" />}
      {continues && <span className="sb-tab" aria-hidden />}
    </div>
  );
}

export function Stack({ blocks }: { blocks: SBlock[] }) {
  return (
    <div className="sb-stack">
      {blocks.map((b) => (
        <Block key={b.node} b={b} />
      ))}
    </div>
  );
}

export function Script({ top, pos }: { top: STop; pos: LayoutPoint }) {
  return (
    <div className="sb-script" style={{ left: pos.x, top: pos.y }} data-sb-top={top.top} data-sb-hat={top.hat ? '1' : '0'}>
      {top.hat && <Block b={{ node: top.top, mouths: {} }} hat />}
      <Stack blocks={top.body} />
    </div>
  );
}
