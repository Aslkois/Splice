import { useMemo, useState } from 'react';
import { presentationOf } from '../../../mechanics/presentation';
import { CATEGORY_INFO, CATEGORY_ORDER, defaultParams, PRIMITIVES } from '../../../mechanics/registry';
import { emptyGraph } from '../../../mechanics/schema';
import type { PrimitiveDef } from '../../../mechanics/types';
import type { ValidateOptions } from '../../../mechanics/validate';
import { partLocked, TIER_SOURCE } from '../editorContext';
import { Block, Reporter } from './blocks';
import { SbContext, type SbApi } from './sbContext';

/** One graph holding a default copy of every block, so the palette can draw real previews. */
const PREVIEW = (() => {
  const g = emptyGraph('palette');
  g.nodes = PRIMITIVES.map((p) => ({ id: `p:${p.type}`, type: p.type, params: defaultParams(p) }));
  return g;
})();

const NONE = () => null;
const previewApi: SbApi = {
  graph: PREVIEW,
  inEdge: new Map(),
  outCount: new Map(),
  issues: new Map(),
  trace: undefined,
  selected: null,
  failOpen: new Set(),
  recent: new Set(),
  inert: true,
  isLocked: () => false,
  setParam: NONE,
  setEdgePort: NONE,
  startDrag: NONE,
  select: NONE,
  menu: NONE,
  moveHandler: NONE,
  rank: () => null,
  names: new Map(),
};

/** A block drawn as it looks in Scratch Blocks, with its default values (docs, inspector). */
export function BlockPreview({ type }: { type: string }) {
  const def = PRIMITIVES.find((p) => p.type === type);
  if (!def) return null;
  const pure = !def.execIn && !def.event;
  return (
    <SbContext.Provider value={previewApi}>
      <span className="sb-preview">{pure ? <Reporter id={`p:${type}`} port={def.outputs?.[0]?.id ?? 'out'} /> : <Block b={{ node: `p:${type}`, mouths: {} }} hat={!!def.event} />}</span>
    </SbContext.Provider>
  );
}

export function matchesQuery(p: PrimitiveDef, q: string): boolean {
  if (!q) return true;
  const pres = presentationOf(p.type);
  const hay = [p.label, p.description, pres.scratch.text.replace(/\{[^}]*\}/g, ' '), ...pres.aliases].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** The Scratch Blocks palette: every block drawn as itself, searchable, draggable onto the workspace. */
export function ScratchPalette({
  rules,
  newTier,
  onAdd,
  onDragStart,
}: {
  rules: ValidateOptions;
  newTier: number | null;
  onAdd: (type: string) => void;
  onDragStart: (type: string, e: React.PointerEvent) => void;
}) {
  const [query, setQuery] = useState('');
  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        cat,
        items: PRIMITIVES.filter((p) => p.category === cat && (!rules.allowedTypes || rules.allowedTypes.includes(p.type)) && matchesQuery(p, query.trim())),
      })).filter((g) => g.items.length),
    [query, rules],
  );

  return (
    <section className="drawer sb-palette" aria-label="Blocks" data-sb-palette>
      <input
        className="drawer-search"
        placeholder="Find a block (try “jump” or “parry”)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="Find a block"
      />
      <p className="sb-pal-hint">Drag a block onto the workspace, or select it and press Enter. Drag blocks back here to delete them.</p>
      <SbContext.Provider value={previewApi}>
        <div className="drawer-scroll">
          {groups.map((g) => (
            <div key={g.cat} className="drawer-group">
              <h4 className={`cat-label cat-${g.cat}`}>
                {CATEGORY_INFO[g.cat].label}
                <small>{CATEGORY_INFO[g.cat].blurb}</small>
              </h4>
              <div className="sb-pal-items">
                {g.items.map((p) => {
                  const locked = partLocked(p.type, rules);
                  const fresh = newTier != null && p.tier === newTier;
                  const pure = !p.execIn && !p.event;
                  return (
                    <button
                      key={p.type}
                      type="button"
                      className={`sb-pal-item ${locked ? 'locked' : ''} ${fresh ? 'fresh' : ''}`}
                      disabled={locked}
                      data-palette-type={p.type}
                      title={locked ? (rules.allowedTypes ? 'Not part of this lab' : `Unlocks after “${TIER_SOURCE[p.tier]}”`) : `${p.label}: ${p.description}`}
                      aria-label={`${p.label}${locked ? ' (locked)' : ''}`}
                      onPointerDown={(e) => !locked && e.button === 0 && onDragStart(p.type, e)}
                      onClick={(e) => {
                        // Mouse clicks are handled by the drag code (a click is a drag that didn't move).
                        if (e.detail === 0 && !locked) onAdd(p.type);
                      }}
                    >
                      {pure ? <Reporter id={`p:${p.type}`} port={p.outputs?.[0]?.id ?? 'out'} /> : <Block b={{ node: `p:${p.type}`, mouths: {} }} hat={!!p.event} />}
                      {fresh && !locked && <span className="part-new">new</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!groups.length && <p className="sb-pal-none">No block matches “{query}”.</p>}
        </div>
      </SbContext.Provider>
    </section>
  );
}
