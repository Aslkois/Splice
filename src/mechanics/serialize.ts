import { GRAPH_SCHEMA_VERSION, MAX_EQUIPPED, emptyLibrary, type LayoutPoint, type MechanicGraph, type MechanicLibrary } from './schema';

/**
 * Versioned (de)serialisation. Older schemas are migrated forward; anything unreadable is rejected
 * with a reason instead of being half-loaded.
 */

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a graph from schema n to n + 1. */
const GRAPH_MIGRATIONS: Record<number, Migration> = {
  0: (raw) => ({ ...raw, schema: 1, color: raw.color ?? '#ff7a3d', notes: raw.notes ?? '' }),
  /**
   * 1 → 2: positions move out of the nodes into `layout.blueprint`.
   * Schema 1 ran handlers of the same event in canvas order (top-to-bottom, then left-to-right, then
   * id). That order is now made explicit by sorting the node list exactly the same way, so every
   * existing mechanic behaves identically after migration.
   */
  1: (raw) => {
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []) as Record<string, unknown>[];
    const pos = (n: Record<string, unknown>) => ({ x: Number(n.x) || 0, y: Number(n.y) || 0 });
    const sorted = [...nodes].sort((a, b) => {
      const pa = pos(a);
      const pb = pos(b);
      return pa.y - pb.y || pa.x - pb.x || (String(a.id) < String(b.id) ? -1 : 1);
    });
    const blueprint: Record<string, LayoutPoint> = {};
    for (const n of sorted) if (typeof n.id === 'string') blueprint[n.id] = pos(n);
    return {
      ...raw,
      schema: 2,
      nodes: sorted.map((n) => ({ id: n.id, type: n.type, params: n.params })),
      layout: { blueprint, scratch: {} },
    };
  },
};

function sanitizeLayout(raw: unknown, ids: Set<string>): Record<string, LayoutPoint> {
  const out: Record<string, LayoutPoint> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(k) || !v || typeof v !== 'object') continue;
    const p = v as { x?: unknown; y?: unknown };
    const x = Number(p.x);
    const y = Number(p.y);
    if (Number.isFinite(x) && Number.isFinite(y)) out[k] = { x, y };
  }
  return out;
}

export function migrateGraph(input: unknown): MechanicGraph {
  if (!input || typeof input !== 'object') throw new Error('not a mechanic');
  let raw = { ...(input as Record<string, unknown>) };
  let v = typeof raw.schema === 'number' ? raw.schema : 0;
  if (v > GRAPH_SCHEMA_VERSION) throw new Error(`made with a newer version of SPLICE (schema ${v})`);
  while (v < GRAPH_SCHEMA_VERSION) {
    const m = GRAPH_MIGRATIONS[v];
    if (!m) throw new Error(`no migration from schema ${v}`);
    raw = m(raw);
    v++;
  }
  if (typeof raw.id !== 'string' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error('missing nodes or edges');
  const nodes = (raw.nodes as Record<string, unknown>[]).map((n) => {
    if (typeof n.id !== 'string' || typeof n.type !== 'string') throw new Error('malformed block');
    return {
      id: n.id,
      type: n.type,
      params: sanitizeParams(n.params),
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const rawLayout = (raw.layout && typeof raw.layout === 'object' ? raw.layout : {}) as Record<string, unknown>;
  const edges = (raw.edges as Record<string, unknown>[]).map((e) => {
    if (typeof e.id !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') throw new Error('malformed wire');
    return { id: e.id, from: e.from, fromPort: String(e.fromPort), to: e.to, toPort: String(e.toPort) };
  });
  return {
    schema: GRAPH_SCHEMA_VERSION,
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 60) : 'Untitled Mechanic',
    color: typeof raw.color === 'string' ? raw.color : '#ff7a3d',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    created: Number(raw.created) || Date.now(),
    updated: Number(raw.updated) || Date.now(),
    nodes,
    edges,
    layout: { blueprint: sanitizeLayout(rawLayout.blueprint, ids), scratch: sanitizeLayout(rawLayout.scratch, ids) },
  };
}

function sanitizeParams(p: unknown): MechanicGraph['nodes'][number]['params'] {
  const out: MechanicGraph['nodes'][number]['params'] = {};
  if (!p || typeof p !== 'object') return out;
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : 0;
    else if (typeof v === 'boolean' || typeof v === 'string') out[k] = v;
    else if (v && typeof v === 'object' && 'x' in v && 'y' in v) out[k] = { x: Number((v as { x: unknown }).x) || 0, y: Number((v as { y: unknown }).y) || 0 };
  }
  return out;
}

export function serializeGraph(g: MechanicGraph): string {
  return JSON.stringify(g);
}

export function deserializeGraph(text: string): MechanicGraph {
  return migrateGraph(JSON.parse(text));
}

export function serializeLibrary(lib: MechanicLibrary): string {
  return JSON.stringify(lib);
}

export function deserializeLibrary(text: string | null): MechanicLibrary {
  if (!text) return emptyLibrary();
  const raw = JSON.parse(text) as Record<string, unknown>;
  const mechanics: MechanicGraph[] = [];
  for (const m of Array.isArray(raw.mechanics) ? raw.mechanics : []) {
    try {
      mechanics.push(migrateGraph(m));
    } catch {
      // A single unreadable mechanic must not take the whole library down.
    }
  }
  const ids = new Set(mechanics.map((m) => m.id));
  const equipped = (Array.isArray(raw.equipped) ? raw.equipped : []).filter((id): id is string => typeof id === 'string' && ids.has(id)).slice(0, MAX_EQUIPPED);
  return { schema: GRAPH_SCHEMA_VERSION, mechanics, equipped };
}

/** Share code: a compact, copy-pasteable string. */
export function exportShareCode(g: MechanicGraph): string {
  const json = serializeGraph(g);
  return 'SPLICE1:' + btoa(unescape(encodeURIComponent(json)));
}

export function importShareCode(code: string): MechanicGraph {
  const trimmed = code.trim();
  const body = trimmed.startsWith('SPLICE1:') ? trimmed.slice(8) : trimmed;
  const json = trimmed.startsWith('{') ? trimmed : decodeURIComponent(escape(atob(body)));
  return deserializeGraph(json);
}
