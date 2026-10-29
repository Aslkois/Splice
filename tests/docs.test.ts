import { describe, expect, it } from 'vitest';
import { ARTICLE_BY_ID, ARTICLES } from '../src/docs/articles';
import { BLOCK_DOCS } from '../src/docs/blockDocs';
import { blockExample } from '../src/docs/blockExamples';
import { EXAMPLE_BY_ID, EXAMPLES } from '../src/docs/examples';
import { linksIn, parseMarkup } from '../src/docs/markup';
import { DOC_NUMBERS, fillNumbers } from '../src/docs/numbers';
import { formatDefault, referenceFor } from '../src/docs/reference';
import { attachMechanics } from '../src/mechanics/builder';
import { compileGraph } from '../src/mechanics/compile';
import { getPrimitive, PRIMITIVES } from '../src/mechanics/registry';
import { toScratch } from '../src/mechanics/scratch';
import type { MechanicGraph } from '../src/mechanics/schema';
import { quoteImpulse } from '../src/sim/exchange/formulas';
import { DEFAULT_EXCHANGE } from '../src/sim/exchange/table';
import { TESTBENCH } from '../src/sim/levels/levels';
import { World } from '../src/sim/World';
import { ScriptedInput } from '../src/sim/input';

/** Runs a mechanic in the testbench pressing the given keys; returns runtime problems. */
function exercise(g: MechanicGraph, keys: string[][]): string[] {
  const w = new World({ level: TESTBENCH, mode: 'sandbox', lawEnabled: true, seed: 5 });
  const { rejected } = attachMechanics(w, [g]);
  if (rejected.length) return rejected.flatMap((r) => r.issues.filter((i) => i.severity === 'error').map((i) => i.message));
  const input = new ScriptedInput();
  for (const k of keys) for (let i = 0; i < 20; i++) w.step(input.frame(k));
  for (let i = 0; i < 60; i++) w.step(input.frame([]));
  return w.diagnostics.filter((d) => /errored|stopped/.test(d.message)).map((d) => d.message);
}

describe('documentation coverage', () => {
  for (const def of PRIMITIVES) {
    it(`${def.type} is fully documented`, () => {
      const d = BLOCK_DOCS[def.type];
      expect(d, 'missing BLOCK_DOCS entry').toBeTruthy();
      for (const f of ['summary', 'details', 'when', 'behavior', 'sideEffects', 'cost', 'limitations'] as const) expect(d[f].trim().length, f).toBeGreaterThan(2);
      expect(d.mistakes.length).toBeGreaterThan(0);
      const ids = [...(def.params ?? []).map((p) => p.id), ...(def.inputs ?? []).map((p) => p.id), ...(def.outputs ?? []).map((p) => p.id), ...(def.execOut ?? []).map((p) => p.id)];
      for (const id of ids) expect(d.ports[id]?.trim().length ?? 0, `port ${id}`).toBeGreaterThan(2);
      for (const id of Object.keys(d.ports)) expect(ids, `stale port doc ${id}`).toContain(id);
      for (const r of d.related ?? []) expect(getPrimitive(r), `related ${r}`).toBeTruthy();
    });
  }

  it('no docs for blocks that do not exist', () => {
    for (const t of Object.keys(BLOCK_DOCS)) expect(getPrimitive(t), t).toBeTruthy();
  });

  it('reference defaults are read from the registry', () => {
    for (const def of PRIMITIVES) {
      const ref = referenceFor(def.type)!;
      for (const p of def.inputs ?? []) expect(ref.rows.find((r) => r.id === p.id && r.kind === 'input')?.defaultText).toBe(formatDefault(p.type, p.default));
      for (const p of def.params ?? []) {
        const row = ref.rows.find((r) => r.id === p.id && r.kind === 'param')!;
        expect(row.defaultText).toBe(p.options?.find((o) => o.value === p.default)?.label ?? String(p.default));
      }
    }
  });
});

describe('every block has a working example', () => {
  for (const def of PRIMITIVES) {
    it(`${def.type}`, () => {
      const ex = blockExample(def.type);
      expect(ex.graph.nodes.some((n) => n.type === def.type)).toBe(true);
      const c = compileGraph(ex.graph);
      expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
      // it can be opened in either editor
      expect(toScratch(ex.graph).ok).toBe(true);
      expect(exercise(ex.graph, [['Q'], ['F'], ['Q', 'F'], []])).toEqual([]);
    });
  }
});

describe('worked examples', () => {
  it('cover the requested topics', () => {
    const want = [
      'basic-jump', 'double-jump', 'air-dash', 'charged-attack', 'progressive-charge', 'overcap-attack', 'interruptible-windup',
      'energy-collection', 'movement-input', 'toggle-ability', 'timed-block', 'cooldown', 'projectile-spawner',
      'conditional-reflection', 'energy-consumption', 'resource-accumulator', 'multi-condition',
    ];
    expect(EXAMPLES.map((e) => e.id).sort()).toEqual(want.sort());
  });
  for (const ex of EXAMPLES) {
    it(`${ex.title}: compiles, opens in both editors, runs`, () => {
      const g = ex.build();
      expect(compileGraph(g).issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(toScratch(g).ok).toBe(true);
      expect(exercise(g, [['Q'], ['Space'], ['Space'], ['F'], ['G'], ['W'], ['Z'], ['MouseLeft'], ['C']])).toEqual([]);
    });
  }
  it('none of them gives away the lethal-hit defence', () => {
    for (const ex of EXAMPLES) {
      const g = ex.build();
      const types = new Set(g.nodes.map((n) => n.type));
      expect(types.has('act.reflect') && types.has('act.prevent'), ex.id).toBe(false);
    }
  });
});

describe('articles', () => {
  it('every figure and every link resolves', () => {
    for (const a of ARTICLES) {
      expect(fillNumbers(a.body), a.id).not.toMatch(/\{\{\w+\}\}/);
      for (const l of linksIn(parseMarkup(a.body))) {
        if (l.kind === 'block') expect(getPrimitive(l.id), `${a.id} → ${l.id}`).toBeTruthy();
        if (l.kind === 'article') expect(ARTICLE_BY_ID[l.id], `${a.id} → ${l.id}`).toBeTruthy();
        if (l.kind === 'example') expect(EXAMPLE_BY_ID[l.id], `${a.id} → ${l.id}`).toBeTruthy();
      }
    }
    for (const ex of EXAMPLES) expect(fillNumbers(ex.explain), ex.id).not.toMatch(/\{\{\w+\}\}/);
  });

  it('quoted prices are what the ledger charges', () => {
    // an air jump to 600 px/s from rest, done for real
    const w = new World({ level: TESTBENCH, mode: 'sandbox', lawEnabled: true, seed: 1 });
    attachMechanics(w, [EXAMPLE_BY_ID['basic-jump'].build()]);
    const input = new ScriptedInput();
    for (let i = 0; i < 30; i++) w.step(input.frame([]));
    w.step(input.frame(['W']));
    const txn = w.exchange.log.find((t) => t.label === 'Impulse' && t.ok)!;
    expect(Math.round(txn.energy * 10) / 10).toBeCloseTo(DOC_NUMBERS.jumpCost760, 1);
    const q = quoteImpulse(DEFAULT_EXCHANGE, { mass: 1, velocity: { x: 0, y: 0 }, impulse: { x: 0, y: -600 }, self: true, distance: 0, maxSpeed: 4200 });
    expect(DOC_NUMBERS.dj600Apex).toBeCloseTo(q.energy, 1);
    expect(DOC_NUMBERS.split32).toBeCloseTo(DOC_NUMBERS.whole800, 1);
  });
});
