import { useMemo, useState } from 'react';
import { CATEGORY_INFO, CATEGORY_ORDER, PRIMITIVES } from '../../mechanics/registry';
import type { PrimitiveDef } from '../../mechanics/types';
import { TIER_SOURCE } from './editorContext';

export const DRAG_MIME = 'application/splice-node';

/** The parts drawer: every primitive, grouped, draggable onto the mat (or click to drop it in view). */
export function PartsDrawer({ maxTier, newTier, onAdd }: { maxTier: number | undefined; newTier: number | null; onAdd: (type: string) => void }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      items: PRIMITIVES.filter((p) => p.category === cat && (!q || p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))),
    })).filter((g) => g.items.length);
  }, [query]);

  const tile = (p: PrimitiveDef) => {
    const locked = maxTier != null && p.tier > maxTier;
    const fresh = newTier != null && p.tier === newTier;
    return (
      <button
        key={p.type}
        className={`part cat-${p.category} ${locked ? 'locked' : ''} ${fresh ? 'fresh' : ''}`}
        draggable={!locked}
        disabled={locked}
        title={locked ? `Unlocks after “${TIER_SOURCE[p.tier]}”` : p.description}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, p.type);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => !locked && onAdd(p.type)}
        data-part={p.type}
      >
        <span className="part-name">{p.label}</span>
        {locked && <span className="part-lock" aria-label="locked" />}
        {fresh && !locked && <span className="part-new">new</span>}
      </button>
    );
  };

  return (
    <section className="drawer" aria-label="Parts">
      <input className="drawer-search" placeholder="Find a part" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Find a part" />
      <div className="drawer-scroll">
        {groups.map((g) => (
          <div key={g.cat} className="drawer-group">
            <h4 className={`cat-label cat-${g.cat}`}>
              {CATEGORY_INFO[g.cat].label}
              <small>{CATEGORY_INFO[g.cat].blurb}</small>
            </h4>
            <div className="parts">{g.items.map(tile)}</div>
          </div>
        ))}
        <div className="field-guide">
          <h4>Reading the cables</h4>
          <p>
            <i className="sw t-exec" /> Flow cables decide what happens next. One per output — use Sequence to do several things.
          </p>
          <p>
            <i className="sw t-number" /> numbers <i className="sw t-boolean" /> true/false <i className="sw t-vector" /> directions <i className="sw t-entity" /> things in the world
          </p>
          <p>Unplugged value inputs use the number typed on the block. Double-click a cable to unplug it.</p>
        </div>
      </div>
    </section>
  );
}
