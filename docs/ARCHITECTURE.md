# SPLICE architecture

The simulation is authoritative and headless. Rendering, audio and UI only read from it, and the
only thing that flows into it is one `InputFrame` per tick. That separation is what makes the whole
game testable in Node: every acceptance criterion is exercised by `npm test` without a browser,
and `npm run e2e` re-checks the important ones through the real UI.

```
src/
  sim/                 authoritative game simulation (no DOM, no Phaser)
    World.ts           fixed 60 Hz step, entity registry, queries, post-physics passes
    entities/          Player (controller + resources), enemies, props, projectiles
    combat/Combat.ts   staged, interceptable hit pipeline
    exchange/          the Law of Equivalent Exchange: data table + ledger/operations
    levels/            level data (hub, three challenges, Challenge Lab rooms, sandbox arena)
    driver.ts          the interface the world uses to raise events for mechanics
  mechanics/           player-authored mechanic graphs
    schema.ts          serialisable graph format (versioned)
    registry.ts        primitive registry (+ primitives/*: events, control, data, variables, actions)
    validate.ts        graph validation with contextual messages
    compile.ts         graph → lookup tables
    runtime.ts         bounded interpreter (MechanicHost) implementing the sim's driver
    serialize.ts       versioned (de)serialisation, migrations, share codes
  game/                Phaser 4 presentation: scene, procedural art, particles, runner, input
  audio/Synth.ts       procedural WebAudio sound design
  ui/                  React: title, HUD, menus, sandbox tools, workbench (React Flow)
  store/               zustand app state (screens, library, undo history, progress, settings)
  persistence/         localStorage with defensive parsing
tests/                 vitest suites (headless)
e2e/run.mjs            Playwright end-to-end run
```

## The fixed step

`World.step(input)` advances exactly 1/60 s. `GameRunner` accumulates real time and calls it as
often as needed (at most 5 per frame), so the simulation is identical at any frame rate. The
renderer interpolates moving entities between their last two positions.

Order inside one step:

1. Clock advances; per-tick ledger counters reset.
2. **Mechanics:** due timers fire, delayed continuations and finished channels resume.
3. **Mechanics:** key events for this frame (pressed, released, held, every-tick) are queued and the
   queue is flushed.
4. Built-in controllers and AI (player movement, crate pushing, turrets, walkers, cannon).
5. Channels move energy from the battery into named charges.
6. Gravity and engine speed caps, then the matter-js step.
7. Contacts: grounding and landing, collision events, body-body impacts, hazards, melee contact,
   pickups, zones and interactions.
8. Projectiles sweep (sub-stepped circle tests, so nothing tunnels) and resolve hits. Defensive
   interception runs **synchronously** inside this stage.
9. **Mechanics:** events raised during 7–8 are flushed.
10. Stamina regeneration, out-of-bounds, death and respawn, objectives, cleanup.

## Mechanic graphs

A mechanic is a graph of **blocks** connected by two kinds of **cables**:

- **Flow cables** (white) decide what runs next. Every block with a flow input executes when flow
  reaches it, then picks one of its flow outputs. One cable per flow output (use *Sequence* to do
  several things); a flow input can take any number.
- **Value cables** (coloured by type: number, true/false, vector, entity) carry data. Values are
  *pulled* on demand when an executing block reads an input, so a *Compare* reads the timer at the
  instant the hit is being intercepted. Unplugged inputs use the literal typed on the block.

