import { describe, expect, it } from 'vitest';
import { EXAMPLE_BY_ID } from '../src/docs/examples';
import { attachMechanics } from '../src/mechanics/builder';
import { inspectCost, REST_STATE, type PlayerState } from '../src/mechanics/costInspector';
import { explainMechanic } from '../src/mechanics/explain';
import { getPrimitive, nodeTitle } from '../src/mechanics/registry';
import { Target } from '../src/sim/entities/props';
import { Driver, makeWorld } from './helpers';

const lineValue = (c: ReturnType<typeof inspectCost>, label: string) => Number(c!.lines.find((l) => l.label === label)!.value.split(' ')[0]);

describe('cost inspector shows what the ledger charges', () => {
  it('an air jump from rest', () => {
    const g = EXAMPLE_BY_ID['basic-jump'].build();
    const jump = g.nodes.find((n) => n.type === 'act.setVelocity')!;
    const c = inspectCost(g, jump.id, REST_STATE)!;
    const w = makeWorld();
    attachMechanics(w, [g]);
    const d = new Driver(w);
    d.run(0.4);
    d.tap('W', 1);
    const txn = w.exchange.log.find((t) => t.label === 'Impulse' && t.ok)!;
    expect(lineValue(c, 'Effective energy requirement')).toBeCloseTo(txn.energy, 1);
    expect(c.status.tone).toBe('ok');
  });

  it('a strike after a 1.5 s windup', () => {
    const g = EXAMPLE_BY_ID['interruptible-windup'].build();
    const strike = g.nodes.find((n) => n.type === 'act.strike')!;
    const c = inspectCost(g, strike.id, REST_STATE)!;
    const w = makeWorld();
    attachMechanics(w, [g]);
    const d = new Driver(w);
    d.run(0.4);
    w.add(new Target(470, 570, 1000));
    d.tap('Q', 1);
    d.run(1.7);
    const txn = w.exchange.log.find((t) => t.label === 'Strike' && t.ok)!;
    expect(lineValue(c, 'Base energy requirement')).toBeCloseTo(40, 5);
    expect(lineValue(c, 'Effective energy requirement')).toBeCloseTo(txn.energy, 1);
  });

  it('explains why something cannot run', () => {
    const g = EXAMPLE_BY_ID['overcap-attack'].build();
    const shot = g.nodes.find((n) => n.type === 'act.projectile')!;
    const channel = g.nodes.find((n) => n.type === 'act.channelUntil')!;
    const poor: PlayerState = { ...REST_STATE, energy: 40 };
    expect(inspectCost(g, channel.id, poor)!.status.tone).toBe('bad');
    const rich: PlayerState = { ...REST_STATE, energy: 40, supply: { dynamoInRange: 400, cellsLeft: 0, cellEnergy: 35 } };
    expect(inspectCost(g, channel.id, rich)!.status.tone).toBe('warn');
    // The shot itself is funded by the 250 E the channel releases.
    const s = inspectCost(g, shot.id, poor)!;
    expect(s.status.tone).toBe('ok');
    expect(lineValue(s, 'Effective energy requirement')).toBeLessThan(250);
    // Without a charge in front, the same shot would need more than a reservoir.
    const bare = { ...g, edges: g.edges.filter((e) => e.to !== shot.id || e.toPort !== 'in') };
    expect(inspectCost(bare, shot.id, poor)!.status.text).toMatch(/more than your reservoir holds/);
  });
});

describe('Explain Mechanic', () => {
  it('is deterministic and mentions every block that can run', () => {
    for (const id of Object.keys(EXAMPLE_BY_ID)) {
      const g = EXAMPLE_BY_ID[id].build();
      const a = explainMechanic(g);
      const b = explainMechanic(g);
      expect(a).toEqual(b);
      const described = new Set(a.map((l) => l.node).filter(Boolean));
      for (const n of g.nodes) {
        const def = getPrimitive(n.type)!;
        if (def.execIn || def.event) expect(described.has(n.id), `${id}: ${nodeTitle(def, n.params)}`).toBe(true);
      }
    }
  });
});
