# SPLICE

A 2D action-platformer where you don't pick abilities — you build them. Wire events, conditions,
timers and physics actions together on a workbench, then walk into a live physics world and use
(or abuse) what you made. Every effect is paid for under the **Law of Equivalent Exchange**.

Mechanics are edited in either of two editors over the same mechanic — **Scratch Blocks**
(stacked blocks that snap together) or **Blueprint Blocks** (nodes and wires) — and run by one
engine. **SPLICE Docs** (F1) documents every block, with prices computed from the game's own
formulas.

Built with TypeScript, Vite, Phaser 4 (rendering), matter-js (physics), React 19 and React Flow.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command             | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | Dev server with hot reload                                          |
| `npm run build`     | Type-check, then production build into `dist/`                      |
| `npm test`          | Headless simulation, runtime, exchange, movement, campaign validation, editor conversion and docs coverage tests |
| `npm run e2e`       | Builds, serves `dist/`, and plays the game in Chromium via Playwright |

`npm run e2e` uses the Playwright Chromium already installed on the machine
(`PLAYWRIGHT_BROWSERS_PATH`). Set `BASE_URL` to point it at a running dev server instead.

## Deployment

`.github/workflows/pages.yml` runs the tests, type-checks and builds on every pull request, and on
every push to `main` it also publishes `dist/` to GitHub Pages (also runnable by hand from the
Actions tab). The site is served at **https://aslkois.github.io/Splice/**. One-time setup: in the
repository's *Settings → Pages*, set *Source* to **GitHub Actions**.

## Controls

| Key                    | Action                                       |
| ---------------------- | -------------------------------------------- |
| A / D or ← / →         | Move                                         |
| Space, W or ↑          | Jump (hold for height)                       |
| Shift                  | Dash along the ground (costs stamina). In the air you only have what you build. |
| E                      | Use doors and the workbench                  |
| Tab                    | Open / close the workbench from anywhere     |
| F1                     | SPLICE Docs (in the workbench: the selected block's reference) |
| `                      | Debugger window while playing                |
| Esc                    | Pause                                        |
| Anything else          | Whatever your mechanics bind it to (F, Q, R, mouse buttons…) |

## Your first mechanic: a double jump

The first challenge, *Cross the Gap*, is wider than your legs can jump. Build a second jump:

1. In the hub, press **Tab** (or **E** at the workbench). Your shelf already has an empty
   mechanic plugged into slot 1. The workbench opens in **Scratch Blocks**.
2. Drag the hat **when F key pressed** from the palette onto the workspace and set the key to
   **Space**.
3. Snap **if … then** under it, and drop **not** into its condition slot, then **on the ground?**
   into the slot of *not*.
4. Snap **try to set velocity of me to (0, −600) (Y only)** into the *if*'s mouth (pick *Y only*,
   type −600).
5. The status chip reads **Ready**. Select the set-velocity block: the inspector shows its price
   (about 21 E from the top of a jump). Press **Test it**.
6. Jump, and press Space again in mid-air. The receipt in the top right prints what it cost.

Prefer wires? Switch to **Blueprint Blocks** at the top — it's the same mechanic. The docs have
a complete [double jump](src/docs/examples.ts) with a counter that resets on landing, and an air
dash; open either from **Docs → Examples** and try it in the testbench.

**Workbench tips:** Scratch Blocks — drag blocks back onto the palette to delete them · Del
removes the selected block · Ctrl+D duplicates it (with the blocks below) · Alt+↑/↓ moves it
within its stack · right-click for more. Blueprint Blocks — right-click, Space, or drop a wire on
empty space to search for a block that fits · drag on empty space to select · double-click a
cable to unplug it. Both — Ctrl+Z / Ctrl+Shift+Z undo and redo across editors · Ctrl+1 / Ctrl+2
switch editors · F1 opens the reference · *Share* turns a mechanic into a code for *Import*.
The inspector's **Debugger** tab shows what ran in your last playtest, with simulation
timestamps, values, prices and why anything failed.

## Modes

- **Campaign** — the hub and three challenges (*Cross the Gap*, *Return to Sender*,
  *Survive the Impossible*). Completion is detected from world state (you reached the ledge, the
  emplacements are destroyed, you walked out alive), never from which blocks you used. The Law
  is always in force.
- **Challenge Lab** — opens after the first challenge. Short rooms with a fixed parts list and a
  block budget covering everything you have plugged in: clear a gap with two blocks, shatter an
  out-of-reach crystal on 60 E, fill an empty battery from a turret's fire. Scored on blocks
  used, then energy spent, then time.
- **Sandbox** — every part unlocked. Place crates, targets, turrets, walkers, cells and cannons
  with a click; change gravity and simulation speed; refill; reset; and switch the Law of
  Equivalent Exchange **off** to build something absurd. Sandbox play never counts towards the
  campaign.

## The Law of Equivalent Exchange, briefly

Power is not capped; power is paid for. Energy (E) lives in a 100 E **reservoir**, never
regenerates on its own, and comes only from real sources: energy cells, dynamos (finite
generators), and absorbing the kinetic energy of things that hit you. Stamina regenerates but can
never become energy. Time is spent, never stored.

| You want…                        | It costs                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| To push a body                   | The kinetic energy the push adds plus a momentum term: (0.5·\|J\|/100 + max(0, ΔKE)) / η — η = 1 on yourself, 0.85 on others (more at range). An air jump to 600 px/s is ~21 E. |
| A projectile of mass m, speed v  | (½mv² + ½mv) / 0.8 E; its damage *is* its kinetic energy      |
| A strike of N damage             | N E, and the target must be within reach                      |
| More than your reservoir holds   | Commit it to a charge over time (40 E/s) while energy keeps arriving, then release it into the effect. Getting hit scatters half. |
| To pay less                      | Wind up first: prices × (1 − 0.4·(1 − e^(−t/2))), never below 60 %. Preparation erodes once it ends. |
| To redirect an incoming hit      | A guard raised *before* impact, plus stamina that grows with how long the guard was up |
| To negate damage                 | 1.5 E per HP — or 3 E if you already sent the force elsewhere |

There is no per-action limit: an 80 E action runs at once if you have 80 E. A 999,999-damage strike
is a valid graph; it just needs 999,999 E of real input. In the Sandbox you can switch the Law off.

## Docs

- In the game: **SPLICE Docs** (F1) — getting started, the two editors, energy and the Law,
  movement, advanced topics, the debugger, a reference page for every block, and worked examples.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — systems, step order, determinism rules,
  the exchange model, combat pipeline, safety limits, editors, docs, and how to add a primitive.
- [`src/dev/campaignValidation.ts`](src/dev/campaignValidation.ts) — what each challenge offers and
  the reference solutions that prove it can be solved under normal rules (run by `npm test`).

## Licence

Public domain (see `LICENSE`). All art and sound are procedural; there are no third-party assets.
