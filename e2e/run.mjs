// End-to-end browser test: a player builds a mechanic in the Workshop UI and uses it to solve
// "Cross the Gap". Run with `npm run e2e` (builds, serves dist/ with vite preview, drives Chromium).
//
// Set BASE_URL to test an already-running server instead.
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
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const state = () => page.evaluate(() => window.__SPLICE__.state());
const key = (code, type) => page.evaluate(([c, t]) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true })), [code, type]);

try {
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('text=Start the campaign');
  await page.click('text=Start the campaign');
  await page.waitForTimeout(800);
  check('enters the workshop hub', (await state())?.level === 'hub');

  // ---- build a double jump in the Workshop ------------------------------------------------
  await page.keyboard.press('Tab');
  await page.waitForSelector('.workshop');
  const mat = await page.locator('.mat').boundingBox();

  async function addPart(label, x, y) {
    await page.locator('button.part', { hasText: new RegExp(`^${label}$`) }).first().click();
    await page.waitForTimeout(120);
    const node = page.locator('.react-flow__node.selected').first();
    const id = await node.getAttribute('data-id');
    const tape = node.locator('.tape');
    const tb = await tape.boundingBox();
    await page.mouse.move(tb.x + 20, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(mat.x + x, mat.y + y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    return id;
  }

  async function handleCenter(nodeId, handleId, type) {
    const h = page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle.${type === 'source' ? 'source' : 'target'}[data-handleid="${handleId}"]`);
    const b = await h.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  async function connect(a, aPort, b, bPort) {
    const s = await handleCenter(a, aPort, 'source');
    const t = await handleCenter(b, bPort, 'target');
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(t.x, t.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }

  const onKey = await addPart('On Key Pressed', 90, 90);
  await page.locator(`.react-flow__node[data-id="${onKey}"] select`).first().selectOption('Space');
  const iff = await addPart('If', 450, 90);
  const impulse = await addPart('Apply Impulse', 790, 90);
  const grounded = await addPart('Is Grounded', 90, 400);
  const not = await addPart('NOT', 450, 400);

  await connect(onKey, 'then', iff, 'in');
  await connect(iff, 'then', impulse, 'in');
  await connect(grounded, 'out', not, 'a');
  await connect(not, 'out', iff, 'cond');
  const cables = await page.locator('.react-flow__edge').count();
  check('wires four cables between five blocks', cables === 4, `${cables} cables`);

  // An incompatible wire is refused with a contextual explanation.
  const g2 = await addPart('Is Grounded', 90, 600);
  await connect(g2, 'out', impulse, 'impulse');
  const toast = await page.locator('.toast').textContent().catch(() => '');
  check('incompatible wire is refused with a reason', /True\/False into Vector/.test(toast ?? ''), toast ?? '');
  check('refused wire was not added', (await page.locator('.react-flow__edge').count()) === 4);

  // Undo / redo the stray block.
  const before = await page.locator('.react-flow__node').count();
  await page.locator('.mat').click({ position: { x: 40, y: 40 } });
  // The last two edits were "add block" then "move block": two undos take the block away.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const afterUndo = await page.locator('.react-flow__node').count();
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
  const afterRedo = await page.locator('.react-flow__node').count();
  check('undo removes the last block, redo restores it', afterUndo === before - 1 && afterRedo === before, `${before} → ${afterUndo} → ${afterRedo}`);
  // Delete it for real.
  await page.waitForTimeout(150);
  await page.locator(`.react-flow__node[data-id="${g2}"] .tape`).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  check('deleting a selected block removes it', (await page.locator('.react-flow__node').count()) === before - 1);

  await page.locator('.tape-name').fill('Second Wind');
  await page.locator('.tape-name').press('Enter');
  const status = await page.locator('.status').textContent();
  check('mechanic validates as ready', /^Ready$/.test(status ?? ''), status ?? '');
  await page.screenshot({ path: OUT + 'workshop-double-jump.png' });

  await page.click('text=Test it');
  await page.waitForTimeout(300);

  // ---- walk to the first door ---------------------------------------------------------------
  await key('KeyD', 'keydown');
  await page.waitForFunction(() => window.__SPLICE__.state().pos.x > 1075, null, { timeout: 8000 });
  await key('KeyD', 'keyup');
  await page.waitForTimeout(250);
  await key('KeyE', 'keydown');
  await page.waitForTimeout(60);
  await key('KeyE', 'keyup');
  await page.waitForFunction(() => window.__SPLICE__.state().level === 'c1', null, { timeout: 4000 });
  check('door leads to Cross the Gap', true);

  // ---- leap: run, jump at the edge, jump again at the apex, dash, jump again -----------------
  await page.waitForTimeout(500);
  await key('KeyD', 'keydown');
  await page.waitForFunction(() => window.__SPLICE__.state().pos.x >= 745, null, { timeout: 8000, polling: 'raf' });
  await key('Space', 'keydown');
  await page.waitForFunction(() => window.__SPLICE__.state().vel.y > -60, null, { timeout: 3000, polling: 'raf' });
  await key('Space', 'keyup');
  await page.waitForTimeout(20);
  await key('Space', 'keydown');
  await page.waitForTimeout(40);
  await page.waitForFunction(() => window.__SPLICE__.state().vel.y > -60, null, { timeout: 3000, polling: 'raf' });
  await key('Space', 'keyup');
  await key('ShiftLeft', 'keydown');
  await page.waitForTimeout(50);
  await key('ShiftLeft', 'keyup');
  await page.waitForFunction(() => window.__SPLICE__.state().vel.y > 0, null, { timeout: 3000, polling: 'raf' });
  await key('Space', 'keydown');
  await page.waitForTimeout(50);
  await key('Space', 'keyup');
  await page.screenshot({ path: OUT + 'c1-leap.png' });
  const solved = await page
    .waitForFunction(() => window.__SPLICE__.state().objectiveDone, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  await key('KeyD', 'keyup');
  const s = await state();
  check('Cross the Gap solved with the player-built mechanic', solved, `x=${Math.round(s.pos.x)} alive=${s.alive}`);
  await page.screenshot({ path: OUT + 'c1-solved.png' });
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('splice.v1.progress') ?? '{}'));
  check('completion is saved', progress.completed?.includes('c1'));

  // ---- persistence: reload and check the mechanic survived -----------------------------------
  await page.reload();
  await page.waitForSelector('text=Back to the workshop');
  const lib = await page.evaluate(() => JSON.parse(localStorage.getItem('splice.v1.library')));
  const m = lib.mechanics.find((x) => x.name === 'Second Wind');
  check(
    'mechanic persists across reloads',
    !!m && m.nodes.length === 5 && m.edges.length === 4 && lib.equipped.includes(m.id),
    JSON.stringify(lib.mechanics.map((x) => [x.name, x.nodes.length, x.edges.length, lib.equipped.includes(x.id)])),
  );
  await page.click('text=Back to the workshop');
  await page.waitForTimeout(600);
  const hub = await state();
  const doorLocked = await page.evaluate(() => window.__SPLICE__.runner.world.entities.find((e) => e.kind === 'door' && e.target === 'c2').locked);
  check('second door unlocked after solving the first', hub.level === 'hub' && doorLocked === false);
  await page.screenshot({ path: OUT + 'hub-after.png' });
} catch (e) {
  check('unexpected failure', false, e.message);
  await page.screenshot({ path: OUT + 'failure.png' }).catch(() => {});
} finally {
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
