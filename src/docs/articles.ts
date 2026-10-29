/**
 * SPLICE Docs articles. Markup (see markup.tsx): # headings, - lists, | tables |, **bold**,
 * `code`, [[block:type]] / [[article:id]] / [[example:id]] links, and {{number}} figures computed
 * from the exchange's own formulas (numbers.ts).
 */
export interface Article {
  id: string;
  title: string;
  /** Short line for search results and the index. */
  summary: string;
  body: string;
}

export const ARTICLES: Article[] = [
  {
    id: 'start',
    title: 'Getting Started',
    summary: 'Your first mechanic, step by step.',
    body: `# Getting Started

SPLICE gives you a body that can run, jump and dash along the ground. Everything else you build: abilities are **mechanics** made of **blocks**, wired together in the Workshop and run by the game’s engine the moment you close it.

## Your first mechanic

- Open the Workshop with **Tab** (or press **E** at the workbench).
- In **Scratch Blocks**, drag the hat [[block:on.keyPressed]] onto the workspace and pick a key.
- Snap [[block:act.setVelocity]] underneath it. Set it to **Y only** and the velocity to (0, −600).
- Close the Workshop (**Tab**, or **Test it**) and press your key: you leap.

That leap cost energy. Every effect that changes the world is paid for under the **Law of Equivalent Exchange** — see [[article:energy]]. The price is printed on the block before you ever run it.

## Reading a mechanic

- A **hat** starts a script when its event happens.
- **Stack blocks** run top to bottom. **C-blocks** run the blocks in their mouth.
- **Reporters** (rounded) and **conditions** (pointed) plug into slots and give values.
- Actions that can fail (not enough energy, nothing in reach) have an optional **if it fails** mouth.

## Where to go next

- [[article:editors]] — Scratch Blocks and Blueprint Blocks edit the same mechanic.
- [[article:movement]] — build a [[example:double-jump]] or an [[example:air-dash]].
- [[article:debugging]] — see what your mechanic actually did.
- Every block has a full reference: select one and press **F1**.`,
  },
  {
    id: 'editors',
    title: 'Scratch Blocks and Blueprint Blocks',
    summary: 'Two editors, one mechanic. What switching does and doesn’t do.',
    body: `# Two editors, one mechanic

The switch at the top of the Workshop changes **how you edit**, never **what runs**. Both editors read and write the same mechanic; there is one runtime.

| | Scratch Blocks | Blueprint Blocks |
|---|---|---|
| Flow | stacks that snap; C-blocks for branches | white flow wires between nodes |
| Values | reporters plugged into slots | coloured value wires |
| Order | top to bottom | follow the flow wires |
| Good for | reading and building quickly | big mechanics, shared values, unusual wiring |

## Switching is lossless

Switching keeps every block, parameter, wire, variable name, run order and position. Each editor keeps its own layout. Undo works across switches.

Some Blueprint wirings have no stacked-block shape — a flow wire that loops back, a block reached from two different scripts, or a failure path that rejoins the main path. Then Scratch Blocks explains exactly which wire is the problem and changes nothing; switch back and the mechanic is as you left it, still running.

## Differences that matter

- In Blueprint Blocks one flow output can lead to only one block. Use [[block:flow.sequence]] to do several things in order.
- A reporter can feed several inputs in Blueprint Blocks. Scratch Blocks shows it in every slot it feeds, marked ⛓ — editing one copy edits all.
- Values an event or action produces (an incoming hit’s **damage**, a released **energy**) appear in Scratch Blocks as chips on that block: drag a chip into a slot.
- When several scripts start from the same event, the order they run in is the **run order** (“runs 1st of 2”). Change it with ▲▼ on the hat or **Alt+↑/↓**.`,
  },
  {
    id: 'energy',
    title: 'Energy and the Law of Equivalent Exchange',
    summary: 'Reservoir, charges, windup, sources, time — with the real formulas.',
    body: `# Energy and the Law of Equivalent Exchange

Power is not capped. **Power is paid for.** Any effect can be as large as you like; it costs what it does, at the moment it happens, and the energy has to come from somewhere real.

## The reservoir

Your **reservoir** (the battery in the HUD) holds at most **{{capacity}} E** at one instant. Effects are paid from it in full and at once — an action costing 80 E runs immediately if you have 80 E. If you can’t pay, nothing happens, nothing is spent, and the block takes its **if it fails** path. There is no per-action limit.

## Committed energy and progressive expenditure

A **charge** holds energy committed to a mechanic, kept apart from the reservoir. [[block:act.beginCharge]] and [[block:act.channelUntil]] move energy from your reservoir into a charge at **{{channelRate}} E/s**.

A charge can hold **more than your reservoir’s capacity**. While you channel, the reservoir keeps refilling from real sources (cells, a dynamo, absorbed hits), and the charge keeps growing. Releasing it ([[block:act.releaseCharge]], or Channel Until finishing) hands that energy to the running script: the actions after it are paid from the released energy first, then from the reservoir. That is how a 250 E attack is paid by a 100 E body — see [[example:overcap-attack]]: about {{seconds250}} s of channelling beside a dynamo.

Without a source, a charge can never hold more than what you had: channelling moves energy, it never makes it.

Released energy that isn’t spent flows back into your reservoir when the script ends; whatever doesn’t fit is lost as heat.

## Windup

Preparing makes effects more efficient. After [[block:act.windUp]] (or channelling), every energy price later in the same script is multiplied by

\`factor = 1 − {{maxSavingPct}}% × (1 − e^(−t / {{timeConstant}} s))\`

| preparation | price × |
|---|---|
| 0.5 s | {{windup05}} |
| 1 s | {{windup1}} |
| 2 s | {{windup2}} |
| 4 s | {{windup4}} |
| 10 s | {{windup10}} |

Diminishing returns: no amount of waiting takes the price below {{floorPct}}%. Windup reduces losses; it **creates no energy**.

## Time is not a resource

Time passes; it can’t be stored. While you prepare, enemies keep firing, projectiles keep flying and targets keep moving. Once preparation ends, every second that passes erodes a second of it — hold a finished charge for 3 s and its 3 s of preparation are gone (the energy stays). Waiting a minute with an empty reservoir gives you nothing.

## Interruption

A hit of **{{interruptThreshold}}+ damage** while you prepare:

- stops every channel and scatters **{{interruptLossPct}}%** of each charge (lost); the rest stays stored, and [[block:on.chargeInterrupted]] fires;
- breaks a [[block:act.windUp]], which takes its **Interrupted** path;
- interrupts [[block:act.channelUntil]], which takes **if interrupted**.

What happens next is up to your mechanic: release what is left into another effect, hold it, or retreat. Charging never makes you invulnerable — you move at 55% speed meanwhile.

## Where energy comes from

- **Cells** — {{cellEnergy}} E each, picked up when you have room.
- **Dynamos** — finite generators; while you stand in the field they feed your reservoir at {{dynamoRate}} E/s until their reserve runs out.
- [[block:act.absorb]] — {{absorbPct}}% of a guarded hit’s kinetic energy.
- Refunds of released energy you did not spend.

Nothing else. Setting a variable called “energy” creates none; stamina can never become energy; time creates none.

## Movement costs

Pushing a body costs **the kinetic energy the push adds to it, plus a momentum term**:

\`E = (0.5 × |J| / 100 + max(0, ΔKE)) / η\`  with  \`KE = ½ · m · (v / 100)²\`

- η = {{selfEfficiency}} for your own body (nothing to transmit through), {{remoteEfficiency}} for other bodies, which also get dearer beyond 140 px.
- You pay for what the push actually does: lifting your body 100 px costs about {{pricePer100px}} E however you do it.
- Splitting a push changes nothing: one push of 800 costs {{whole800}} E; thirty-two pushes of 25 cost {{split32}} E.
- Slowing down or turning momentum around only costs the momentum term.

| movement | price |
|---|---|
| air jump to 600 px/s at the top of a jump | {{dj600Apex}} E |
| the same while falling at 400 px/s | {{dj600Falling}} E |
| a fixed 650 push while falling at 400 px/s | {{impulse650Falling}} E (it mostly cancels the fall) |
| jump-sized 760 px/s from a standstill | {{jumpCost760}} E |
| 1500 px/s straight up from a standstill | {{rocket1500}} E |
| 3000 px/s straight up | {{launch3000}} E — commit it to a charge first |

## Damage

Damage comes from kinetic energy, never from a number you type: a projectile hits for its ½mv². A strike costs 1 E per HP. Preventing damage costs {{preventPerHp}} E per HP — little if you already sent the force elsewhere.

## The Sandbox switch

In the Sandbox you can switch the Law **off**: costs, energy and preparation requirements vanish and anything goes. Your mechanic’s own conditions, timers and logic still run exactly as written, and the engine’s safety limits (speeds, step budget) still apply. The campaign always keeps the Law on.`,
  },
  {
    id: 'movement',
    title: 'Movement',
    summary: 'Built-in moves, air jumps, dashes, and what they cost.',
    body: `# Movement

## What your body does for free

Running, the normal jump (Space) and the ground dash (Shift, {{dashStamina}} stamina) are your legs, and cost no energy. The normal jump also works for 0.1 s after you step off a ledge. In the air you have nothing built-in: air jumps, air dashes, gliding and thrust are mechanics you build.

## Air jumps

The pattern ([[example:double-jump]]):

- **when Space pressed** → **if not on the ground?** → **if air jumps used < 1** → go up → **add 1 to air jumps used**
- **when I land** → **set air jumps used to 0**

Two ways to “go up”, with different consequences:

- [[block:act.setVelocity]] (Y only) **reaches a target speed**. It overcomes a fall completely; it costs the kinetic energy you end up gaining — {{dj600Apex}} E at the top of a jump.
- [[block:act.impulse]] **adds a fixed push**. While falling, much of it just cancels the fall, so you rise less — and it costs only {{impulse650Falling}} E.

Rising faster costs more than it seems: a second 760 px/s push while already rising at 760 px/s costs {{rocketWhileRising}} E, because it buys four times the height.

## Dashes

[[example:air-dash]] sets your horizontal speed to 850 px/s along your facing: about {{airDash850}} E from a run. Air control afterwards slows you gradually.

## Steering and thrust

[[block:act.force]] acts for one tick per run; run it from [[block:on.keyHeld]] or [[block:on.tick]] for thrust — see [[example:movement-input]].

## Safety limits

Bodies never exceed 4200 px/s and projectiles 3200 px/s. These keep the physics stable; they are not balance rules, and prices are computed on what is actually delivered.`,
  },
  {
    id: 'advanced',
    title: 'Advanced Topics',
    summary: 'Event ordering, data flow, scope, timers, hits, limits, saving.',
    body: `# Advanced Topics

## One tick, in order

The simulation runs at 60 ticks per second whatever your screen does. In each tick:

- **waits** that are due resume, and **timers** that ran out queue their [[block:on.timerElapsed]];
- **key events** are queued: presses, releases, then held keys (each group in alphabetical key order), then [[block:on.tick]];
- the queue runs, first in first out — elapsed timers, key scripts, and anything they trigger (signals);
- built-in movement, enemies and props update — hits on you are intercepted right here, synchronously; channels fill; physics steps;
- contacts, impacts, hazards and pickups are processed and projectiles move;
- the queue runs again: landings, collisions, damage, hit results, destroyed things and new signals.

## Run order and simultaneous events

When several scripts start from the same event they run one after another, never at once: mechanics in their equip-slot order, scripts inside a mechanic in their **run order**. Energy is debited the instant an action runs, so two scripts can never spend the same energy — the second sees what the first left.

## Stacks and C-blocks

A script runs top to bottom until it reaches the end or a block that waits. [[block:flow.if]] runs one mouth and then continues below. [[block:flow.sequence]] runs its mouths one after another and ends the stack. [[block:flow.repeat]] runs its mouth N times **in the same tick**.

## Data flow

Reporters are evaluated when the block reading them runs — not before, and not cached: reading [[block:time.now]] twice in one script can give two values if a wait sits between. Values produced by an event (an incoming hit’s **damage**) belong to that event: a block in another script reading them gets an empty value (the Workshop warns you).

## Scope

Variables and timers are **this mechanic** (private) or **whole character** (shared by every equipped mechanic). Names are case-sensitive. They reset when you respawn or restart, and are kept when you edit in the Workshop.

## Timers

[[block:timer.reset]] restarts a stopwatch; [[block:timer.start]] also fires [[block:on.timerElapsed]] after a duration; [[block:timer.stop]] removes it (its value reads ∞). Timers use simulation time: they stop while paused, in hitstop and in the Workshop.

## Hits: before and after damage

Every hit on you goes through stages:

- the hit is built: its energy, direction, whether it is **blockable** (a guardable kind, from in front), whether your guard caught it (raised on an **earlier** tick);
- [[block:on.incomingHit]] scripts run, then — if guarded — [[block:on.successfulBlock]] scripts. The hit is open: Reflect, Redirect, Prevent, Reduce and Absorb change it;
- guard strain, then the remaining damage is computed and applied;
- [[block:on.damageTaken]] (if damage got through) and then [[block:on.hitResolved]] run, queued. The hit is closed.

Damage = base × (1 − absorbed share) × (1 − 60% if guarded) − reduction, or 0 if prevented.

## Reflection precisely

Reflecting is about **force**, not damage:

- a projectile turns around, flies back along its path at its speed (× amplify), and now belongs to you;
- a melee or body hit shoves its attacker and deals the hit’s damage (× amplify) back;
- your guard is spared the strain — but **the hit still damages you** unless you also do something about the damage.

## Recursion and limits

| limit | value | what happens |
|---|---|---|
| steps per tick | 4000 | the script stops, a note appears |
| events per tick | 256 | the rest are dropped |
| signals inside signals | 8 deep | deeper ones are dropped |
| hits inside hits | 4 deep | inner interception skipped |
| repeat | 32 | capped |
| waits per mechanic | 64 | new ones fail |

A flow wire that loops back is allowed in Blueprint Blocks but stops at the step budget; use a wait or Every Tick for things that repeat over time.

## Saving

Mechanics are saved as data: blocks, parameters, wires and run order, with each editor’s layout kept separately. Older saves are upgraded when loaded, keeping their behaviour. Share codes (SPLICE1:…) carry the same data.`,
  },
  {
    id: 'debugging',
    title: 'The Debugger',
    summary: 'Trace, variables and the exchange ledger — from the real run.',
    body: `# The Debugger

Open it in the Workshop (**Debugger** tab of the inspector) or while playing with **\`** (backquote). Everything in it is recorded by the engine as it happens, stamped with the simulation tick and time.

## Trace

One line per event, block, wait and resume, newest last:

- **event** lines show what started a script and the values it carried;
- **block** lines show the inputs the block read, which way it went (an If’s **else** is filed as a failed condition), and for actions the price: base cost, windup factor, where the energy came from and what was left;
- **failures** say why, by category: **condition**, **resources**, **target**, **requirement** (timing, an already-closed hit), **interrupted**, **limit**, **logic**.

Filter by mechanic or category, pause to read, clear to start again. The buffer keeps the last 2000 lines.

## Variables

Live values of every variable and timer, per scope.

## Exchange

Your reservoir, committed charges, and the ledger: every payment, refund, absorption and loss, plus an audit — start + income − spent − lost — that always matches what you hold.`,
  },
];

export const ARTICLE_BY_ID: Record<string, Article> = Object.fromEntries(ARTICLES.map((a) => [a.id, a]));
