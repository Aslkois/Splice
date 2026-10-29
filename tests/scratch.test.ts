import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import { compileGraph } from '../src/mechanics/compile';
import { missingPresentations, parseTemplate, presentationOf } from '../src/mechanics/presentation';
import { PRIMITIVES } from '../src/mechanics/registry';
import { applyScratch, deriveExecEdges, detach, insert, removeBlock, toScratch } from '../src/mechanics/scratch';
import type { MechanicGraph } from '../src/mechanics/schema';
import { deserializeGraph, migrateGraph } from '../src/mechanics/serialize';
import { Driver, makeWorld } from './helpers';
import { addShooter, blockOnly, deathParry, fireSlug, reflectAlways } from './fixtures';

const flowKey = (g: MechanicGraph) =>
  g.edges
    .map((e) => `${e.from}|${e.fromPort}>${e.to}|${e.toPort}`)
    .sort()
    .join('\n');

function roundTrip(g: MechanicGraph): MechanicGraph {
  const r = toScratch(g);
  if (!r.ok) throw new Error(r.problems.join('; '));
  return applyScratch(g, r.view);
}

function nestedIfs(): MechanicGraph {
  const b = new GraphBuilder('Nested');
  const ev = b.node('on.keyPressed', { key: 'Q' });
  const g1 = b.node('state.grounded');
  const if1 = b.node('flow.if');
  const if2 = b.node('flow.if');
  const held = b.node('state.keyHeld', { key: 'D' });
  const a = b.node('var.addNumber', { name: 'a' });
  const c = b.node('var.addNumber', { name: 'c' });
  const d = b.node('var.addNumber', { name: 'd' });
  b.flow(ev, 'then', if1).wire(g1, 'out', if1, 'cond');
  b.flow(if1, 'then', if2).wire(held, 'out', if2, 'cond');
  b.flow(if2, 'then', a).flow(a, 'then', c);
  b.flow(if2, 'else', c);
  b.flow(if1, 'else', c);
  b.flow(c, 'then', d);
  return b.build();
}

describe('presentation metadata', () => {
  it('every primitive has a Scratch template that exposes all its params and inputs exactly once', () => {
    expect(missingPresentations()).toEqual([]);
    for (const def of PRIMITIVES) {
      const parts = parseTemplate(presentationOf(def.type).scratch.text);
      for (const p of def.params ?? []) expect(parts.filter((x) => x.kind === 'param' && x.id === p.id), `${def.type} param ${p.id}`).toHaveLength(1);
      for (const p of def.inputs ?? []) expect(parts.filter((x) => x.kind === 'input' && x.id === p.id), `${def.type} input ${p.id}`).toHaveLength(1);
      const known = new Set([...(def.params ?? []).map((p) => p.id), ...(def.inputs ?? []).map((p) => p.id)]);
      for (const x of parts) if (x.kind === 'param' || x.kind === 'input') expect(known.has(x.id), `${def.type} unknown ${x.id}`).toBe(true);
      const spec = presentationOf(def.type).scratch;
      const outs = new Set(def.execOut?.map((e) => e.id) ?? []);
      for (const m of spec.mouths) expect(outs.has(m.port), `${def.type} mouth ${m.port}`).toBe(true);
      // every flow output is either the continuation or a mouth
      for (const o of outs) expect(spec.continuation === o || spec.mouths.some((m) => m.port === o), `${def.type} output ${o}`).toBe(true);
    }
  });
});

