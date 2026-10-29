import { useEffect, useMemo, useRef, useState } from 'react';
import { ARTICLE_BY_ID, ARTICLES } from '../../docs/articles';
import { blockExample } from '../../docs/blockExamples';
import { EXAMPLE_BY_ID, EXAMPLES } from '../../docs/examples';
import { fillNumbers } from '../../docs/numbers';
import { referenceFor, referenceText, tierName } from '../../docs/reference';
import { explainMechanic } from '../../mechanics/explain';
import { CATEGORY_INFO, CATEGORY_ORDER, getPrimitive, PRIMITIVES } from '../../mechanics/registry';
import type { MechanicGraph } from '../../mechanics/schema';
import { PHYSICS } from '../../sim/config';
import { channelSeconds, quoteImpulse, quoteProjectile, windupFactor } from '../../sim/exchange/formulas';
import { DEFAULT_EXCHANGE as T } from '../../sim/exchange/table';
import { useApp, type DocRoute } from '../../store/store';
import { BlockPreview } from '../workshop/scratch/ScratchPalette';
import { Markup } from './Markup';
import './docs.css';

interface SearchEntry {
  route: DocRoute;
  kind: string;
  title: string;
  summary: string;
  text: string;
}

const INDEX: SearchEntry[] = [
  ...ARTICLES.map((a) => ({ route: { kind: 'article', id: a.id } as DocRoute, kind: 'Article', title: a.title, summary: a.summary, text: fillNumbers(a.body).toLowerCase() })),
  ...EXAMPLES.map((e) => ({ route: { kind: 'example', id: e.id } as DocRoute, kind: 'Example', title: e.title, summary: e.summary, text: `${e.summary} ${fillNumbers(e.explain)}`.toLowerCase() })),
  ...PRIMITIVES.map((p) => ({ route: { kind: 'block', type: p.type } as DocRoute, kind: 'Block', title: p.label, summary: referenceFor(p.type)?.doc.summary ?? '', text: referenceText(p.type).toLowerCase() })),
];

