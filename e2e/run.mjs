// End-to-end browser test. A player builds mechanics in both editors, switches between them, plays
// with them, solves "Cross the Gap", reads the docs, tries an example and uses the debugger.
// Run with `npm run e2e` (builds, serves dist/ with vite preview, drives Chromium).
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
const tap = async (code, ms = 50) => {
  await key(code, 'keydown');
  await page.waitForTimeout(ms);
  await key(code, 'keyup');
};
const selected = () =>
  page.evaluate(() => {
    const s = window.__SPLICE__.app.getState();
    return s.library.mechanics.find((m) => m.id === s.selectedId);
  });

try {
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('text=Start the campaign');
  await page.click('text=Start the campaign');
  await page.waitForTimeout(800);
  check('enters the workshop hub', (await state())?.level === 'hub');

  await page.keyboard.press('Tab');
  await page.waitForSelector('.workshop');
  check('the Workshop opens in Scratch Blocks', (await page.locator('.mode-switch button.on').textContent()) === 'Scratch Blocks');

  // =============================================================== Scratch Blocks
  await page.click('.library >> text=New');
  await page.waitForTimeout(150);
  await page.locator('.tape-name').fill('Delayed Hop');
  await page.locator('.tape-name').press('Enter');
  const ws = await page.locator('.sb-ws').boundingBox();

  async function dragPalette(type, x, y) {
    const item = page.locator(`[data-palette-type="${type}"]`).first();
    await item.scrollIntoViewIfNeeded();
    const b = await item.boundingBox();
    await page.mouse.move(b.x + 12, b.y + 12);
    await page.mouse.down();
    await page.mouse.move(b.x + 40, b.y + 30, { steps: 3 });
    await page.mouse.move(x, y, { steps: 12 });
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  const box = (sel) => page.locator(sel).first().boundingBox();

  await dragPalette('on.keyPressed', ws.x + 220, ws.y + 120);
  let hat = await box('.sb-ws .sb-block.kind-hat');
  await dragPalette('flow.delay', hat.x + 12, hat.y + hat.height + 12);
  const wait = await box('.sb-ws .sb-block.cat-control');
  await dragPalette('act.setVelocity', wait.x + 12, wait.y + wait.height + 12);
  let m = await selected();
  const flowOrder = () =>
    page.evaluate(() => {
      const s = window.__SPLICE__.app.getState();
      const g = s.library.mechanics.find((x) => x.id === s.selectedId);
      const t = (id) => g.nodes.find((n) => n.id === id).type;
      return g.edges.map((e) => `${t(e.from)}.${e.fromPort}>${t(e.to)}`).sort();
    });
  check(
    'blocks snap into one stack: hat → wait → set velocity',
    JSON.stringify(await flowOrder()) === JSON.stringify(['flow.delay.then>act.setVelocity', 'on.keyPressed.then>flow.delay']),
    JSON.stringify(await flowOrder()),
  );

  // Fields: key Q, wait 0.3 → 0.5 (the timing change), Y only, velocity (0, −500).
  await page.locator('.sb-ws .sb-block.kind-hat select').selectOption('Q');
  const delayField = page.locator('.sb-ws .sb-block.cat-control .sb-num').first();
  await delayField.fill('0.3');
  await delayField.press('Enter');
  await delayField.fill('0.5');
  await delayField.press('Enter');
  const action = page.locator('.sb-ws .sb-block.cat-action').first();
  await action.locator('select', { has: page.locator('option', { hasText: 'Y only' }) }).selectOption('y');
  const vy = action.locator('.sb-vec .sb-num').nth(1);
  await vy.fill('-500');
  await vy.press('Enter');
  await page.waitForTimeout(150);
  m = await selected();
  const p = (type) => m.nodes.find((n) => n.type === type).params;
  check('Scratch edits land in the mechanic', p('flow.delay').seconds === 0.5 && p('act.setVelocity').velocity.y === -500 && p('act.setVelocity').axes === 'y' && p('on.keyPressed').key === 'Q');

  // An invalid drop is refused with a reason and changes nothing.
  const edgesBefore = (await selected()).edges.length;
  hat = await box('.sb-ws .sb-block.kind-hat');
  await dragPalette('logic.and', hat.x + 12, hat.y + hat.height + 12);
  const nodesAfterBadDrop = (await selected()).nodes.length;
  check('a reporter dropped where stack blocks go stays loose (no rewiring)', (await selected()).edges.length === edgesBefore, `nodes ${nodesAfterBadDrop}`);
  // drag it back to the palette to delete it
  const loose = await box('.sb-ws .sb-loose .sb-rep');
  const pal = await box('[data-sb-palette]');
  await page.mouse.move(loose.x + 8, loose.y + 8);
  await page.mouse.down();
  await page.mouse.move(loose.x + 30, loose.y + 30, { steps: 3 });
  await page.mouse.move(pal.x + 100, pal.y + 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  check('dropping a block on the palette deletes it', (await selected()).nodes.length === 3);
  await page.screenshot({ path: OUT + 'scratch-built.png' });

  // =============================================================== switch to Blueprint
  await page.click('.mode-switch >> text=Blueprint Blocks');
  await page.waitForSelector('.react-flow__node');
  await page.waitForTimeout(300);
  const bpNodes = await page.locator('.react-flow__node').count();
  const bpEdges = await page.locator('.react-flow__edge').count();
  const bpDelay = await page.locator('.mod[data-type="flow.delay"] input.num').first().inputValue();
  check('Blueprint shows the same mechanic', bpNodes === 3 && bpEdges === 2 && bpDelay === '0.5', `${bpNodes} nodes, ${bpEdges} wires, delay ${bpDelay}`);
  const bpVy = page.locator('.mod[data-type="act.setVelocity"] .vec input').nth(1);
  await bpVy.fill('-650');
  await bpVy.press('Enter');
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT + 'blueprint-edit.png' });

  // =============================================================== and back to Scratch
  await page.click('.mode-switch >> text=Scratch Blocks');
  await page.waitForSelector('.sb-ws .sb-block');
  await page.waitForTimeout(200);
  const scDelay = await page.locator('.sb-ws .sb-block.cat-control .sb-num').first().inputValue();
  const scVy = await page.locator('.sb-ws .sb-block.cat-action .sb-vec .sb-num').nth(1).inputValue();
  const order = await page.evaluate(() => [...document.querySelectorAll('.sb-ws .sb-script .sb-block')].map((el) => el.getAttribute('data-sb-node')));
  m = await selected();
  const expectOrder = ['on.keyPressed', 'flow.delay', 'act.setVelocity'].map((t) => m.nodes.find((n) => n.type === t).id);
  check(
    'switching back loses nothing: same stack, Scratch timing and Blueprint edit both kept',
    scDelay === '0.5' && scVy === '-650' && JSON.stringify(order) === JSON.stringify(expectOrder),
    `delay ${scDelay}, vy ${scVy}`,
  );

  // Undo works across the switch: the Blueprint edit comes back off.
  await page.locator('.sb-ws').click({ position: { x: 20, y: 400 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const undone = (await selected()).nodes.find((n) => n.type === 'act.setVelocity').params.velocity.y;
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
  const redone = (await selected()).nodes.find((n) => n.type === 'act.setVelocity').params.velocity.y;
  check('undo/redo span both editors', undone === -500 && redone === -650, `${undone} → ${redone}`);

  // Inspector shows the real price for the selected block.
  await page.locator('.sb-ws .sb-block.cat-action .sb-head .sb-w').first().click();
  await page.waitForTimeout(200);
  const insp = await page.locator('.insp-cost').textContent().catch(() => '');
  check('the inspector prices the selected action', /Effective energy requirement/.test(insp ?? '') && /Ready/.test(insp ?? ''), (insp ?? '').slice(0, 120));
  await page.screenshot({ path: OUT + 'inspector.png' });

  // =============================================================== play it
  await page.click('text=Test it');
  await page.waitForTimeout(400);
  const before = await state();
  await key('KeyQ', 'keydown');
  await page.waitForFunction(() => window.__SPLICE__.runner.attach.host.traceLog.entries().some((e) => e.kind === 'event' && /Q Pressed/.test(e.text)), null, { timeout: 3000 });
  await key('KeyQ', 'keyup');
  await page.waitForFunction(() => window.__SPLICE__.runner.world.exchange.log.some((t) => t.label === 'Impulse' && t.ok), null, { timeout: 4000 });
  const run = await page.evaluate(() => {
    const host = window.__SPLICE__.runner.attach.host;
    const pressed = host.traceLog.entries().find((e) => e.kind === 'event' && /Q Pressed/.test(e.text));
    const set = host.traceLog.entries().find((e) => e.nodeType === 'act.setVelocity');
    return { t0: pressed.time, t1: set.time, dv: set.quote?.lines.find((l) => l.label === 'Velocity change')?.value, paid: set.cost.energy };
  });
  const after = await state();
  check('the mechanic runs: the hop starts 0.5 s (sim time) after Q, at 650 px/s', Math.abs(run.t1 - run.t0 - 0.5) < 0.02 && Math.abs(run.dv - 650) < 1, `waited ${(run.t1 - run.t0).toFixed(3)} s, Δv ${run.dv}`);
  check('and it was paid for', after.energy < before.energy && run.paid > 20, `${before.energy.toFixed(1)} → ${after.energy.toFixed(1)}`);

  // =============================================================== save / reload
  await page.reload();
  await page.waitForSelector('.title-menu .btn.go');
  await page.click('.title-menu .btn.go');
  await page.waitForTimeout(600);
  await page.keyboard.press('Tab');
  await page.waitForSelector('.workshop');
  await page.locator('.library button', { hasText: 'Delayed Hop' }).first().click();
  await page.waitForTimeout(200);
  const rDelay = await page.locator('.sb-ws .sb-block.cat-control .sb-num').first().inputValue();
  const rVy = await page.locator('.sb-ws .sb-block.cat-action .sb-vec .sb-num').nth(1).inputValue();
  await page.click('.mode-switch >> text=Blueprint Blocks');
  await page.waitForSelector('.react-flow__node');
  await page.waitForTimeout(200);
  const rBp = await page.locator('.mod[data-type="flow.delay"] input.num').first().inputValue();
  check('after a reload both editors show the saved mechanic', rDelay === '0.5' && rVy === '-650' && rBp === '0.5', `${rDelay} ${rVy} ${rBp}`);

  // =============================================================== Blueprint: build an air jump
  await page.click('.library >> text=New');
  await page.waitForTimeout(150);
  await page.locator('.tape-name').fill('Second Wind');
  await page.locator('.tape-name').press('Enter');
  // More room on the mat: hide the inspector while wiring.
  await page.click('.ws-tools >> text=Inspector');
  await page.waitForTimeout(150);
  const mat = await page.locator('.mat').boundingBox();
  async function addPart(label, x, y) {
    await page.locator('button.part', { hasText: new RegExp(`^${label}$`) }).first().click();
    await page.waitForTimeout(120);
    const node = page.locator('.react-flow__node.selected').first();
    const id = await node.getAttribute('data-id');
    const tb = await node.locator('.tape').boundingBox();
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
  check('Blueprint: wires four cables between five blocks', (await page.locator('.react-flow__edge').count()) === 4);

  const g2 = await addPart('Is Grounded', 90, 600);
  await connect(g2, 'out', impulse, 'impulse');
  const toast = await page.locator('.toast').textContent().catch(() => '');
  check('Blueprint: an incompatible wire is refused with a reason', /True\/False into Vector/.test(toast ?? ''), toast ?? '');
  await page.locator(`.react-flow__node[data-id="${g2}"] .tape`).click();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);

  // Drop a wire on empty space: the search offers only blocks that fit.
  const out = await handleCenter(impulse, 'then', 'source');
  await page.mouse.move(out.x, out.y);
  await page.mouse.down();
  await page.mouse.move(out.x + 40, out.y + 420, { steps: 10 });
  await page.mouse.up();
  const searchOpen = await page.waitForSelector('.node-search', { timeout: 2000 }).then(() => true).catch(() => false);
  const offersEvents = await page.locator('.node-search li', { hasText: 'On Key Pressed' }).count();
  check('Blueprint: dropping a flow wire opens a search of blocks that take flow', searchOpen && offersEvents === 0);
  await page.keyboard.press('Escape');
  check('Blueprint mechanic validates as ready', /^Ready$/.test((await page.locator('.status').first().textContent()) ?? ''));

  await page.click('.ws-tools >> text=Inspector');
  // Switch to Scratch: the Blueprint-built mechanic reads as stacks.
  await page.click('.mode-switch >> text=Scratch Blocks');
  await page.waitForSelector('.sb-ws .sb-block');
  const cblock = await page.locator('.sb-ws .sb-block.kind-c').count();
  check('the Blueprint-built mechanic opens in Scratch as a hat with an if-block', cblock === 1);

  // Unequip the hop so Q doesn't interfere, then play Cross the Gap.
  await page.click('text=Test it');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = window.__SPLICE__.app.getState();
    const hop = s.library.mechanics.find((x) => x.name === 'Delayed Hop');
    if (hop && s.library.equipped.includes(hop.id)) s.toggleEquip(hop.id);
  });

  // =============================================================== Cross the Gap
  await key('KeyD', 'keydown');
  await page.waitForFunction(() => window.__SPLICE__.state().pos.x > 1048, null, { timeout: 12000 });
  await key('KeyD', 'keyup');
  await page.waitForTimeout(250);
  await tap('KeyE', 60);
  await page.waitForFunction(() => window.__SPLICE__.state().level === 'c1', null, { timeout: 4000 });
  check('door leads to Cross the Gap', true);
  await page.waitForTimeout(500);
  await key('KeyD', 'keydown');
  await page.waitForFunction(() => window.__SPLICE__.state().pos.x >= 750, null, { timeout: 8000, polling: 'raf' });
  await key('Space', 'keydown');
  await page.waitForFunction(() => window.__SPLICE__.state().vel.y > -40, null, { timeout: 3000, polling: 'raf' });
  await key('Space', 'keyup');
  await page.waitForTimeout(20);
  await key('Space', 'keydown');
  await page.screenshot({ path: OUT + 'c1-leap.png' });
  const solved = await page
    .waitForFunction(() => window.__SPLICE__.state().objectiveDone, null, { timeout: 9000 })
    .then(() => true)
    .catch(() => false);
  await key('Space', 'keyup');
  await key('KeyD', 'keyup');
  const s = await state();
  check('Cross the Gap solved with a home-made double jump (no dash)', solved, `x=${Math.round(s.pos.x)} alive=${s.alive}`);
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('splice.v1.progress') ?? '{}'));
  check('completion is saved', progress.completed?.includes('c1'));
  await page.waitForFunction(() => window.__SPLICE__.state().level === 'hub', null, { timeout: 8000 }).catch(() => {});
  const doorLocked = await page.evaluate(() => window.__SPLICE__.runner.world.entities.find((e) => e.kind === 'door' && e.target === 'c2')?.locked);
  check('the second door unlocks after solving the first', doorLocked === false);

  // =============================================================== docs, examples, debugger
  await page.keyboard.press('F1');
  await page.waitForSelector('.docs');
  await page.fill('.docs-search', 'windup');
  await page.waitForTimeout(150);
  const hits = await page.locator('.doc-results li').count();
  check('docs search finds windup material', hits > 2, `${hits} results`);
  await page.fill('.docs-search', '');
  await page.click('.docs-nav >> text=Energy and the Law of Equivalent Exchange');
  const energyText = await page.locator('.docs-main').textContent();
  check('the energy article shows computed figures', /0\.6\d|0\.7\d/.test(energyText ?? '') && !/\{\{/.test(energyText ?? ''));
  await page.click('.docs-nav >> text=Examples');
  await page.click('.doc-cards >> text=Air Dash');
  await page.click('text=Try it in the testbench');
  await page.waitForFunction(() => window.__SPLICE__.state().level === 'testbench', null, { timeout: 4000 });
  await page.waitForTimeout(400);
  await tap('Space', 120);
  await page.waitForTimeout(120);
  await tap('KeyQ', 40);
  await page.waitForTimeout(150);
  const dashed = await page.evaluate(() => window.__SPLICE__.runner.world.exchange.log.some((t) => t.label === 'Impulse' && t.ok));
  check('an example runs in the testbench on the real engine', dashed);
  await page.keyboard.press('Backquote');
  await page.waitForSelector('.dbg-overlay');
  await page.waitForTimeout(400);
  const traceText = await page.locator('.dbg-overlay').textContent();
  check('the debugger trace shows what ran', /On Q Pressed/.test(traceText ?? '') && /Set Velocity/.test(traceText ?? ''));
  await page.screenshot({ path: OUT + 'debugger.png' });
  await page.keyboard.press('Backquote');
  await page.click('.trial-banner button');
  await page.waitForFunction(() => window.__SPLICE__.state().level === 'hub', null, { timeout: 4000 });

  // =============================================================== narrow screen + keyboard
  await page.setViewportSize({ width: 700, height: 900 });
  await page.keyboard.press('Tab');
  await page.waitForSelector('.workshop');
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const switchVisible = await page.locator('.mode-switch').isVisible();
  check('narrow layout: no sideways scrolling, the editor switch is reachable', overflow <= 0 && switchVisible, `overflow ${overflow}px`);
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(200);
  const kbMode = await page.locator('.mode-switch button.on').textContent();
  await page.keyboard.press('Control+1');
  check('Ctrl+2 / Ctrl+1 switch editors from the keyboard', kbMode === 'Blueprint Blocks');
  await page.screenshot({ path: OUT + 'narrow.png' });
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
