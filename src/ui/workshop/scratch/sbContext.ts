import { createContext, useContext } from 'react';
import type { NodeTrace } from '../../../mechanics/runtime';
import type { GraphEdge, MechanicGraph, ParamValue } from '../../../mechanics/schema';
import type { Issue } from '../../../mechanics/validate';

/** Where a drag starts. The editor turns it into a carried fragment once the pointer moves. */
export type DragSource =
  | { kind: 'block'; node: string }
  | { kind: 'reporter'; node: string; port: string; edge?: GraphEdge }
  | { kind: 'ref'; node: string; port: string; edge?: GraphEdge }
  | { kind: 'palette'; type: string };

export interface SbApi {
  graph: MechanicGraph;
  /** "nodeId:port" → the value wire plugged into that input. */
  inEdge: Map<string, GraphEdge>;
  /** Value wires leaving each block (a reporter feeding several slots is shared). */
  outCount: Map<string, number>;
  issues: Map<string, Issue[]>;
  trace: Map<string, NodeTrace> | undefined;
  selected: string | null;
  /** Blocks whose optional mouth ("if it fails") the player opened. */
  failOpen: Set<string>;
  /** Blocks that ran in the last moments of the playtest (debug highlight). */
  recent: Set<string>;
  /** Rendering a ghost or a palette preview: no interaction. */
  inert: boolean;
  isLocked(type: string): boolean;
  setParam(node: string, key: string, value: ParamValue): void;
  /** Which output of a multi-output reporter (Break Vector) a wire carries. */
  setEdgePort(edgeId: string, port: string): void;
  startDrag(e: React.PointerEvent, src: DragSource): void;
  select(id: string): void;
  menu(e: React.MouseEvent, id: string): void;
  moveHandler(id: string, dir: -1 | 1): void;
  rank(id: string): { rank: number; of: number } | null;
  /** Names already used for variables/timers/charges/signals, offered while typing. */
  names: Map<string, string[]>;
}

export const SbContext = createContext<SbApi | null>(null);

export function useSb(): SbApi {
  const v = useContext(SbContext);
  if (!v) throw new Error('SbContext missing');
  return v;
}