Events start flows. Their value outputs (an incoming hit's damage, the attacker, …) only exist
while that event's flow runs; the validator warns when a block reads one from somewhere else.

### What "compile" means

`compileGraph` validates the graph and turns it into maps: event kind → handler blocks, block →
flow successors, input port → source port. Nothing is generated or `eval`-ed. A graph with errors
is never executed; warnings are allowed.

### Resolution order (deterministic)

- Equipped mechanics resolve in **slot order** (slot 1 first). The workbench lets you reorder.
- Within one mechanic, handlers of the same event run in **canvas order**: top to bottom, then
  left to right.
- Queued events run FIFO. Signals emitted by a handler join the back of the queue.
- Interception events (*On Incoming Hit*, then *On Successful Block*) run immediately while the hit
  is open, in the same slot/canvas order. Signals they emit run after the hit resolves.
- Randomness comes from a seeded PRNG owned by the world.

### Safety limits (always on, Law or no Law)

| Limit                               | Value | What happens                                  |
| ----------------------------------- | ----- | --------------------------------------------- |
| Block executions per tick           | 4000  | All mechanics stop for the rest of the tick; diagnosed by name |
| Signal re-emission depth            | 8     | Deeper signals are dropped and diagnosed      |
| Events per tick                     | 256   | Remaining events are dropped                  |
| Pending delays/channels per mechanic | 64   | New ones are refused                          |
| Repeat count                        | 32    | Clamped                                       |
| Nested branches / value depth       | 24 / 64 | Stopped as a loop                           |
| Projectiles / entities              | 220 / 450 | Spawns refused                            |
| Body speed / projectile speed       | 4200 / 3200 px/s | Clamped                            |

A *Delay* of zero still resumes on the next tick, so delays can never spin inside a tick.

## The Law of Equivalent Exchange

All balance lives in one data table (`src/sim/exchange/table.ts`) and one authority
(`src/sim/exchange/Exchange.ts`). Dimensions are deliberately distinct:

- **Energy (E)** — the currency. ½·m·(v/100)². Stored in the battery, never created from nothing.
- **Momentum (mu)** — kg·100px/s. Converted to energy through the target's mass.
- **Health (HP)** — damage. Converted from kinetic energy at impact (1 HP per E).
- **Stamina** — the body's precision/strain budget. Regenerates; can never become energy.
- **Time** — an opportunity cost. Channels move 40 E/s; waiting yields nothing, and preparation
  erodes once it ends, so time cannot be banked.

Pricing formulas live in `src/sim/exchange/formulas.ts` and are shared by the ledger, the
Workshop's previews, the debugger and the docs, so a displayed price is the charged price.

Every operation in `OPERATIONS` declares its inputs, costs, constraints, outputs and lifecycle,
and splits its eligibility checks into **physical** rules (always enforced) and **exchange** rules
(the balancing law). `Exchange.perform` validates every check and the whole cost before committing
anything. There is **no per-action spending cap**: the cost is paid in full at once, from the
execution's released charge first, then the reservoir (battery). A failed operation spends nothing
and changes nothing; the HUD receipt and the debugger say why. Because every debit is immediate
and atomic, two simultaneous operations can never spend the same energy.

**Reservoir, commitment, progressive expenditure.** The reservoir holds at most 100 E at one
instant. A *charge* holds energy committed to a mechanic, apart from the reservoir, and may grow
past the reservoir's capacity while energy keeps arriving (cells, dynamos, absorbed hits) — so an
effect costing 250 E is paid by channelling it into a charge over time and releasing it. Unspent
released energy flows back into the reservoir; what does not fit is lost as heat. Being hurt
while channelling scatters half the charge. `Exchange.audit` tracks start, income, spent and
dissipated energy; tests check that reservoir + charges + released energy always balance.

**Windup.** Preparation (*Wind Up*, channelling) multiplies the energy price of effects that follow
it in the same run by `1 − 0.4·(1 − e^(−t/2))`: never below 60 %, with diminishing returns.
Preparation creates no energy, and once it ends every second that passes erodes a second of it.

Sources of energy are only: energy cells, dynamos (finite generators that feed the reservoir at
45 E/s while you stand near them), *Absorb Incoming* (60 % of a guarded hit's kinetic energy,
bounded by free battery capacity), and refunds of released-but-unspent charge.

### Costs

| Operation          | Cost                                                                             |
| ------------------ | -------------------------------------------------------------------------------- |
| Impulse / Force / Set Velocity | (0.5·\|J\|/100 + max(0, ΔKE)) / η E — ΔKE is the kinetic energy the push adds to the body (world frame); η = 1 on yourself, 0.85 on other bodies, ×(1 + ((d−140)/220)²) beyond 140 px |
| Projectile         | (½mv² + 0.5·mv) / 0.8 E; damage on impact = kinetic energy; recoil is free       |
| Strike             | 1 E per HP, target within 96 px                                                  |
| Raise guard        | 6 stamina, then 3 stamina/s while up; 0.2 s recovery after lowering             |
| Redirect / Reflect | 3 + 60·(guard age)² + 0.01·hit energy stamina; amplification (amp²−1)·E/0.75     |
| Prevent damage     | 1.5 E per HP, or 3 E if the hit's force was already redirected                   |
| Reduce damage      | 1.5 E per HP removed                                                             |
| Absorb             | 0.15 stamina per E absorbed                                                       |
| Channel            | 40 E/s from reservoir to charge; damage ≥ 4 HP interrupts and scatters half       |
| Windup             | energy prices after it × (1 − 0.4·(1 − e^(−t/2))); damage ≥ 4 HP interrupts       |

The reflection window is never hard-coded. Players write their own timing logic (typically a
timer compared against a threshold). The engine prices the *physical* fact — how long the guard had
been up when the hit arrived — so a tight window is nearly free and an always-on mirror runs out of
stamina. The guard must have been raised on an earlier tick than the hit: raising it inside the
interception does not count.

### Sandbox: Law OFF

`World.setLaw(false)` (sandbox and tests only; campaign and hub refuse) zeroes every cost and skips
every **exchange** check (guard-before-impact, burst limit, funds, battery space). **Physical**
checks and every authored condition remain, so a parry that compares a timer still only fires
inside its own window. Engine safety limits stay on. Challenge completion is only recorded in
certified campaign worlds with the Law in force.

## Combat pipeline

`CombatSystem.submit` stages every hit:

1. **Detect** — projectile sweep, body-body impact, melee contact, hazard, or strike.
2. **Construct** an open `Hit`: kind, attacker, direction, momentum, kinetic energy, base damage,
   blockable (kind allows it *and* it arrives inside the 200° guard arc), redirectable, and whether
   a guard was up before it.
3. **Intercept** — the victim's *On Incoming Hit* handlers, then (if guarded) *On Successful Block*
   handlers run while the hit is open. Defensive actions mutate it only through the ledger.
4. **Mitigate** — guard strain is charged to stamina unless the force was redirected (an
   exhausted guard breaks and only partly mitigates).
5. **Remaining damage** — base damage × unabsorbed share × (1 − 0.6 if guarded) − reductions, or
   zero if prevented.
6. **Lethality** — compared against current health.
7. **Commit** — redirect the projectile (new owner and team) or shove the attacker, otherwise apply
   knockback; then apply damage, and only now can death happen.

There is no parry class anywhere. The Death Parry in the tests (`tests/fixtures.ts`) is just
blocks: *Activate Block*, *Reset Timer*, *On Successful Block*, *Timer Value*, *Compare*, *If*,
*Reflect Incoming*, *Prevent Incoming Damage*.

## Challenge Lab

A lab is a level plus rules (`src/sim/levels/labs.ts`): an allowed parts list and a block budget.
The rules reuse the campaign's validation path (`ValidateOptions.allowedTypes` / `maxBlocks`); the
budget is checked across every equipped mechanic in `attachMechanics`, so splitting a build over
several mechanics doesn't dodge it. Labs always enforce the Law. A run's score is the blocks in the
running mechanics, `Exchange.totalSpent`, and the completion time.

## Persistence

- `splice.v1.library` — mechanics (schema 1) and the equipped slot order.
- `splice.v1.progress` — completed challenges, best times, and best Challenge Lab scores.
- `splice.v1.settings` — volumes and comfort options.

Graphs carry a `schema` number; `serialize.ts` migrates older schemas forward and rejects newer
ones with a reason. Unreadable mechanics are skipped rather than corrupting the library.

## Adding a primitive

1. Add a `PrimitiveDef` to the right file in `src/mechanics/primitives/` (category, tier, ports,
   params, and `exec` or `evaluate`, or an `event` spec).
2. If it changes the world in a way that should cost something, add an entry to `OPERATIONS` in
   `Exchange.ts` and call it through `ctx.perform(...)` — never mutate resources directly.
3. Nothing else changes: the validator, compiler, runtime and workbench work from the definition.

## Tests

- `tests/movement.test.ts` — feel: grounding, acceleration, jump arc, short hop, buffering, dash,
  crate pushing.
- `tests/runtime.test.ts` — execution, branching, variables, delays, cooldowns, loops bounded,
  signal ping-pong bounded, validation, ordering, save/reload behaviour, traces.
- `tests/exchange.test.ts` — atomic costs, instant limit, windups that let the world run, the
  999,999 strike, Law OFF, counterfeit variables, kinetic damage, double spending, refunds.
- `tests/combat.test.ts` — the Death Parry and every way it should fail.
- `tests/challenges.test.ts` — a scripted bot clears all three challenges with player-built graphs,
  and fails *Cross the Gap* with the built-in moveset alone.
- `tests/labs.test.ts` — lab rules are enforced and every lab is solvable inside them.
