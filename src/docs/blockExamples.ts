import { GraphBuilder } from '../mechanics/builder';
import { getPrimitive } from '../mechanics/registry';
import type { MechanicGraph, ParamValue } from '../mechanics/schema';

/**
 * A small working mechanic for every block, built exactly the way a player would wire it. The docs
 * offer each one to open in either editor or try in the testbench; the coverage test compiles and
 * runs every one of them on the real runtime.
 */
export interface BlockExample {
  graph: MechanicGraph;
  /** What to press and what to watch for. */
  howTo: string;
}

type Build = (b: GraphBuilder, self: (params?: Record<string, ParamValue>) => string) => string | void;

/** Raise the guard on F, lower it on release. */
function guardOnF(b: GraphBuilder): void {
  const press = b.node('on.keyPressed', { key: 'F' });
  const raise = b.node('act.block');
  b.flow(press, 'then', raise);
  const rel = b.node('on.keyReleased', { key: 'F' });
  const lower = b.node('act.unblock');
  b.flow(rel, 'then', lower);
}

/** Store a reporter's value somewhere you can watch it (the debugger's Variables tab). */
function store(b: GraphBuilder, from: string, port: string, type: string, after: string, afterPort = 'then'): void {
  const t = type === 'boolean' ? 'var.setFlag' : type === 'vector' ? 'var.setVector' : type === 'entity' ? 'var.setEntity' : 'var.setNumber';
  const set = b.node(t, { name: 'result', scope: 'character' });
  b.flow(after, afterPort, set).wire(from, port, set, 'value');
}