describe('graph ⇄ Scratch Blocks', () => {
  const graphs: [string, () => MechanicGraph][] = [
    ['death parry', () => deathParry()],
    ['block only', blockOnly],
    ['reflect always', () => reflectAlways()],
    ['nested ifs with joins', nestedIfs],
  ];
  for (const [name, make] of graphs) {
    it(`${name}: Blueprint → Scratch → Blueprint keeps every wire`, () => {
      const g = make();
      expect(flowKey(roundTrip(g))).toEqual(flowKey(g));
    });
  }

  it('nested conditionals become nested C-blocks with a shared continuation', () => {
    const g = nestedIfs();
    const r = toScratch(g);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const script = r.view.tops.find((t) => t.hat)!;
    // if1 then c then d at the top level of the script
    expect(script.body.map((b) => g.nodes.find((n) => n.id === b.node)!.type)).toEqual(['flow.if', 'var.addNumber', 'var.addNumber']);
    const if1 = script.body[0];
    expect(if1.mouths.then.map((b) => g.nodes.find((n) => n.id === b.node)!.type)).toEqual(['flow.if']);
    expect(if1.mouths.else).toEqual([]);
    expect(if1.mouths.then[0].mouths.then).toHaveLength(1);
  });

  it('Scratch → Blueprint → Scratch keeps the same stacks', () => {
    const g = deathParry();
    const r1 = toScratch(g);
    if (!r1.ok) throw new Error('unexpected');
    const g2 = applyScratch(g, r1.view);
    const r2 = toScratch(g2);
    expect(r2.ok && JSON.stringify(r2.view)).toEqual(JSON.stringify(r1.view));
  });

  it('round-tripped mechanics behave identically', () => {
    const run = (graph: MechanicGraph) => {
      const w = makeWorld();
      attachMechanics(w, [graph]);
      const d = new Driver(w);
      d.run(0.5);
      const shooter = addShooter(w, 900, 560);
      fireSlug(w, shooter.id, 780, 570);
      for (let i = 0; i < 11; i++) w.step(d.frame([]));
      for (let i = 0; i < 60; i++) w.step(d.frame(['F']));
      return { alive: w.player!.alive, hp: w.player!.hp, shooter: shooter.alive, log: w.exchange.log.map((t) => `${t.label}:${t.ok}`) };
    };
    const g = deathParry();
    expect(run(roundTrip(roundTrip(g)))).toEqual(run(g));
  });

  it('explains graphs that stacked blocks cannot show, and leaves them unchanged', () => {
    // a flow loop
    const b = new GraphBuilder('Loop');
    const ev = b.node('on.keyPressed');
    const add = b.node('var.addNumber');
    b.flow(ev, 'then', add).flow(add, 'then', add);
    const loop = b.build();
    const r = toScratch(loop);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatch(/loops back/);

    // one chain shared by two scripts
    const s = new GraphBuilder('Shared');
    const e1 = s.node('on.keyPressed', { key: 'Q' });
    const e2 = s.node('on.keyPressed', { key: 'R' });
    const shared = s.node('var.addNumber');
    s.flow(e1, 'then', shared).flow(e2, 'then', shared);
    const r2 = toScratch(s.build());
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.problems.join(' ')).toMatch(/only one script/);

    // a failure path that rejoins the main stack
    const f = new GraphBuilder('Rejoin');
    const ev3 = f.node('on.keyPressed');
    const imp = f.node('act.impulse');
    const fallback = f.node('fx.sound');
    const after = f.node('var.addNumber');
    f.flow(ev3, 'then', imp).flow(imp, 'then', after).flow(imp, 'failed', fallback).flow(fallback, 'then', after);
    const g3 = f.build();
    const before = JSON.stringify(g3);
    const r3 = toScratch(g3);
    expect(r3.ok).toBe(false);
    expect(JSON.stringify(g3)).toEqual(before);
  });

  it('structural edits: insert into a mouth, after a block, and remove a block', () => {
    const b = new GraphBuilder('Edit');
    const ev = b.node('on.keyPressed', { key: 'Q' });
    const iff = b.node('flow.if');
    const x = b.node('var.addNumber', { name: 'x' });
    const y = b.node('var.addNumber', { name: 'y' });
    b.flow(ev, 'then', iff);
    let g = b.build();
    let r = toScratch(g);
    if (!r.ok) throw new Error('bad');
    // x and y start as loose stacks
    expect(r.view.tops.filter((t) => !t.hat)).toHaveLength(2);
    // put x into the if's then-mouth
    const dx = detach(r.view, x)!;
    const ins = insert(g, dx.view, dx.fragment, { kind: 'mouth', node: iff, port: 'then' });
    expect(ins.ok).toBe(true);
    if (!ins.ok) return;
    // put y after the if: it becomes the join
    const dy = detach(ins.view, y)!;
    const ins2 = insert(g, dy.view, dy.fragment, { kind: 'after', node: iff });
    expect(ins2.ok).toBe(true);
    if (!ins2.ok) return;
    g = applyScratch(g, ins2.view);
    const keys = g.edges.map((e) => `${e.fromPort}>${g.nodes.find((n) => n.id === e.to)!.params.name ?? 'if'}`).sort();
    expect(keys).toEqual(['else>y', 'then>if', 'then>x', 'then>y'].sort());
    expect(compileGraph(g).ok).toBe(true);
    // remove the if: x is removed with it, y closes the gap under the hat
    r = toScratch(g);
    if (!r.ok) throw new Error('bad');
    const rm = removeBlock(g, r.view, iff);
    expect('removed' in rm && rm.removed.sort()).toEqual([iff, x].sort());
    if ('removed' in rm) {
      const g2 = applyScratch(g, rm.view);
      expect(deriveExecEdges(g2, rm.view)).toEqual([{ from: ev, fromPort: 'then', to: y }]);
    }
  });

  it('refuses to put blocks under a stack-ending block', () => {
    const b = new GraphBuilder('Cap');
    const ev = b.node('on.keyPressed');
    const seq = b.node('flow.sequence');
    const x = b.node('var.addNumber');
    b.flow(ev, 'then', seq);
    const g = b.build();
    const r = toScratch(g);
    if (!r.ok) throw new Error('bad');
    const dx = detach(r.view, x)!;
    const res = insert(g, dx.view, dx.fragment, { kind: 'after', node: seq });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ends its stack/);
  });
});

