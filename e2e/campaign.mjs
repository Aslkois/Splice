// Plays the first two challenges in a real browser with mechanics from the docs' examples, under
// normal progression rules. A scripted player runs inside the page on requestAnimationFrame, so the
// game runs at real speed with its real frame timing. Run with `npm run e2e:campaign`.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let server = null;
let base = process.env.BASE_URL;
if (!base) {
  base = 'http://localhost:4173/';
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

/** Fresh browser profile with the given progress; equips only the named example. */
async function setup(completed, exampleId) {
  await page.goto(base);
  await page.evaluate((c) => {
    localStorage.clear();
    localStorage.setItem('splice.v1.progress', JSON.stringify({ completed: c, best: {}, labs: {} }));
  }, completed);
  await page.reload();
  await page.waitForSelector('.title-menu .btn.go');
  await page.click('.title-menu .btn.go');
  await page.waitForTimeout(500);
  await page.evaluate((id) => {
    const s = window.__SPLICE__.app.getState();
    for (const m of s.library.equipped) s.toggleEquip(m);
    const g = window.__SPLICE__.examples[id].build();
    const newId = s.addToShelf(g);
    window.__SPLICE__.app.getState().toggleEquip(newId);
  }, exampleId);
}

try {
  // ------------------------------------------------------------ Cross the Gap with an air dash
  await setup([], 'air-dash');
  await page.evaluate(() => window.__SPLICE__.app.getState().enterLevel('c1'));
  await page.waitForTimeout(600);
  const c1 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const S = window.__SPLICE__;
        let phase = 'run';
        const t0 = performance.now();
        S.press('D');
        const step = () => {
          const s = S.state();
          if (s.objectiveDone || !s.alive || performance.now() - t0 > 15000) {
            ['D', 'Space', 'Q'].forEach((k) => S.release(k));
            const w = S.runner.world;
            resolve({ done: s.objectiveDone, alive: s.alive, x: Math.round(s.pos.x), spent: Math.round(w.exchange.totalSpent * 10) / 10, rejected: S.runner.attach.rejected.length });
            return;
          }
          if (phase === 'run' && s.pos.x >= 760) {
            S.press('Space');
            phase = 'rise';
          } else if (phase === 'rise' && s.vel.y > -40) {
            S.press('Q');
            phase = 'dash';
          } else if (phase === 'dash') {
            S.release('Q');
            phase = 'glide';
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  check('Cross the Gap: a home-made air dash gets you over (tier 0, Law on)', c1.done && c1.alive && c1.rejected === 0, JSON.stringify(c1));
  await page.screenshot({ path: OUT + 'c1-airdash.png' });

  // ------------------------------------------------------------ Return to Sender by reflection
  await setup(['c1'], 'conditional-reflection');
  await page.evaluate(() => window.__SPLICE__.app.getState().enterLevel('c2'));
  await page.waitForTimeout(600);
  const c2 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const S = window.__SPLICE__;
        const t0 = performance.now();
        let holdUntil = 0;
        const handled = new Set();
        S.press('D');
        let walking = true;
        const step = () => {
          const s = S.state();
          const w = S.runner.world;
          if (s.objectiveDone || !s.alive || performance.now() - t0 > 90000) {
            ['D', 'F'].forEach((k) => S.release(k));
            const turrets = w.entities.filter((e) => e.tag === 'sender').map((t) => (t.alive ? Math.round(t.hp) : 'down'));
            resolve({ done: s.objectiveDone, alive: s.alive, hp: Math.round(s.hp), turretsLeft: turrets.filter((t) => t !== 'down').length, seconds: Math.round(w.time), rejected: S.runner.attach.rejected.length });
            return;
          }
          if (walking && s.pos.x >= 820) {
            S.release('D');
            walking = false;
          }
          // A player watching the bolts: guard up ~0.2 s before one arrives, down shortly after.
          const p = w.player;
          for (const e of w.entities) {
            if (e.kind !== 'projectile' || !e.alive || e.team !== 'enemy' || handled.has(e.id)) continue;
            const dx = p.pos.x - e.pos.x;
            const dy = p.pos.y - e.pos.y;
            const d = Math.hypot(dx, dy);
            const closing = (dx * e.velocity.x + dy * e.velocity.y) / Math.max(d, 1);
            if (closing > 0 && d / closing < 0.2) {
              handled.add(e.id);
              holdUntil = performance.now() + 330;
              S.press('F');
            }
          }
          if (holdUntil && performance.now() > holdUntil) {
            S.release('F');
            holdUntil = 0;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  const reflected = await page.evaluate(() => window.__SPLICE__.runner.attach.host.traceLog.entries().filter((e) => e.nodeType === 'act.reflect' && e.ok).length);
  check(
    'Return to Sender: reflecting the bolts silences both emplacements (tier 1, Law on)',
    c2.done && c2.alive && c2.rejected === 0,
    `${JSON.stringify(c2)}, ${reflected} reflections`,
  );
  await page.screenshot({ path: OUT + 'c2-solved.png' });
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('splice.v1.progress') ?? '{}'));
  check('completing Return to Sender is saved and unlocks the next tier', progress.completed?.includes('c2'), JSON.stringify(progress.completed));
} catch (e) {
  check('unexpected failure', false, e.message);
  await page.screenshot({ path: OUT + 'campaign-failure.png' }).catch(() => {});
} finally {
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server?.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
