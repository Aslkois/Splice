import { useEffect, useMemo, useState } from 'react';
import { runner } from '../../game/bridge';
import type { MechanicHost, Scope } from '../../mechanics/runtime';
import type { TraceCategory, TraceEntry } from '../../mechanics/trace';
import { formatValue } from '../../mechanics/trace';
import { effectiveWindup } from '../../sim/exchange/formulas';
import './debugger.css';

/** Re-render on a timer while mounted (the debugger reads live engine state). */
function useTick(ms: number, on = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return n;
}

const CATS: { id: 'all' | 'fail' | TraceCategory; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'fail', label: 'Only problems' },
  { id: 'condition', label: 'Conditions' },
  { id: 'resources', label: 'Resources' },
  { id: 'target', label: 'Targets' },
  { id: 'requirement', label: 'Requirements' },
  { id: 'interrupted', label: 'Interruptions' },
  { id: 'limit', label: 'Limits' },
  { id: 'logic', label: 'Logic' },
];

const CAT_LABEL: Record<TraceCategory, string> = {
  condition: 'condition false',
  resources: 'not enough resources',
  target: 'unsupported target',
  requirement: 'requirement not met',
  interrupted: 'interrupted',
  limit: 'safety limit',
  logic: 'invalid logic',
};

const f1 = (n: number) => (!Number.isFinite(n) ? '∞' : String(Math.round(n * 10) / 10));

function host(): MechanicHost | null {
  return runner.attach?.host ?? null;
}

