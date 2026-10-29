import { airDashGraph, doubleJumpGraph } from './movementMechanics';
import { GraphBuilder } from '../mechanics/builder';
import type { MechanicGraph } from '../mechanics/schema';

/**
 * Worked examples. Each is an ordinary mechanic built from primitives — the same graph a player
 * could wire — and runs on the real runtime. Open one in either editor (a copy goes on your shelf),
 * or try it in the testbench without touching your equipped mechanics.
 *
 * None of them reveals the lethal-hit trick of “Survive the Impossible”.
 */
export interface Example {
  id: string;
  title: string;
  summary: string;
  /** Markdown-ish explanation (see docs/markup.ts). */
  explain: string;
  /** What to press in the testbench. */
  keys: string;
  build: () => MechanicGraph;
}

function named(g: MechanicGraph, name: string): MechanicGraph {
  return { ...g, name };
}

export const EXAMPLES: Example[] = [
  {
    id: 'basic-jump',
    title: 'Basic Jump',
    summary: 'A jump on W that you built yourself — and pay for.',
    keys: 'W on the ground.',
    explain: `Your legs already jump for free on Space. This builds a second jump on **W** from parts:

- **when W key pressed** → **if on the ground?** → **set velocity (Y only) to (0, −760)**.

It sets your upward speed to 760 px/s — the same as the built-in jump — so you can compare. The exchange charges for the kinetic energy you gain: about {{jumpCost760}} E from a standstill. Change the −760 and watch the price on the block change.`,
    build: () => {
      const b = new GraphBuilder('Basic Jump');
      const ev = b.node('on.keyPressed', { key: 'W' });
      const g = b.node('state.grounded');
      const iff = b.node('flow.if');
      const set = b.node('act.setVelocity', { axes: 'y', velocity: { x: 0, y: -760 } });
      b.flow(ev, 'then', iff).wire(g, 'out', iff, 'cond').flow(iff, 'then', set);
      return b.build();
    },
  },
  {
    id: 'double-jump',
    title: 'Double Jump',
    summary: 'One extra jump in the air, counted and reset on landing.',
    keys: 'Space, then Space again in the air.',
    explain: `- **when Space key pressed** → **if not on the ground?** → **if number “Air Jumps Used” < 1** → **set velocity (Y only) to (0, −600)** → **change “Air Jumps Used” by 1**.
- **when I land** → **set “Air Jumps Used” to 0**.

“On the ground?” stays true for 0.1 s after you step off a ledge — while the normal jump still works — so the air jump never steals a normal jump. The counter makes repeated presses do nothing until you land, and walls do not count as landing.

Setting the upward speed (instead of adding an impulse) gives the same jump whether you are rising or falling. Its price is the kinetic energy you gain: about {{dj600Apex}} E at the top of your jump, about {{dj600Falling}} E while falling at 400 px/s (your fall is turned around, so you gain less speed). Change **1** to **2** for a triple jump.`,
    build: () => named(doubleJumpGraph({ speed: 600 }), 'Double Jump'),
  },
  {
    id: 'air-dash',
    title: 'Air Dash',
    summary: 'A burst of horizontal speed in the air, once per jump.',
    keys: 'Space, then Q in the air.',
    explain: `- **when Q key pressed** → **if not on the ground?** → **if not flag “Dashed”** → **set velocity (X only) to my facing × 850** → **set flag “Dashed” to true**.
- **when I land** → **set flag “Dashed” to false**.

The built-in dash only works on the ground; in the air you only have what you build. From a run (330 px/s) the dash adds about {{airDash850}} E of kinetic energy plus momentum.`,
    build: () => named(airDashGraph(850), 'Air Dash'),
  },
  {
    id: 'charged-attack',
    title: 'Charged Attack',
    summary: 'Hold to store energy in a charge; release to fire a shot exactly that strong.',
    keys: 'Hold Q, then let go.',
    explain: `- **when Q key pressed** → **start charging “Shot”**.
- **when Q key released** → **release charge “Shot” into this script** → **try to fire a projectile at (projectile speed that “energy” E buys, mass 0.3 kg)**.

The release hands the stored energy to this run. **Exchange Quote** converts it into the speed it can buy, so the shot uses what you stored; the charging time also counts as preparation, so the shot costs a little less and the rest flows back into your reservoir.`,
    build: () => {
      const b = new GraphBuilder('Charged Attack');
      const press = b.node('on.keyPressed', { key: 'Q' });
      b.flow(press, 'then', b.node('act.beginCharge', { name: 'Shot' }));
      const rel = b.node('on.keyReleased', { key: 'Q' });
      const release = b.node('act.releaseCharge', { name: 'Shot' });
      const quote = b.node('exchange.quote', { what: 'speed', mass: 0.3 });
      const shot = b.node('act.projectile', { mass: 0.3 });
      b.flow(rel, 'then', release).flow(release, 'then', shot);
      b.wire(release, 'energy', quote, 'energy').wire(quote, 'out', shot, 'speed');
      return b.build();
    },
  },
  {
    id: 'progressive-charge',
    title: 'Progressive Energy Charging',
    summary: 'Channel 150 E — more than your reservoir holds — next to a dynamo.',
    keys: 'Stand by the dynamo, press Q.',
    explain: `- **when Q key pressed** → **charge “Big” until it holds 150 E, then continue** → **try to fire a projectile at 1700 px/s, mass 0.9 kg**.

Your reservoir holds at most 100 E. Channelling moves energy out of it into the charge at {{channelRate}} E/s; the dynamo refills the reservoir at {{dynamoRate}} E/s while you stand in its field, so the charge keeps growing past 100. Nothing is created: every unit comes out of the dynamo’s finite reserve, and its gauge drops.`,
    build: () => {
      const b = new GraphBuilder('Progressive Charging');
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const ch = b.node('act.channelUntil', { name: 'Big', amount: 150 });
      const shot = b.node('act.projectile', { speed: 1700, mass: 0.9 });
      b.flow(ev, 'then', ch).flow(ch, 'charged', shot);
      return b.build();
    },
  },
  {
    id: 'overcap-attack',
    title: 'High-Energy Attack (250 E)',
    summary: 'An attack that costs two and a half reservoirs, paid in full.',
    keys: 'Stand by the dynamo, press Q, wait.',
    explain: `- **when Q key pressed** → **charge “Overload” until it holds 250 E** → **fire a projectile with the speed 250 E buys for 2 kg**.

A 250 E shot cannot come out of a 100 E reservoir at once — the exchange refuses and tells you you are 150 E short. Committed over time from a real source it can: about {{seconds250}} s of channelling, while the world keeps moving and a hit of 4+ damage scatters half of the charge. The channelling is preparation, so the shot itself ends up costing about {{overcapPaid}} E; the remainder flows back to your reservoir.`,
    build: () => {
      const b = new GraphBuilder('Overload');
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const ch = b.node('act.channelUntil', { name: 'Overload', amount: 250 });
      const quote = b.node('exchange.quote', { what: 'speed', energy: 250, mass: 2 });
      const shot = b.node('act.projectile', { mass: 2 });
      b.flow(ev, 'then', ch).flow(ch, 'charged', shot).wire(quote, 'out', shot, 'speed');
      b.flow(ch, 'interrupted', b.node('fx.sound', { sound: 'boom', pitch: 0.5 }));
      return b.build();
    },
  },
  {
    id: 'interruptible-windup',
    title: 'Interruptible Windup',
    summary: 'Prepare 1.5 s for a cheaper strike — unless something hits you first.',
    keys: 'Next to the target, press Q (try it in front of the turret too).',
    explain: `- **when Q key pressed** → **wind up for 1.5 s, then continue** → **try to deal 40 damage to the nearest target**; **if interrupted** → **set flag “Staggered” to true**.

A 1.5 s windup multiplies energy prices after it by {{windup15}}, so the 40 E strike costs about {{strikeAfterWindup}} E. You move slower while preparing, and a hit of 4+ damage breaks it — the interrupted path runs instead and nothing is spent.`,
    build: () => {
      const b = new GraphBuilder('Windup Strike');
      const ev = b.node('on.keyPressed', { key: 'Q' });
      const wu = b.node('act.windUp', { seconds: 1.5 });
      const strike = b.node('act.strike', { amount: 40 });
      const near = b.node('entity.nearest', { filter: 'target', radius: 200 });
      const flag = b.node('var.setFlag', { name: 'Staggered', scope: 'character', value: true });
      b.flow(ev, 'then', wu).flow(wu, 'then', strike).wire(near, 'out', strike, 'target').flow(wu, 'interrupted', flag);
      return b.build();
    },
  },
  {
    id: 'energy-collection',
    title: 'Energy Collection and Expenditure',
    summary: 'Absorb the turret’s bolts into your reservoir, then spend it on a dash.',
    keys: 'Hold F as bolts arrive; then G to dash.',
    explain: `- **when F pressed** → **raise my guard**; **when F released** → **lower my guard**.
- **when a hit meets my raised guard** → **try to absorb the incoming energy**.
- **when G pressed** → **if have at least 30 Energy?** → **set velocity (X only) to my facing × 900**.

Absorbing stores {{absorbPct}}% of a guarded hit’s kinetic energy (a turret bolt carries about {{boltEnergy}} E) and costs a little stamina. The dash spends it. Energy only ever comes from somewhere: here, the turret.`,
    build: () => {
      const b = new GraphBuilder('Collect & Spend');
      const press = b.node('on.keyPressed', { key: 'F' });
      b.flow(press, 'then', b.node('act.block'));
      const rel = b.node('on.keyReleased', { key: 'F' });
      b.flow(rel, 'then', b.node('act.unblock'));
      const hit = b.node('on.successfulBlock');
      b.flow(hit, 'then', b.node('act.absorb'));
      const g = b.node('on.keyPressed', { key: 'G' });
      const afford = b.node('res.canAfford', { amount: 30 });
      const iff = b.node('flow.if');
      const facing = b.node('vec.facing');
      const scale = b.node('vec.scale', { s: 900 });
      const dash = b.node('act.setVelocity', { axes: 'x' });
      b.flow(g, 'then', iff).wire(afford, 'out', iff, 'cond').flow(iff, 'then', dash);
      b.wire(facing, 'out', scale, 'v').wire(scale, 'out', dash, 'velocity');
      return b.build();
    },
  },
  {
    id: 'movement-input',
    title: 'Basic Movement Input',
    summary: 'Steer in mid-air with the direction keys.',
    keys: 'Jump, then hold W/A/S/D.',
    explain: `- **every tick** → **if not on the ground?** → **try to push me with force (direction I am holding × 1400) for one tick**.

“Direction I am holding” is a unit vector from your keys. The force acts for one tick per run, so running it every tick gives smooth steering; each tick is priced on what it adds, so steering costs energy only while you hold a direction.`,
    build: () => {
      const b = new GraphBuilder('Air Steering');
      const tick = b.node('on.tick');
      const g = b.node('state.grounded');
      const not = b.node('logic.not');
      const iff = b.node('flow.if');
      const input = b.node('vec.moveInput');
      const scale = b.node('vec.scale', { s: 1400 });
      const force = b.node('act.force');
      b.flow(tick, 'then', iff).wire(g, 'out', not, 'a').wire(not, 'out', iff, 'cond').flow(iff, 'then', force);
      b.wire(input, 'out', scale, 'v').wire(scale, 'out', force, 'force');
      return b.build();
    },
  },
  {
    id: 'toggle-ability',
    title: 'Toggle an Ability',
    summary: 'One key switches a glide on and off.',
    keys: 'Q to toggle, then jump.',
    explain: `- **when Q key pressed** → **alternate: on the 1st… run** set flag “Glide” to true; **on the 2nd…** set it to false.
- **every tick** → **if flag “Glide” and falling faster than 120 px/s** → **push me up with force (0, −1900) for one tick**.

The toggle remembers which side is next. While gliding you pay each tick for the lift you get.`,
    build: () => {
      const b = new GraphBuilder('Glide Toggle');
      const q = b.node('on.keyPressed', { key: 'Q' });
      const t = b.node('flow.toggle');
      b.flow(q, 'then', t);
      b.flow(t, 'a', b.node('var.setFlag', { name: 'Glide', scope: 'character', value: true }));
      b.flow(t, 'b', b.node('var.setFlag', { name: 'Glide', scope: 'character', value: false }));
      const tick = b.node('on.tick');
      const flag = b.node('var.getFlag', { name: 'Glide', scope: 'character' });
      const vel = b.node('entity.velocity');
      const brk = b.node('vec.break');
      const cmp = b.node('logic.compare', { op: '>', b: 120 });
      const and = b.node('logic.and');
      const iff = b.node('flow.if');
      const lift = b.node('act.force', { force: { x: 0, y: -1900 } });
      b.wire(vel, 'out', brk, 'v').wire(brk, 'y', cmp, 'a');
      b.wire(flag, 'out', and, 'a').wire(cmp, 'out', and, 'b');
      b.flow(tick, 'then', iff).wire(and, 'out', iff, 'cond').flow(iff, 'then', lift);
      return b.build();
    },
  },
  {
    id: 'timed-block',
    title: 'Timed Block',
    summary: 'A guard that drops by itself after half a second.',
    keys: 'F.',
    explain: `- **when F key pressed** → **try to raise my guard** → **wait 0.5 seconds** → **lower my guard**.

The wait pauses only this script; everything else keeps moving. A short, timed guard is cheap: guarding costs {{guardRaise}} stamina to raise and {{guardHold}} stamina per second to hold.`,
    build: () => {
      const b = new GraphBuilder('Timed Block');
      const f = b.node('on.keyPressed', { key: 'F' });
      const raise = b.node('act.block');
      const wait = b.node('flow.delay', { seconds: 0.5 });
      const lower = b.node('act.unblock');
      b.flow(f, 'then', raise).flow(raise, 'then', wait).flow(wait, 'then', lower);
      return b.build();
    },
  },
  {
    id: 'cooldown',
    title: 'Cooldown',
    summary: 'A dash you can use at most once every 1.2 seconds.',
    keys: 'G (mash it).',
    explain: `- **when G key pressed** → **if not cooling down (at most every 1.2 s)** → set velocity (X only) to my facing × 700; **else** → play a blip.

Each Cooldown block remembers its own last pass.`,
    build: () => {
      const b = new GraphBuilder('Dash Cooldown');
      const g = b.node('on.keyPressed', { key: 'G' });
      const cd = b.node('flow.cooldown', { seconds: 1.2 });
      const facing = b.node('vec.facing');
      const scale = b.node('vec.scale', { s: 700 });
      const dash = b.node('act.setVelocity', { axes: 'x' });
      b.flow(g, 'then', cd).flow(cd, 'pass', dash).flow(cd, 'blocked', b.node('fx.sound', { sound: 'blip' }));
      b.wire(facing, 'out', scale, 'v').wire(scale, 'out', dash, 'velocity');
      return b.build();
    },
  },
  {
    id: 'projectile-spawner',
    title: 'Projectile Spawner',
    summary: 'Fire toward the mouse cursor.',
    keys: 'Left mouse button.',
    explain: `- **when MouseLeft key pressed** → **try to fire a projectile toward (direction to the cursor) at 1200 px/s, mass 0.2 kg**.

Damage on impact is the shot’s kinetic energy: ½·0.2·12² = {{shotKE}} E, which costs {{shotCost}} E to launch. Doubling the speed quadruples both.`,
    build: () => {
      const b = new GraphBuilder('Cursor Shot');
      const ev = b.node('on.keyPressed', { key: 'MouseLeft' });
      const aim = b.node('vec.aim');
      const shot = b.node('act.projectile', { speed: 1200, mass: 0.2 });
      b.flow(ev, 'then', shot).wire(aim, 'out', shot, 'dir');
      return b.build();
    },
  },
  {
    id: 'conditional-reflection',
    title: 'Conditional Reflection',
    summary: 'Reflect only projectiles, and only with a fresh guard.',
    keys: 'Hold F just before a turret bolt arrives.',
    explain: `- **when F pressed** → raise my guard → reset timer “Guard”; **when F released** → lower my guard.
- **when a hit meets my raised guard** → **if (timer “Guard” < 0.3) and (Is Projectile)** → **try to reflect the incoming force ×1**.

The bolt turns around and flies back the way it came. Reflecting does not stop the hit from hurting you — it spares your guard and sends the force elsewhere. The stamina price grows with the square of how long the guard had been up: a fresh guard (0.1 s) costs about {{reflectFresh}} stamina, a lazy one (1 s) about {{reflectLazy}}.`,
    build: () => {
      const b = new GraphBuilder('Conditional Reflect');
      const press = b.node('on.keyPressed', { key: 'F' });
      const raise = b.node('act.block');
      const reset = b.node('timer.reset', { name: 'Guard' });
      b.flow(press, 'then', raise).flow(raise, 'then', reset);
      const rel = b.node('on.keyReleased', { key: 'F' });
      b.flow(rel, 'then', b.node('act.unblock'));
      const hit = b.node('on.successfulBlock');
      const timer = b.node('timer.value', { name: 'Guard' });
      const cmp = b.node('logic.compare', { op: '<', b: 0.3 });
      const and = b.node('logic.and');
      const iff = b.node('flow.if');
      const reflect = b.node('act.reflect', { amplify: 1 });
      b.wire(timer, 'out', cmp, 'a').wire(cmp, 'out', and, 'a').wire(hit, 'projectile', and, 'b');
      b.flow(hit, 'then', iff).wire(and, 'out', iff, 'cond').flow(iff, 'then', reflect);
      return b.build();
    },
  },
  {
    id: 'energy-consumption',
    title: 'Energy Consumption',
    summary: 'Pay 20 E to arm an overdrive for 3 seconds.',
    keys: 'Z, then left mouse within 3 s.',
    explain: `- **when Z pressed** → **try to spend 20 Energy** → set flag “Armed” → start timer “Armed” for 3 s; **if it fails** → play a blip.
- **when timer “Armed” runs out** → set flag “Armed” to false.
- **when MouseLeft pressed** → **if flag “Armed”** → fire a heavy shot; **else** → fire a light one.

Consume puts a real price on your own logic. It is a payment, not a conversion, so windups never discount it.`,
    build: () => {
      const b = new GraphBuilder('Overdrive');
      const z = b.node('on.keyPressed', { key: 'Z' });
      const pay = b.node('act.consume', { amount: 20 });
      const arm = b.node('var.setFlag', { name: 'Armed', scope: 'character', value: true });
      const t = b.node('timer.start', { name: 'Armed', duration: 3 });
      b.flow(z, 'then', pay).flow(pay, 'then', arm).flow(arm, 'then', t).flow(pay, 'failed', b.node('fx.sound', { sound: 'blip' }));
      const done = b.node('on.timerElapsed', { name: 'Armed' });
      b.flow(done, 'then', b.node('var.setFlag', { name: 'Armed', scope: 'character', value: false }));
      const fire = b.node('on.keyPressed', { key: 'MouseLeft' });
      const armed = b.node('var.getFlag', { name: 'Armed', scope: 'character' });
      const iff = b.node('flow.if');
      const aim = b.node('vec.aim');
      const heavy = b.node('act.projectile', { speed: 1400, mass: 0.6 });
      const light = b.node('act.projectile', { speed: 1000, mass: 0.15 });
      b.flow(fire, 'then', iff).wire(armed, 'out', iff, 'cond').flow(iff, 'then', heavy).flow(iff, 'else', light);
      b.wire(aim, 'out', heavy, 'dir').wire(aim, 'out', light, 'dir');
      return b.build();
    },
  },
  {
    id: 'resource-accumulator',
    title: 'Resource Accumulator',
    summary: 'Keep running totals of the damage you take and the energy you absorb.',
    keys: 'Get hit by turret bolts; watch the Variables tab.',
    explain: `- **when a hit has landed (after damage)** → change number “Damage Total” by (damage taken) → change number “Absorbed Total” by (absorbed E).

On Hit Resolved fires once for every hit — even those that dealt no damage — after it is settled, so it is the right place to keep score. It is too late to change the hit itself.`,
    build: () => {
      const b = new GraphBuilder('Hit Ledger');
      const ev = b.node('on.hitResolved');
      const dmg = b.node('var.addNumber', { name: 'Damage Total', scope: 'character' });
      const abs = b.node('var.addNumber', { name: 'Absorbed Total', scope: 'character' });
      b.flow(ev, 'then', dmg).wire(ev, 'damage', dmg, 'value').flow(dmg, 'then', abs).wire(ev, 'absorbed', abs, 'value');
      return b.build();
    },
  },
  {
    id: 'multi-condition',
    title: 'Multi-condition',
    summary: 'An air dash in the direction you hold — only if you are airborne, holding a direction, and can afford it.',
    keys: 'Jump, hold a direction, press C.',
    explain: `- **when C pressed** → **if (not on the ground?) and ((length of direction I am holding) > 0) and (have at least 30 Energy?)** → set velocity of me to (direction I am holding × 800).

Conditions combine with **and**, **or** and **not**. Every input of every condition is read when the If runs.`,
    build: () => {
      const b = new GraphBuilder('Directional Dash');
      const ev = b.node('on.keyPressed', { key: 'C' });
      const g = b.node('state.grounded');
      const not = b.node('logic.not');
      const input = b.node('vec.moveInput');
      const len = b.node('vec.length');
      const held = b.node('logic.compare', { op: '>', b: 0 });
      const afford = b.node('res.canAfford', { amount: 30 });
      const and1 = b.node('logic.and');
      const and2 = b.node('logic.and');
      const iff = b.node('flow.if');
      const scale = b.node('vec.scale', { s: 800 });
      const set = b.node('act.setVelocity', { axes: 'both' });
      b.wire(g, 'out', not, 'a').wire(input, 'out', len, 'v').wire(len, 'out', held, 'a');
      b.wire(not, 'out', and1, 'a').wire(held, 'out', and1, 'b').wire(and1, 'out', and2, 'a').wire(afford, 'out', and2, 'b');
      b.flow(ev, 'then', iff).wire(and2, 'out', iff, 'cond').flow(iff, 'then', set);
      b.wire(input, 'out', scale, 'v').wire(scale, 'out', set, 'velocity');
      return b.build();
    },
  },
];

export const EXAMPLE_BY_ID: Record<string, Example> = Object.fromEntries(EXAMPLES.map((e) => [e.id, e]));