export function searchDocs(q: string): SearchEntry[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = INDEX.map((e) => {
    const t = e.title.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (t.includes(term)) score += 6;
      else if (e.text.includes(term)) score += 1;
      else return { e, score: -1 };
    }
    if (t === q.toLowerCase()) score += 10;
    return { e, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((s) => s.e);
}

const f1 = (n: number) => String(Math.round(n * 10) / 10);

/** Live price tables for blocks whose cost depends on what you ask for — computed with the real formulas. */
function PriceTable({ type }: { type: string }) {
  const self = (dv: number) => quoteImpulse(T, { mass: 1, velocity: { x: 0, y: 0 }, impulse: { x: 0, y: -dv }, self: true, distance: 0, maxSpeed: PHYSICS.maxBodySpeed }).energy;
  let head: string[] = [];
  let rows: string[][] = [];
  if (type === 'act.impulse' || type === 'act.setVelocity' || type === 'act.force') {
    head = ['Speed gained on you (from rest)', 'Energy'];
    rows = [300, 450, 600, 760, 1000, 1500, 3000].map((v) => [`${v} px/s`, `${f1(self(v))} E`]);
  } else if (type === 'act.projectile') {
    head = ['Shot', 'Damage', 'Energy'];
    rows = [
      [900, 0.3],
      [1200, 0.2],
      [1400, 0.3],
      [1700, 0.9],
      [2400, 2],
    ].map(([s, m]) => {
      const q = quoteProjectile(T, s, m);
      return [`${m} kg at ${s} px/s`, `${f1(q.damage)} HP`, `${f1(q.energy)} E`];
    });
  } else if (type === 'act.windUp' || type === 'act.channelUntil' || type === 'act.beginCharge') {
    head = ['Preparation', 'Energy prices after it'];
    rows = [0.5, 1, 1.5, 2, 4, 8].map((s) => [`${s} s`, `×${windupFactor(T, s).toFixed(2)}`]);
    if (type === 'act.channelUntil') rows.push(['Channelling 250 E', `≥ ${f1(channelSeconds(T, 250))} s`]);
  } else return null;
  return (
    <div className="doc-table">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlainReading({ graph }: { graph: MechanicGraph }) {
  return (
    <ol className="explain">
      {explainMechanic(graph).map((l, i) => (
        <li key={i} className={l.tone ?? ''} style={{ paddingLeft: `${l.depth * 18 + 6}px` }}>
          {l.text}
        </li>
      ))}
    </ol>
  );
}

function TryButtons({ title, build }: { title: string; build: () => MechanicGraph }) {
  const addToShelf = useApp((s) => s.addToShelf);
  const openWorkshop = useApp((s) => s.openWorkshop);
  const closeDocs = useApp((s) => s.closeDocs);
  const tryMechanic = useApp((s) => s.tryMechanic);
  const screen = useApp((s) => s.screen);
  const [added, setAdded] = useState(false);
  return (
    <div className="doc-actions">
      <button
        type="button"
        className="btn go"
        onClick={() => {
          addToShelf({ ...build(), name: title });
          setAdded(true);
          if (screen === 'game') {
            openWorkshop();
            closeDocs();
          }
        }}
      >
        Open a copy in the Workshop
      </button>
      <button type="button" className="btn" onClick={() => tryMechanic(title, build())} title="Runs only this mechanic in the testbench; your equipped mechanics are untouched">
        Try it in the testbench
      </button>
      {added && screen !== 'game' && <span className="doc-note">Added to your shelf.</span>}
    </div>
  );
}

function BlockPage({ type, go }: { type: string; go: (r: DocRoute) => void }) {
  const ref = referenceFor(type);
  const ex = useMemo(() => blockExample(type), [type]);
  if (!ref) return <p>Unknown block.</p>;
  const d = ref.doc;
  return (
    <article className="doc-ref">
      <div className="doc-ref-head">
        <BlockPreview type={type} />
        <div>
          <h2>{ref.label}</h2>
          <p className="doc-meta">
            {ref.category} · available {tierName(ref.tier)} · in Blueprint Blocks: “{ref.blueprintTitle}”
          </p>
        </div>
      </div>
      <p className="doc-summary">{d.summary}</p>
      <p>{d.details}</p>
      <h3>When it runs</h3>
      <p>{d.when}</p>
      <h3>How it runs</h3>
      <p>{d.behavior}</p>
      {ref.rows.length > 0 && (
        <>
          <h3>Inputs, outputs and settings</h3>
          <div className="doc-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Type</th>
                  <th>Default</th>
                  <th>What it means</th>
                </tr>
              </thead>
              <tbody>
                {ref.rows.map((r) => (
                  <tr key={`${r.kind}:${r.id}`}>
                    <td>{r.label}</td>
                    <td>{r.kind === 'flow' ? 'flow out' : r.kind}</td>
                    <td>{r.type === 'choice' ? `one of: ${r.options?.join(', ')}` : r.type}</td>
                    <td>{r.defaultText ?? '—'}</td>
                    <td>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3>Side effects</h3>
      <p>{d.sideEffects}</p>
      <h3>Equivalent Exchange</h3>
      <p>{d.cost}</p>
      <PriceTable type={type} />
      <h3>Common mistakes</h3>
      <ul>
        {d.mistakes.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
      <h3>Limitations</h3>
      <p>{d.limitations}</p>
      {d.scratchDiff && (
        <>
          <h3>If you know Scratch</h3>
          <p>{d.scratchDiff}</p>
        </>
      )}
      <h3>Example</h3>
      <p className="doc-note">{ex.howTo}</p>
      <PlainReading graph={ex.graph} />
      <TryButtons title={`${ref.label} example`} build={() => blockExample(type).graph} />
      {d.related && d.related.length > 0 && (
        <>
          <h3>Related</h3>
          <p className="doc-related">
            {d.related.map((r) => (
              <button key={r} type="button" className="doc-link k-block" onClick={() => go({ kind: 'block', type: r })}>
                {getPrimitive(r)?.label ?? r}
              </button>
            ))}
          </p>
        </>
      )}
    </article>
  );
}

function ExamplePage({ id, go }: { id: string; go: (r: DocRoute) => void }) {
  const ex = EXAMPLE_BY_ID[id];
  const graph = useMemo(() => ex?.build(), [ex]);
  if (!ex || !graph) return <p>Unknown example.</p>;
  return (
    <article>
      <h2>{ex.title}</h2>
      <p className="doc-summary">{ex.summary}</p>
      <p className="doc-note">
        <strong>Try:</strong> {ex.keys}
      </p>
      <Markup src={ex.explain} go={go} />
      <h3>In plain words</h3>
      <PlainReading graph={graph} />
      <TryButtons title={ex.title} build={ex.build} />
    </article>
  );
}

function Examples({ go }: { go: (r: DocRoute) => void }) {
  return (
    <article>
      <h2>Examples</h2>
      <p>Each is an ordinary mechanic built from blocks. Open a copy to read or change it in either editor, or try it in the testbench.</p>
      <ul className="doc-cards">
        {EXAMPLES.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => go({ kind: 'example', id: e.id })}>
              <strong>{e.title}</strong>
              <span>{e.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Index({ go }: { go: (r: DocRoute) => void }) {
  return (
    <article>
      <h2>SPLICE Docs</h2>
      <p>Everything here is generated from, or checked against, the game’s own engine: block defaults come from the blocks themselves, and every price is computed with the formulas the exchange charges with.</p>
      <ul className="doc-cards">
        {ARTICLES.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => go({ kind: 'article', id: a.id })}>
              <strong>{a.title}</strong>
              <span>{a.summary}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => go({ kind: 'examples' })}>
            <strong>Examples</strong>
            <span>{EXAMPLES.length} working mechanics to read, copy and try.</span>
          </button>
        </li>
      </ul>
    </article>
  );
}

export function DocsPanel() {
  const docs = useApp((s) => s.docs);
  const openDocs = useApp((s) => s.openDocs);
  const back = useApp((s) => s.docsBack);
  const close = useApp((s) => s.closeDocs);
  const [q, setQ] = useState('');
  const main = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchDocs(q), [q]);
  const go = (r: DocRoute) => {
    setQ('');
    openDocs(r);
  };
  const route = docs.route;
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [route]);
  useEffect(() => {
    search.current?.focus();
  }, []);

  const isOn = (r: DocRoute) => JSON.stringify(r) === JSON.stringify(route);
  let content: React.ReactNode;
  if (q.trim())
    content = (
      <article>
        <h2>Results for “{q}”</h2>
        {results.length === 0 && <p>Nothing matches. Try fewer or different words.</p>}
        <ul className="doc-results">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => go(r.route)}>
                <span className="doc-kind">{r.kind}</span>
                <strong>{r.title}</strong>
                <span>{r.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </article>
    );
  else if (route.kind === 'article') {
    const a = ARTICLE_BY_ID[route.id];
    content = a ? <Markup src={a.body} go={go} /> : <p>Unknown article.</p>;
  } else if (route.kind === 'block') content = <BlockPage type={route.type} go={go} />;
  else if (route.kind === 'example') content = <ExamplePage id={route.id} go={go} />;
  else if (route.kind === 'examples') content = <Examples go={go} />;
  else content = <Index go={go} />;

  return (
    <div
      className="docs"
      role="dialog"
      aria-label="SPLICE Docs"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="docs-head">
        <button type="button" className="docs-title" onClick={() => go({ kind: 'index' })}>
          SPLICE Docs
        </button>
        <input ref={search} className="docs-search" placeholder="Search blocks, topics and examples" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the docs" />
        <button type="button" className="btn small quiet" onClick={back} disabled={!docs.history.length}>
          Back
        </button>
        <button type="button" className="btn small" onClick={close} title="Close (Esc)">
          Close
        </button>
      </header>
      <nav className="docs-nav" aria-label="Docs sections">
        <h4>Guides</h4>
        {ARTICLES.map((a) => (
          <button key={a.id} type="button" className={isOn({ kind: 'article', id: a.id }) ? 'on' : ''} onClick={() => go({ kind: 'article', id: a.id })}>
            {a.title}
          </button>
        ))}
        <button type="button" className={route.kind === 'examples' || route.kind === 'example' ? 'on' : ''} onClick={() => go({ kind: 'examples' })}>
          Examples
        </button>
        <h4>Block reference</h4>
        {CATEGORY_ORDER.map((cat) => (
          <details key={cat} open={route.kind === 'block' && getPrimitive(route.type)?.category === cat}>
            <summary className={`cat-${cat}`}>{CATEGORY_INFO[cat].label}</summary>
            {PRIMITIVES.filter((p) => p.category === cat).map((p) => (
              <button key={p.type} type="button" className={isOn({ kind: 'block', type: p.type }) ? 'on' : ''} onClick={() => go({ kind: 'block', type: p.type })}>
                {p.label}
              </button>
            ))}
          </details>
        ))}
      </nav>
      <main className="docs-main" ref={main} tabIndex={-1}>
        {content}
      </main>
    </div>
  );
}
