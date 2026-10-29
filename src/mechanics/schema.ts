// Serializable mechanic graphs. This is the only shape that is saved; everything else is derived.
//
// Schema 2 separates behaviour from presentation:
//   nodes + edges   the mechanic itself. The ORDER of `nodes` is meaningful: when several handlers
//                   react to the same event, they run in this order. Both editors preserve it.
//   layout          where each editor draws things. Changing it never changes behaviour.

export const GRAPH_SCHEMA_VERSION = 2 as const;

export type PortType = 'exec' | 'number' | 'boolean' | 'vector' | 'entity';

export interface VecValue {
  x: number;
  y: number;
}

export type ParamValue = number | boolean | string | VecValue;

export interface GraphNode {
  /** Stable identity: survives editor switches, renames, save/load and migration. */
  id: string;
  type: string;
  /** Configuration params and literal values for unconnected data inputs, keyed by id. */
  params: Record<string, ParamValue>;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

/** Presentation only. Each editor keeps its own positions; neither affects behaviour. */
export interface GraphLayout {
  /** Blueprint Blocks: position of every block, keyed by node id. */
  blueprint: Record<string, LayoutPoint>;
  /** Scratch Blocks: position of each top-level script or loose block, keyed by its top node id. */
  scratch: Record<string, LayoutPoint>;
}

export interface GraphEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface MechanicGraph {
  schema: typeof GRAPH_SCHEMA_VERSION;
  id: string;
  name: string;
  /** Accent colour used for the mechanic chip. */
  color: string;
  notes?: string;
  created: number;
  updated: number;
  /** Behaviour. Order = resolution order for handlers of the same event. */
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: GraphLayout;
}

export function emptyLayout(): GraphLayout {
  return { blueprint: {}, scratch: {} };
}

export interface MechanicLibrary {
  schema: typeof GRAPH_SCHEMA_VERSION;
  mechanics: MechanicGraph[];
  /** Equipped mechanic ids in slot order. Slot order is resolution order. */
  equipped: string[];
}

export const MAX_EQUIPPED = 4;

let counter = 0;
export function uid(prefix = 'n'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const MECH_COLORS = ['#ff7a3d', '#3f7cff', '#1fb59a', '#a45ee5', '#f2b62a', '#ef476f'];

export function emptyGraph(name = 'Untitled Mechanic'): MechanicGraph {
  const now = Date.now();
  return {
    schema: GRAPH_SCHEMA_VERSION,
    id: uid('m'),
    name,
    color: MECH_COLORS[Math.floor(Math.random() * MECH_COLORS.length)],
    notes: '',
    created: now,
    updated: now,
    nodes: [],
    edges: [],
    layout: emptyLayout(),
  };
}

export function emptyLibrary(): MechanicLibrary {
  return { schema: GRAPH_SCHEMA_VERSION, mechanics: [], equipped: [] };
}
