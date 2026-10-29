import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_INFO, inputPorts, outputPorts, PRIMITIVES } from '../../mechanics/registry';
import type { PortType } from '../../mechanics/schema';
import type { PrimitiveDef } from '../../mechanics/types';
import type { ValidateOptions } from '../../mechanics/validate';
import { partLocked } from './editorContext';
import { matchesQuery } from './scratch/ScratchPalette';

/** What the search was opened from: a dragged wire end, so only blocks that can plug in are offered. */
export interface SearchFrom {
  /** The wire came from an output (so we need an input of this type) or from an input. */
  side: 'out' | 'in';
  type: PortType;
}

/** The port of `def` a wire of type `from` would plug into, if any. */
export function compatiblePort(def: PrimitiveDef, from: SearchFrom): string | null {
  const ports = from.side === 'out' ? inputPorts(def) : outputPorts(def);
  return ports.find((p) => p.type === from.type)?.id ?? null;
}

/**
 * The Blueprint node search: opens where you right-click, press Space, or drop a wire on empty
 * space. Filtered by what you type and — after a wire drop — by what can plug into that wire.
 */
export function NodeSearch({
  at,
  from,
  rules,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  from: SearchFrom | null;
  rules: ValidateOptions;
  onPick: (type: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus after the canvas has finished handling the pointer-up that opened us.
    const t = requestAnimationFrame(() => input.current?.focus());
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', outside);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('pointerdown', outside);
    };
  }, [onClose]);
  const items = useMemo(
    () =>
      PRIMITIVES.filter(
        (p) =>
          !partLocked(p.type, rules) &&
          (!rules.allowedTypes || rules.allowedTypes.includes(p.type)) &&
          (!from || compatiblePort(p, from) != null) &&
          matchesQuery(p, q.trim()),
      ).slice(0, 60),
    [q, from, rules],
  );
  useEffect(() => setSel(0), [q]);
  const pick = (i: number) => {
    const p = items[i];
    if (p) onPick(p.type);
  };
  return (
    <div
      ref={root}
      className="node-search"
      style={{ left: Math.min(at.x, window.innerWidth - 340), top: Math.min(at.y, window.innerHeight - 380) }}
      role="dialog"
      aria-label="Add a block"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={input}
        value={q}
        placeholder={from ? `Blocks that take ${from.side === 'out' ? 'this' : 'give'} ${from.type === 'exec' ? 'flow' : from.type}…` : 'Add a block…'}
        aria-label="Search blocks"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(items.length - 1, s + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === 'Enter') pick(sel);
        }}
      />
      <ul role="listbox" aria-label="Matching blocks">
        {items.map((p, i) => (
          <li key={p.type} role="option" aria-selected={i === sel}>
            <button type="button" className={`cat-${p.category} ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(i)}>
              <span className="ns-label">{p.label}</span>
              <span className="ns-cat">{CATEGORY_INFO[p.category].label}</span>
            </button>
          </li>
        ))}
        {!items.length && <li className="ns-none">Nothing {from ? 'that fits that wire ' : ''}matches.</li>}
      </ul>
    </div>
  );
}
