import { BaseEdge, type ConnectionLineComponentProps, type Edge, type EdgeProps } from '@xyflow/react';
import { getPrimitive, inputPorts, outputPorts } from '../../mechanics/registry';
import type { PortType } from '../../mechanics/schema';

export type CableEdgeType = Edge<{ portType: PortType; active?: boolean }, 'cable'>;

export const PORT_COLORS: Record<PortType, string> = {
  exec: '#f7f7f2',
  number: '#ffd23f',
  boolean: '#18c29c',
  vector: '#ff5c8a',
  entity: '#6fa8ff',
};

/** A patch cable: leaves the jack horizontally and sags under its own weight. */
export function cablePath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  const dist = Math.hypot(dx, ty - sy);
  const reach = Math.max(40, Math.abs(dx) * 0.45, Math.min(160, dist * 0.35));
  const sag = Math.min(90, dist * 0.22);
  return `M ${sx} ${sy} C ${sx + reach} ${sy + sag}, ${tx - reach} ${ty + sag}, ${tx} ${ty}`;
}

export function CableEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<CableEdgeType>) {
  const type = data?.portType ?? 'exec';
  const exec = type === 'exec';
  const d = cablePath(sourceX, sourceY, targetX, targetY);
  const color = PORT_COLORS[type];
  return (
    <g className={`cable ${selected ? 'sel' : ''}`}>
      <path d={d} fill="none" stroke="#15161c" strokeWidth={exec ? 9 : 7} strokeLinecap="round" />
      <BaseEdge id={id} path={d} style={{ stroke: color, strokeWidth: exec ? 5 : 4, strokeLinecap: 'round' }} interactionWidth={18} />
      {exec && <path d={d} fill="none" stroke="#15161c" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="2 7" />}
      {data?.active && <path d={d} fill="none" stroke="#ffd23f" strokeWidth={9} strokeOpacity={0.35} strokeLinecap="round" className="cable-active" />}
      {selected && <path d={d} fill="none" stroke="#ffd23f" strokeWidth={2} strokeDasharray="6 6" />}
    </g>
  );
}

export function CableConnectionLine({ fromX, fromY, toX, toY, fromHandle, fromNode, connectionStatus }: ConnectionLineComponentProps) {
  const def = getPrimitive(String((fromNode?.data as { type?: string } | undefined)?.type ?? ''));
  const ports = def ? (fromHandle?.type === 'target' ? inputPorts(def) : outputPorts(def)) : [];
  const type: PortType = ports.find((p) => p.id === fromHandle?.id)?.type ?? 'exec';
  const fromIsTarget = fromHandle?.type === 'target';
  const d = fromIsTarget ? cablePath(toX, toY, fromX, fromY) : cablePath(fromX, fromY, toX, toY);
  const color = connectionStatus === 'invalid' ? '#e8455c' : PORT_COLORS[type];
  return (
    <g>
      <path d={d} fill="none" stroke="#15161c" strokeWidth={8} strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round" />
      <circle cx={toX} cy={toY} r={7} fill="#15161c" />
      <circle cx={toX} cy={toY} r={4} fill={color} />
    </g>
  );
}