function TraceRow({ e, onPick }: { e: TraceEntry; onPick?: (e: TraceEntry) => void }) {
  const [open, setOpen] = useState(false);
  const cond = e.category === 'condition';
  const bad = !e.ok && !cond;
  const hasMore = !!(e.values?.length || e.quote || e.details?.length || e.reason);
  return (
    <li className={`dbg-row k-${e.kind} ${cond ? 'cond' : bad ? 'bad' : ''}`}>
      <button
        type="button"
        className="dbg-line"
        onClick={() => {
          setOpen((o) => !o);
          onPick?.(e);
        }}
        aria-expanded={hasMore ? open : undefined}
      >
        <span className="dbg-time" title={`tick ${e.tick}`}>
          {e.time.toFixed(2)}s
        </span>
        <span className="dbg-mech">{e.mechName}</span>
        <span className="dbg-text">
          {e.kind === 'event' ? '⚑ ' : e.kind === 'wait' ? '⏸ ' : e.kind === 'resume' ? '▶ ' : e.kind === 'limit' ? '⛔ ' : ''}
          {e.text}
          {e.port && e.kind === 'block' && e.port !== 'then' ? ` → ${e.port}` : ''}
          {e.cost && (e.cost.energy > 0.05 || e.cost.stamina > 0.05) ? ` · ${e.cost.energy > 0.05 ? `${f1(e.cost.energy)}⚡` : ''}${e.cost.stamina > 0.05 ? ` ${f1(e.cost.stamina)} st` : ''}` : ''}
        </span>
        {(bad || cond) && e.category && <span className={`dbg-cat c-${e.category}`}>{CAT_LABEL[e.category]}</span>}
        {e.details?.length ? <span className="dbg-detail-inline">{e.details.map((d) => `${d.label} = ${d.value}`).join(', ')}</span> : null}
      </button>
      {open && hasMore && (
        <div className="dbg-detail">
          {e.reason && <p className="dbg-reason">{e.reason}</p>}
          {e.values?.length ? (
            <dl>
              {e.values.map((v, i) => (
                <div key={i}>
                  <dt>{v.port}</dt>
                  <dd>{v.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {e.details?.length ? (
            <dl>
              {e.details.map((v, i) => (
                <div key={i}>
                  <dt>{v.label}</dt>
                  <dd>{v.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {e.quote && (
            <dl className="dbg-quote">
              {e.quote.lines.map((l, i) => (
                <div key={i}>
                  <dt>{l.label}</dt>
                  <dd>
                    {l.value} {l.unit}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Base price</dt>
                <dd>{f1(e.quote.base.energy)} E{e.quote.base.stamina > 0 ? `, ${f1(e.quote.base.stamina)} stamina` : ''}</dd>
              </div>
              <div>
                <dt>Windup</dt>
                <dd>
                  {f1(e.quote.windup)} s → ×{e.quote.factor.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>Charged</dt>
                <dd>
                  {f1(e.quote.cost.energy)} E ({f1(e.quote.fromPool)} from released charge, {f1(e.quote.fromReservoir)} from reservoir)
                </dd>
              </div>
              <div>
                <dt>Available then</dt>
                <dd>{f1(e.quote.available)} E</dd>
              </div>
              {e.after && (
                <div>
                  <dt>Left after</dt>
                  <dd>
                    {f1(e.after.energy)} E, {f1(e.after.stamina)} stamina
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

function TraceTab({ mechId, onPick }: { mechId?: string; onPick?: (e: TraceEntry) => void }) {
  const [paused, setPaused] = useState(false);
  const [cat, setCat] = useState<(typeof CATS)[number]['id']>('all');
  const [mech, setMech] = useState<string>(mechId ?? 'all');
  const [snapshot, setSnapshot] = useState<TraceEntry[]>([]);
  const tick = useTick(250, !paused);
  useEffect(() => setMech(mechId ?? 'all'), [mechId]);
  useEffect(() => {
    if (paused) return;
    setSnapshot(host()?.traceLog.entries() ?? []);
  }, [tick, paused]);
  const mechs = useMemo(() => [...new Map(snapshot.map((e) => [e.mechId, e.mechName])).entries()], [snapshot]);
  const rows = snapshot.filter((e) => {
    if (mech !== 'all' && e.mechId !== mech && e.mechId !== '') return false;
    if (cat === 'all') return true;
    if (cat === 'fail') return !e.ok && e.category !== 'condition';
    return e.category === cat;
  });
  const shown = rows.slice(-300);
  return (
    <div className="dbg-trace">
      <div className="dbg-bar">
        <select aria-label="Mechanic" value={mech} onChange={(e) => setMech(e.target.value)}>
          <option value="all">All mechanics</option>
          {mechs.map(([id, name]) => (
            <option key={id} value={id}>
              {name || 'Engine'}
            </option>
          ))}
        </select>
        <select aria-label="Show" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}>
          {CATS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn small quiet" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="btn small quiet"
          onClick={() => {
            host()?.traceLog.clear();
            setSnapshot([]);
          }}
        >
          Clear
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="dbg-empty">Nothing recorded yet. Play with your mechanic equipped — every event, block, wait and failure appears here with its simulation time.</p>
      ) : (
        <ol className="dbg-list" aria-live="off">
          {shown.map((e) => (
            <TraceRow key={e.seq} e={e} onPick={onPick} />
          ))}
        </ol>
      )}
      {rows.length > shown.length && <p className="dbg-more">Showing the newest 300 of {rows.length}.</p>}
    </div>
  );
}

function ScopeTable({ title, scope, now }: { title: string; scope: Scope; now: number }) {
  const rows: [string, string][] = [];
  for (const [k, v] of scope.numbers) rows.push([k, formatValue(v)]);
  for (const [k, v] of scope.flags) rows.push([k, v ? 'true' : 'false']);
  for (const [k, v] of scope.vectors) rows.push([k, formatValue(v)]);
  for (const [k, v] of scope.entities) rows.push([k, v ? `entity #${v}` : 'nobody']);
  for (const [k, t] of scope.timers) rows.push([`⏱ ${k}`, t.running ? `${(now - t.start).toFixed(2)} s${t.duration != null ? ` of ${t.duration} s${t.fired ? ' (fired)' : ''}` : ''}` : '∞ (stopped)']);
  return (
    <section>
      <h5>{title}</h5>
      {rows.length ? (
        <dl className="dbg-vars">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="dbg-empty">Nothing stored.</p>
      )}
    </section>
  );
}

function VariablesTab({ mechId }: { mechId?: string }) {
  useTick(250);
  const h = host();
  const w = runner.world;
  if (!h || !w) return <p className="dbg-empty">No world running.</p>;
  const mechs = h.mechanics.filter((m) => !mechId || m.id === mechId);
  return (
    <div className="dbg-varsTab">
      <ScopeTable title="Whole character" scope={h.characterScope} now={w.time} />
      {mechs.map((m) => (
        <ScopeTable key={m.id} title={`“${m.name}” only`} scope={h.scopeOf(m.id)} now={w.time} />
      ))}
    </div>
  );
}

function ExchangeTab() {
  useTick(250);
  const w = runner.world;
  const p = w?.player;
  if (!w || !p) return <p className="dbg-empty">No world running.</p>;
  const a = w.exchange.audit;
  const { reservoir, committed } = w.exchange.holdings(p);
  const inFlight = runner.attach?.host.pooledEnergy() ?? 0;
  const balance = reservoir + committed + inFlight - (a.start + a.income - a.spent - a.dissipated);
  return (
    <div className="dbg-ex">
      <dl className="dbg-vars">
        <div>
          <dt>Reservoir</dt>
          <dd>
            {f1(reservoir)} / {f1(p.account.capacity)} E
          </dd>
        </div>
        <div>
          <dt>Committed in charges</dt>
          <dd>{f1(committed)} E</dd>
        </div>
        <div>
          <dt>Released, not yet spent</dt>
          <dd>{f1(inFlight)} E</dd>
        </div>
        <div>
          <dt>Stamina</dt>
          <dd>
            {f1(p.account.stamina)} / {f1(p.account.staminaMax)}
          </dd>
        </div>
        <div>
          <dt>Law of Equivalent Exchange</dt>
          <dd>{w.lawEnabled ? 'on' : 'OFF (sandbox)'}</dd>
        </div>
      </dl>
      {[...p.account.charges.entries()].length > 0 && (
        <>
          <h5>Charges</h5>
          <dl className="dbg-vars">
            {[...p.account.charges.entries()].map(([name, c]) => (
              <div key={name}>
                <dt>“{name}”</dt>
                <dd>
                  {f1(c.amount)} E · {c.channeling ? 'channelling' : 'held'} · preparation {f1(effectiveWindup(c.windup, c.channeling ? null : c.windupEndedAt, w.time))} s
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <h5>Audit since spawn</h5>
      <p className="dbg-audit">
        start {f1(a.start)} + income {f1(a.income)} − spent {f1(a.spent)} − lost {f1(a.dissipated)} = {f1(a.start + a.income - a.spent - a.dissipated)} E · held {f1(reservoir + committed + inFlight)} E{' '}
        <b className={Math.abs(balance) < 0.01 ? 'ok' : 'bad'}>{Math.abs(balance) < 0.01 ? '✓ balanced' : `✗ off by ${f1(balance)}`}</b>
      </p>
      <h5>Ledger (newest last)</h5>
      <ol className="dbg-list">
        {w.exchange.log.slice(-40).map((t) => (
          <li key={t.id} className={`dbg-row ${t.ok ? '' : 'bad'}`}>
            <span className="dbg-line static">
              <span className="dbg-time">{t.time.toFixed(2)}s</span>
              <span className="dbg-text">
                {t.label}
                {t.energy > 0.05 ? ` −${f1(t.energy)}⚡` : ''}
                {t.stamina > 0.05 ? ` −${f1(t.stamina)} st` : ''}
                {t.gained > 0.05 ? ` +${f1(t.gained)}⚡` : ''}
                {t.reason ? ` — ${t.reason}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DebuggerPanel({ mechId, onPick, compact = false }: { mechId?: string; onPick?: (e: TraceEntry) => void; compact?: boolean }) {
  const [tab, setTab] = useState<'trace' | 'vars' | 'exchange'>('trace');
  return (
    <div className={`dbg ${compact ? 'compact' : ''}`}>
      <div className="dbg-tabs" role="tablist">
        {(
          [
            ['trace', 'Trace'],
            ['vars', 'Variables'],
            ['exchange', 'Exchange'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="dbg-body" role="tabpanel">
        {tab === 'trace' && <TraceTab mechId={mechId} onPick={onPick} />}
        {tab === 'vars' && <VariablesTab mechId={mechId} />}
        {tab === 'exchange' && <ExchangeTab />}
      </div>
    </div>
  );
}