const EXAMPLES: Record<string, { build: Build; howTo: string }> = {
  'on.keyReleased': {
    howTo: 'Hold Q, let go: “held” records how long you held it.',
    build: (b, self) => {
      const ev = self({ key: 'Q' });
      const set = b.node('var.setNumber', { name: 'held', scope: 'character' });
      b.flow(ev, 'then', set).wire(ev, 'heldFor', set, 'value');
    },
  },
  'on.keyHeld': {
    howTo: 'Hold Q: a gentle upward force every tick — a jetpack.',
    build: (b, self) => {
      const ev = self({ key: 'Q' });
      const f = b.node('act.force', { force: { x: 0, y: -2600 } });
      b.flow(ev, 'then', f);
    },
  },
  'on.tick': {
    howTo: 'Watch “seconds alive” grow in the Variables tab.',
    build: (b, self) => {
      const ev = self();
      const add = b.node('var.addNumber', { name: 'seconds alive', scope: 'character' });
      b.flow(ev, 'then', add).wire(ev, 'dt', add, 'value');
    },
  },
  'on.landing': {
    howTo: 'Jump and land: “fall speed” records how hard.',
    build: (b, self) => {
      const ev = self();
      const set = b.node('var.setNumber', { name: 'fall speed', scope: 'character' });
      b.flow(ev, 'then', set).wire(ev, 'fallSpeed', set, 'value');
    },
  },
  'on.collision': {
    howTo: 'Walk into a crate: a clang plays.',
    build: (b, self) => {
      const ev = self({ filter: 'crate' });
      const s = b.node('fx.sound', { sound: 'clang' });
      b.flow(ev, 'then', s);
    },
  },
  'on.incomingHit': {
    howTo: 'Stand in front of the turret: “last hit” records each hit’s damage before it lands.',
    build: (b, self) => {
      const ev = self();
      const set = b.node('var.setNumber', { name: 'last hit', scope: 'character' });
      b.flow(ev, 'then', set).wire(ev, 'damage', set, 'value');
    },
  },
  'on.successfulBlock': {
    howTo: 'Hold F as a turret bolt arrives: a chime plays when the guard catches it.',
    build: (b, self) => {
      guardOnF(b);
      const ev = self();
      const s = b.node('fx.sound', { sound: 'chime' });
      b.flow(ev, 'then', s);
    },
  },
  'on.hitResolved': {
    howTo: 'Get hit by a turret bolt: “damage taken” records what actually landed.',
    build: (b, self) => {
      const ev = self();
      const set = b.node('var.setNumber', { name: 'damage taken', scope: 'character' });
      b.flow(ev, 'then', set).wire(ev, 'damage', set, 'value');
    },
  },
  'on.damageTaken': {
    howTo: 'Get hit: a low boom plays after the damage.',
    build: (b, self) => {
      const ev = self();
      const s = b.node('fx.sound', { sound: 'boom', pitch: 0.5 });
      b.flow(ev, 'then', s);
    },
  },
  'on.timerElapsed': {
    howTo: 'Press Q: a chime plays one second later.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const st = b.node('timer.start', { name: 'Later', duration: 1 });
      b.flow(ev, 'then', st);
      const h = self({ name: 'Later' });
      const s = b.node('fx.sound');
      b.flow(h, 'then', s);
    },
  },
  'on.entityDestroyed': {
    howTo: 'Break the target: a chime plays.',
    build: (b, self) => {
      const ev = self({ filter: 'target' });
      const s = b.node('fx.sound');
      b.flow(ev, 'then', s);
    },
  },
  'on.signal': {
    howTo: 'Press Q: one script sends “Ping”, another hears it and plays a chime.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const em = b.node('flow.emit', { name: 'Ping', value: 1 });
      b.flow(ev, 'then', em);
      const h = self({ name: 'Ping' });
      const s = b.node('fx.sound');
      b.flow(h, 'then', s);
    },
  },
  'on.chargeInterrupted': {
    howTo: 'Press Q to start charging, then take a hit: a boom marks the broken channel.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const begin = b.node('act.beginCharge', { name: 'Shot' });
      b.flow(ev, 'then', begin);
      const h = self();
      const s = b.node('fx.sound', { sound: 'boom' });
      b.flow(h, 'then', s);
    },
  },
  'flow.if': {
    howTo: 'Press Q on the ground (chime) and in the air (blip).',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const iff = self();
      const g = b.node('state.grounded');
      b.flow(ev, 'then', iff).wire(g, 'out', iff, 'cond');
      b.flow(iff, 'then', b.node('fx.sound', { sound: 'chime' }));
      b.flow(iff, 'else', b.node('fx.sound', { sound: 'blip' }));
    },
  },
  'flow.sequence': {
    howTo: 'Press Q: three sounds in one tick, in order.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const seq = self();
      b.flow(ev, 'then', seq);
      b.flow(seq, 'a', b.node('fx.sound', { sound: 'chime' }));
      b.flow(seq, 'b', b.node('fx.sound', { sound: 'blip' }));
      b.flow(seq, 'c', b.node('fx.sound', { sound: 'clang' }));
    },
  },
  'flow.cooldown': {
    howTo: 'Mash Q: a hop at most every 0.5 s; a blip when it is cooling down.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const cd = self({ seconds: 0.5 });
      b.flow(ev, 'then', cd);
      b.flow(cd, 'pass', b.node('act.setVelocity', { axes: 'y', velocity: { x: 0, y: -500 } }));
      b.flow(cd, 'blocked', b.node('fx.sound', { sound: 'blip' }));
    },
  },
  'flow.toggle': {
    howTo: 'Press Q repeatedly: “on” flips between true and false.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const t = self();
      b.flow(ev, 'then', t);
      b.flow(t, 'a', b.node('var.setFlag', { name: 'on', scope: 'character', value: true }));
      b.flow(t, 'b', b.node('var.setFlag', { name: 'on', scope: 'character', value: false }));
    },
  },
  'flow.repeat': {
    howTo: 'Press Q: “count” goes up by 3 in a single tick.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const r = self({ count: 3 });
      b.flow(ev, 'then', r);
      b.flow(r, 'body', b.node('var.addNumber', { name: 'count', scope: 'character', value: 1 }));
    },
  },
  'flow.emit': {
    howTo: 'Press Q: the signal is heard by the second script.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const em = self({ name: 'Ping' });
      b.flow(ev, 'then', em);
      const h = b.node('on.signal', { name: 'Ping' });
      b.flow(h, 'then', b.node('fx.sound'));
    },
  },
  'act.strike': {
    howTo: 'Walk up to the target and press Q: 10 damage for 10 E.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const s = self({ amount: 10 });
      const near = b.node('entity.nearest', { filter: 'target', radius: 200 });
      b.flow(ev, 'then', s).wire(near, 'out', s, 'target');
    },
  },
  'act.reflect': {
    howTo: 'Hold F just before a turret bolt arrives: it flies back the way it came.',
    build: (b, self) => {
      guardOnF(b);
      const ev = b.node('on.successfulBlock');
      const r = self();
      b.flow(ev, 'then', r);
    },
  },
  'act.redirect': {
    howTo: 'Hold F as a bolt arrives: it leaves straight up instead.',
    build: (b, self) => {
      guardOnF(b);
      const ev = b.node('on.successfulBlock');
      const r = self({ dir: { x: 0, y: -1 } });
      b.flow(ev, 'then', r);
    },
  },
  'act.prevent': {
    howTo: 'Stand in front of the turret: its bolts deal no damage, and each costs energy.',
    build: (b, self) => {
      const ev = b.node('on.incomingHit');
      const pr = self();
      b.flow(ev, 'then', pr);
    },
  },
  'act.reduce': {
    howTo: 'Get hit: each hit loses up to 5 damage for 1.5 E per point.',
    build: (b, self) => {
      const ev = b.node('on.incomingHit');
      const r = self({ amount: 5 });
      b.flow(ev, 'then', r);
    },
  },
  'act.absorb': {
    howTo: 'Hold F as a bolt arrives: your reservoir refills a little.',
    build: (b, self) => {
      guardOnF(b);
      const ev = b.node('on.successfulBlock');
      const a = self();
      b.flow(ev, 'then', a);
    },
  },
  'act.releaseCharge': {
    howTo: 'Hold Q to charge, release it to fire a shot paid from the charge.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      b.flow(ev, 'then', b.node('act.beginCharge', { name: 'Shot' }));
      const rel = b.node('on.keyReleased', { key: 'Q' });
      const r = self({ name: 'Shot' });
      const shot = b.node('act.projectile', { speed: 1400, mass: 0.3 });
      b.flow(rel, 'then', r).flow(r, 'then', shot);
    },
  },
  'act.holdCharge': {
    howTo: 'Press Q to start charging, G to stop channelling but keep it.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      b.flow(ev, 'then', b.node('act.beginCharge', { name: 'Shot' }));
      const g = b.node('on.keyPressed', { key: 'G' });
      b.flow(g, 'then', self({ name: 'Shot' }));
    },
  },
  'act.channelUntil': {
    howTo: 'Press Q: you channel 60 E (1.5 s), then fire a shot paid from it.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const ch = self({ name: 'Windup', amount: 60 });
      const shot = b.node('act.projectile', { speed: 1600, mass: 0.3 });
      b.flow(ev, 'then', ch).flow(ch, 'charged', shot);
      b.flow(ch, 'interrupted', b.node('fx.sound', { sound: 'boom' }));
    },
  },
  'act.windUp': {
    howTo: 'Press Q: wind up 1 s, then fire a shot that costs less than it would cold.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const wu = self({ seconds: 1 });
      const shot = b.node('act.projectile', { speed: 1400, mass: 0.3 });
      b.flow(ev, 'then', wu).flow(wu, 'then', shot);
      b.flow(wu, 'interrupted', b.node('fx.sound', { sound: 'boom' }));
    },
  },
  'res.charge': {
    howTo: 'Hold Q to charge: “result” shows how much is stored.',
    build: (b, self) => {
      const ev = b.node('on.keyHeld', { key: 'Q' });
      const begin = b.node('act.beginCharge', { name: 'Shot' });
      b.flow(ev, 'then', begin);
      store(b, self({ name: 'Shot' }) as string, 'out', 'number', begin);
    },
  },
  'entity.exists': {
    howTo: 'Press Q: “result” is true while a target is within 600 px.',
    build: (b, self) => {
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const e = self();
      const near = b.node('entity.nearest', { filter: 'target', radius: 600 });
      b.wire(near, 'out', e, 'target');
      store(b, e, 'out', 'boolean', ev);
    },
  },
};

function defaultBuild(type: string): Build {
  const def = getPrimitive(type)!;
  return (b, self) => {
    if (def.event) {
      const ev = self();
      b.flow(ev, 'then', b.node('fx.sound'));
      return;
    }
    const ev = b.node('on.keyPressed', { key: 'Q' });
    if (def.execIn) {
      const n = self();
      b.flow(ev, 'then', n);
      return;
    }
    const n = self();
    const out = def.outputs?.[0];
    store(b, n, out?.id ?? 'out', out?.type ?? 'number', ev);
  };
}

export function blockExample(type: string): BlockExample {
  const def = getPrimitive(type);
  if (!def) throw new Error(`unknown block ${type}`);
  const spec = EXAMPLES[type];
  const b = new GraphBuilder(`Example: ${def.label}`);
  const self = (params: Record<string, ParamValue> = {}) => b.node(type, params);
  (spec?.build ?? defaultBuild(type))(b, self);
  const howTo =
    spec?.howTo ??
    (def.event
      ? 'Make it happen: a chime plays each time it fires.'
      : def.execIn
        ? 'Press Q to run it.'
        : 'Press Q: “result” (Variables tab of the debugger) shows what it reports.');
  return { graph: b.build(), howTo };
}
