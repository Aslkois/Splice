// Serializable mechanic graphs. This is the only shape that is saved; everything else is derived.

export const GRAPH_SCHEMA_VERSION = 1 as const;

export type PortType = 'exec' | 'number' | 'boolean' | 'vector' | 'entity';

export interface VecValue {
  x: number;
  y: number;
}

export type ParamValue = number | boolean | string | VecValue;

export interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Configuration params and literal values for unconnected data inputs, keyed by id. */
  params: Record<string, ParamValue>;
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
  nodes: GraphNode[];
  edges: GraphEdge[];
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
  };
}

export function emptyLibrary(): MechanicLibrary {
  return { schema: GRAPH_SCHEMA_VERSION, mechanics: [], equipped: [] };
}
