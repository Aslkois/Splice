# SPLICE

A 2D action-platformer where you don't pick abilities — you build them. Wire events, conditions,
timers and physics actions together on a workbench, then walk into a live physics world and use
(or abuse) what you made. Every effect is paid for under the **Law of Equivalent Exchange**.

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
| `npm test`          | Headless simulation, runtime, exchange, combat and challenge tests  |
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
| Shift                  | Dash (costs stamina)                         |
| E                      | Use doors and the workbench                  |
| Tab                    | Open / close the workbench from anywhere     |
| Esc                    | Pause                                        |
| Anything else          | Whatever your mechanics bind it to (F, Q, R, mouse buttons…) |

## Your first mechanic: a double jump

The first challenge, *Cross the Gap*, is wider than your legs can jump. Build a second jump:

1. In the hub, press **Tab** (or **E** at the workbench). Your shelf already has an empty
   mechanic plugged into slot 1.
2. From the parts drawer, click **On Key Pressed**. On the block, set *Key* to **Space**.
3. Add **If**, **Apply Impulse**, **Is Grounded** and **NOT**. Drag them apart on the mat.
4. Plug the cables (drag from a jack on the right of a block to a jack on the left of another):
   - *On Space Pressed* → *If* (white flow cable)
   - *If · True* → *Apply Impulse* (white flow cable)
   - *Is Grounded · Result* → *NOT · In*, and *NOT · Result* → *If · Condition* (teal cables)
5. *Apply Impulse* defaults to an impulse of `(0, −650)`: straight up. The status chip should
   read **Ready**. Press **Test it**.
6. Jump, and press Space again in mid-air. The receipt in the top right prints what it cost —
   about 28.7 E per jump. Energy cells on the way to the gap top your battery up.

Then walk through the first door. From there the game stops explaining: each challenge unlocks
new parts, and what you build with them is up to you.

**Workbench tips:** double-click a cable to unplug it · Delete removes selected blocks ·
Ctrl+Z / Ctrl+Shift+Z undo and redo · Ctrl+C / Ctrl+V / Ctrl+D copy, paste and duplicate ·
*Share* turns a mechanic into a code you can paste into someone else's *Import*.
After a playtest, each block shows how often it ran and the last reason it failed.

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

Energy (E) is the only currency. It lives in a 100 E battery, never regenerates on its own, and
comes only from real sources: energy cells, and absorbing the kinetic energy of things that hit
you. Stamina regenerates but can never become energy. Time is spent, never stored.

| You want…                        | It costs                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| An impulse of p (kg·100px/s)     | (½·p + p²/2m) / 0.85 E — more on far-away targets             |
| A projectile of mass m, speed v  | (½mv² + ½mv) / 0.8 E; its damage *is* its kinetic energy      |
| A strike of N damage             | N E, and the target must be within reach                      |
| Anything over 40 E at once       | Channel it into a charge first (30 E/s); getting hit scatters half |
| To redirect an incoming hit      | A guard raised *before* impact, plus stamina that grows with how long the guard was up |
| To negate damage                 | 1.5 E per HP — or 3 E if you already sent the force elsewhere |

A 999,999-damage strike is a valid graph. It just needs 999,999 E of real input.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — systems, step order, determinism rules,
  the exchange model, combat pipeline, safety limits, and how to add a primitive.

## Licence

Public domain (see `LICENSE`). All art and sound are procedural; there are no third-party assets.
