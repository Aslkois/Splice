import { useState } from 'react';
import { synth } from '../../audio/Synth';
import { MAX_EQUIPPED } from '../../mechanics/schema';
import { exportShareCode, importShareCode } from '../../mechanics/serialize';
import { useApp } from '../../store/store';

/** The shelf of mechanics: pick one to edit, plug up to four into your character. */
export function Library() {
  const library = useApp((s) => s.library);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.selectMechanic);
  const create = useApp((s) => s.createMechanic);
  const toggleEquip = useApp((s) => s.toggleEquip);
  const moveEquip = useApp((s) => s.moveEquip);
  const duplicate = useApp((s) => s.duplicateMechanic);
  const remove = useApp((s) => s.deleteMechanic);
  const importMechanic = useApp((s) => s.importMechanic);
  const [share, setShare] = useState<{ mode: 'export' | 'import'; text: string; error?: string } | null>(null);

  const selected = library.mechanics.find((m) => m.id === selectedId);

  return (
    <section className="library" aria-label="Your mechanics">
      <div className="library-head">
        <h3>Your mechanics</h3>
        <button
          className="btn small"
          onClick={() => {
            create();
            synth.uiClick();
          }}
        >
          New
        </button>
      </div>
      <ul className="mech-list">
        {library.mechanics.map((m) => {
          const slot = library.equipped.indexOf(m.id);
          return (
            <li key={m.id} className={`mech ${m.id === selectedId ? 'sel' : ''}`}>
              <button className="mech-pick" onClick={() => select(m.id)} aria-current={m.id === selectedId}>
                <span className="plug" style={{ background: m.color }} />
                <span className="mech-name">{m.name}</span>
              </button>
              <button
                className={`slot ${slot >= 0 ? 'on' : ''}`}
                onClick={() => {
                  toggleEquip(m.id);
                  synth.uiPlug();
                }}
                title={slot >= 0 ? 'Unplug from your character' : library.equipped.length >= MAX_EQUIPPED ? `All ${MAX_EQUIPPED} slots are full` : 'Plug into your character'}
                aria-label={slot >= 0 ? `Equipped in slot ${slot + 1}; unequip` : 'Equip'}
              >
                {slot >= 0 ? slot + 1 : '+'}
              </button>
            </li>
          );
        })}
      </ul>
      {selected && (
        <div className="mech-actions">
          {library.equipped.includes(selected.id) && (
            <>
              <button className="icon-btn" onClick={() => moveEquip(selected.id, -1)} title="Resolve earlier (slot order decides who reacts first)">
                ▲ slot
              </button>
              <button className="icon-btn" onClick={() => moveEquip(selected.id, 1)} title="Resolve later">
                ▼ slot
              </button>
            </>
          )}
          <button className="icon-btn" onClick={() => duplicate(selected.id)}>
            Duplicate
          </button>
          <button className="icon-btn" onClick={() => setShare({ mode: 'export', text: exportShareCode(selected) })}>
            Share
          </button>
          <button className="icon-btn" onClick={() => setShare({ mode: 'import', text: '' })}>
            Import
          </button>
          <button
            className="icon-btn danger"
            onClick={() => {
              if (confirm(`Scrap “${selected.name}”? This can't be undone.`)) remove(selected.id);
            }}
          >
            Scrap
          </button>
        </div>
      )}
      {share && (
        <div className="share">
          <p>{share.mode === 'export' ? 'Copy this code to share the mechanic.' : 'Paste a mechanic code.'}</p>
          <textarea
            className="nodrag"
            value={share.text}
            readOnly={share.mode === 'export'}
            onChange={(e) => setShare({ ...share, text: e.target.value, error: undefined })}
            onFocus={(e) => share.mode === 'export' && e.target.select()}
            onKeyDown={(e) => e.stopPropagation()}
            rows={3}
          />
          {share.error && <p className="share-error">{share.error}</p>}
          <div style={{ display: 'flex', gap: 6 }}>
            {share.mode === 'export' ? (
              <button className="btn small" onClick={() => void navigator.clipboard?.writeText(share.text)}>
                Copy
              </button>
            ) : (
              <button
                className="btn small"
                onClick={() => {
                  try {
                    importMechanic(importShareCode(share.text));
                    setShare(null);
                    synth.uiPlug();
                  } catch (e) {
                    setShare({ ...share, error: `That code didn't load: ${(e as Error).message}.` });
                    synth.uiError();
                  }
                }}
              >
                Import
              </button>
            )}
            <button className="btn small quiet" onClick={() => setShare(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
