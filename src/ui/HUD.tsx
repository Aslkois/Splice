import { useSyncExternalStore } from 'react';
import { telemetry, type HudSnapshot } from '../game/telemetry';
import { LAB_BY_ID } from '../sim/levels/labs';
import { useApp } from '../store/store';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (Math.abs(n) >= 1e5) return n.toExponential(1);
  if (Math.abs(n) >= 100) return Math.round(n).toString();
  return (Math.round(n * 10) / 10).toString();
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value / Math.max(max, 1e-9))) * 100;
  return (
    <div className="bar">
      <i style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function Battery({ energy, capacity }: { energy: number; capacity: number }) {
  const per = capacity / 10;
  return (
    <div className="cells" aria-label={`Energy ${fmt(energy)} of ${fmt(capacity)}`}>
      {Array.from({ length: 10 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, (energy - i * per) / per));
        return (
          <i key={i}>
            <b style={{ transform: `scaleX(${fill})` }} />
          </i>
        );
      })}
    </div>
  );
}

function Gauges({ s }: { s: HudSnapshot }) {
  const mode = useApp((st) => st.mode);
  const setLaw = useApp((st) => st.setLaw);
  return (
    <section className="gauges" aria-label="Your resources">
      <div className="gauge">
        <span className="gauge-name">Health</span>
        <Bar value={s.hp} max={s.maxHp} color="var(--health)" />
        <span className="gauge-val">{fmt(s.hp)}</span>
      </div>
      <div className="gauge">
        <span className="gauge-name">Stamina</span>
        <Bar value={s.stamina} max={s.staminaMax} color="var(--teal)" />
        <span className="gauge-val">{fmt(s.stamina)}</span>
      </div>
      <div className="gauge">
        <span className="gauge-name">Energy</span>
        <Battery energy={s.energy} capacity={s.capacity} />
        <span className="gauge-val">{fmt(s.energy)}</span>
      </div>
      {s.charges.length > 0 && (
        <div className="charges">
          {s.charges.map((c) => (
            <span key={c.name} className={`charge ${c.channeling ? 'live' : ''}`}>
              {c.name} {fmt(c.amount)}
            </span>
          ))}
        </div>
      )}
      {mode === 'sandbox' ? (
        <label className="law-chip">
          <input type="checkbox" className="switch" checked={s.law} onChange={(e) => setLaw(e.target.checked)} />
          Law of Equivalent Exchange {s.law ? 'on' : 'off'}
        </label>
      ) : (
        <span className="law-chip">Law of Equivalent Exchange in force</span>
      )}
    </section>
  );
}

function Receipt({ s }: { s: HudSnapshot }) {
  const lines = s.receipt.filter((t) => t.age < 8);
  return (
    <section className="receipt" aria-label="Exchange receipt" aria-live="polite">
      <h3>
        <span>Exchange receipt</span>
        <span>{s.law ? '' : 'law off'}</span>
      </h3>
      {lines.length === 0 && <div className="receipt-empty">Nothing spent yet.</div>}
      {lines.map((t) => {
        const parts: string[] = [];
        if (t.energy > 0.05) parts.push(`−${fmt(t.energy)} E`);
        if (t.stamina > 0.05) parts.push(`−${fmt(t.stamina)} st`);
        if (t.gained > 0.05) parts.push(`+${fmt(t.gained)} E`);
        const amount = parts.join(' ') || (t.ok ? 'free' : '');
        return (
          <div key={t.id} className={`receipt-line ${t.ok ? '' : 'fail'}`} style={{ opacity: Math.max(0.25, 1 - t.age / 8) }}>
            <span>{t.label}</span>
            <span className={`amt ${t.gained > 0.05 ? 'gain' : ''}`}>{amount}</span>
            {!t.ok && t.reason && <span className="why">{t.reason}</span>}
          </div>
        );
      })}
    </section>
  );
}

function Patchbay({ s }: { s: HudSnapshot }) {
  if (!s.mechanics.length)
    return (
      <div className="patchbay">
        <span className="chip">
          <span className="plug" style={{ background: '#444' }} />
          Nothing equipped. Press Tab to build.
        </span>
      </div>
    );
  return (
    <div className="patchbay" aria-label="Equipped mechanics">
      {s.mechanics.map((m) => {
        const fired = m.lastRun >= 0 && s.time - m.lastRun < 0.25;
        const failed = m.lastFail >= 0 && s.time - m.lastFail < 1.6;
        return (
          <span key={m.id} className={`chip ${fired ? 'fired' : ''} ${failed ? 'failed' : ''} ${m.ok ? '' : 'broken'}`} title={m.ok ? m.failReason : 'Has errors — fix it in the workbench'}>
            <span className="plug" style={{ background: m.color }} />
            {m.name}
            {failed && m.failReason && <span className="chip-reason">{m.failReason}</span>}
            {!m.ok && <span className="chip-reason">has errors</span>}
          </span>
        );
      })}
    </div>
  );
}

export function HUD() {
  const s = useSyncExternalStore(telemetry.subscribe, telemetry.get);
  if (!s.ready) return null;
  const diag = s.diagnostics.filter((d) => d.age < 4).at(-1);
  const lab = s.mode === 'lab' ? LAB_BY_ID[s.levelId] : undefined;
  return (
    <div className="hud">
      <Gauges s={s} />
      <Receipt s={s} />
      {s.objective && (
        <div className={`objective ${s.objectiveDone ? 'done' : ''}`}>
          {s.objectiveDone ? 'Solved. Heading back to the workshop…' : s.objective}
          <small>{lab ? `${s.levelName}: up to ${lab.maxBlocks} blocks, ${lab.parts.length} kinds of part` : s.levelName}</small>
        </div>
      )}
      {s.prompt && (
        <div className="prompt">
          {!s.promptLocked && <span className="kbd">E</span>}
          {s.prompt}
        </div>
      )}
      {diag && <div className="diag">{diag.message}</div>}
      <Patchbay s={s} />
      <div className="keys-hint">
        <span>
          <span className="kbd">Tab</span> workbench
        </span>
        <span>
          <span className="kbd">Esc</span> pause
        </span>
      </div>
    </div>
  );
}