describe('save format migration', () => {
  it('schema 1 mechanics load, keep their canvas order as explicit run order, and behave the same', () => {
    const v1 = {
      schema: 1,
      id: 'm-old',
      name: 'Old Save',
      color: '#ff7a3d',
      created: 1,
      updated: 1,
      nodes: [
        { id: 'late', type: 'on.keyPressed', x: 0, y: 300, params: { key: 'Q' } },
        { id: 'early', type: 'on.keyPressed', x: 0, y: 0, params: { key: 'Q' } },
        { id: 'setLate', type: 'var.setNumber', x: 300, y: 300, params: { name: 'last', scope: 'character', value: 2 } },
        { id: 'setEarly', type: 'var.setNumber', x: 300, y: 0, params: { name: 'last', scope: 'character', value: 1 } },
      ],
      edges: [
        { id: 'a', from: 'late', fromPort: 'then', to: 'setLate', toPort: 'in' },
        { id: 'b', from: 'early', fromPort: 'then', to: 'setEarly', toPort: 'in' },
      ],
    };
    const g = migrateGraph(v1);
    expect(g.schema).toBe(2);
    expect(g.nodes.map((n) => n.id)).toEqual(['early', 'setEarly', 'late', 'setLate']);
    expect(g.layout.blueprint.late).toEqual({ x: 0, y: 300 });
    expect('x' in g.nodes[0]).toBe(false);
    // canvas order was early-then-late, so "last" ends as 2 — same as schema 1 behaviour
    const w = makeWorld();
    const { host } = attachMechanics(w, [g]);
    const d = new Driver(w);
    d.run(0.2);
    d.tap('Q', 1);
    expect(host.characterScope.numbers.get('last')).toBe(2);
    // and it survives serialisation as schema 2
    expect(deserializeGraph(JSON.stringify(g))).toEqual(g);
  });
});
