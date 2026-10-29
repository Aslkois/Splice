import { describe, expect, it } from 'vitest';
import { attachMechanics, GraphBuilder } from '../src/mechanics/builder';
import { compileGraph } from '../src/mechanics/compile';
import { PRIMITIVES } from '../src/mechanics/registry';
import { Walker } from '../src/sim/entities/enemies';
import { Crate, Target } from '../src/sim/entities/props';
import { Driver, makeWorld } from './helpers';

const SINK: Record<string, { type: string; port: string }> = {
  number: { type: 'var.setNumber', port: 'value' },
  boolean: { type: 'var.setFlag', port: 'value' },
  vector: { type: 'var.setVector', port: 'value' },
  entity: { type: 'var.setEntity', port: 'value' },
};

/** Every primitive, wired the simplest possible way and executed, must not throw. */
describe('every primitive executes without errors', () => {
  for (const def of PRIMITIVES) {
    it(def.type, () => {
      const b = new GraphBuilder(`smoke ${def.type}`);
      if (def.event) {
        const n = b.node(def.type, def.type === 'on.keyPressed' || def.type === 'on.keyHeld' || def.type === 'on.keyReleased' ? { key: 'Q' } : {});
        const add = b.node('var.addNumber', { name: 'fired' });
        b.flow(n, 'then', add);
        for (const out of def.outputs ?? []) {
          const sink = SINK[out.type];
          const s = b.node(sink.type, { name: `o_${out.id}` });
          b.flow(add, 'then', s);
          b.wire(n, out.id, s, sink.port);
          break;
        }
      } else if (def.execIn) {
        const ev = b.node('on.keyPressed', { key: 'Q' });
        const n = b.node(def.type);
        b.flow(ev, 'then', n);
        for (const out of def.execOut ?? []) {
          const add = b.node('var.addNumber', { name: `after_${out.id}` });
          b.flow(n, out.id, add);
        }
      } else {
        const ev = b.node('on.keyPressed', { key: 'Q' });
        const n = b.node(def.type);
        let prev = ev;
        let prevPort = 'then';
        for (const out of def.outputs ?? []) {
          const sink = SINK[out.type];
          const s = b.node(sink.type, { name: `o_${out.id}` });
          b.flow(prev, prevPort, s);
          b.wire(n, out.id, s, sink.port);
          prev = s;
          prevPort = 'then';
        }
      }
      const g = b.build();
      const compiled = compileGraph(g);
      expect(compiled.issues.filter((i) => i.severity === 'error')).toEqual([]);

      const w = makeWorld();
      w.add(new Crate(520, 570));
      w.add(new Target(700, 570, 50));
      w.add(new Walker(1500, 560));
      attachMechanics(w, [g]);
      const d = new Driver(w);
      d.run(0.3);
      d.tap('Q', 2, ['F']);
      w.combat.hazard(w.player!, w.player!.pos, 5);
      w.mechanics!.fire('custom', { name: 'Ping', value: 1 });
      d.run(1.5, ['F']);
      expect(w.diagnostics.filter((x) => x.message.includes('errored'))).toEqual([]);
    });
  }
});
