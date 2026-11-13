// Headless browser check for layout edit mode (#47, design docs/design/block-drag-edit.md §5). Runs on request only:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

const CODE = '// order\nWeb [icon: user]\nAPI [icon: server]\nDB [icon: database]\nWeb > API\nAPI > DB';

test('layout edit mode in a headless browser', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-drag-'));
  const port = await freePort();
  const server = spawn(process.execPath, ['server/index.js', ws], { env: { ...process.env, DRAW_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
    rmSync(ws, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  // Another session's server may share ports: write only once the log names this workspace.
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json();
  const f = await call('POST', '/api/file', { path: 'drag', title: '드래그' });
  await call('PUT', '/api/file?path=drag', { ...f, blocks: [{ id: 'b1', type: 'architecture', code: CODE, x: 0, y: 0, w: 0, h: 0 }] });
  const s = await call('POST', '/api/file', { path: 'seq', title: '시퀀스' });
  await call('PUT', '/api/file?path=seq', { ...s, blocks: [{ id: 's1', type: 'sequence', code: 'Web > API: call\nAPI > Web: reply', x: 0, y: 0, w: 0, h: 0 }] });
  const saved = async () => {
    await new Promise((r) => setTimeout(r, 1500)); // autosave is debounced
    return (await call('GET', '/api/file?path=drag')).blocks[0];
  };

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=drag`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(600);

  const overlay = page.locator('[data-layout-edit]');
  const bar = page.getByRole('status', { name: '레이아웃 안내' });
  const errorBar = page.getByRole('status', { name: '레이아웃 안내' }).filter({ hasText: /코드 오류를 고치면 옮길 수 있어요/ });
  const shot = (name) => page.screenshot({ path: join(process.env.E2E_SHOTS ?? ws, name) });
  const box = await page.locator('[data-canvas]').boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Node spots on screen, read from the overlay picture (each node's icon sits inside it).
  const ICONS = { Web: 'user', API: 'server', DB: 'database' };
  const nodes = async () => {
    const out = {};
    for (const [id, icon] of Object.entries(ICONS)) {
      const b = await overlay.locator(`g[data-icon="${icon}"]`).first().boundingBox({ timeout: 5000 });
      out[id] = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return out;
  };
  const near = (a, b, msg, tol = 1.5) => assert.ok(Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol, `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  const palette = async (title) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: '명령 찾기' }).fill(title);
    await page.getByRole('option', { name: new RegExp(`^${title}`) }).first().click();
    await page.waitForTimeout(300);
  };
  const drag = async (from, to, { up = true, alt = false } = {}) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    if (alt) await page.keyboard.down('Alt');
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await page.waitForTimeout(100);
    if (!up) return;
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    await page.waitForTimeout(400);
  };

  // Select the block, enter from the palette: the overlay shows the same nodes, the bar explains the mode.
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(300);
  assert.equal(await overlay.count(), 0);
  await palette('레이아웃 편집');
  await overlay.waitFor({ timeout: 10000 });
  assert.match(await bar.innerText(), /노드를 끌어 옮겨요/);
  const auto = await nodes();
  await page.mouse.click(auto.Web.x, auto.Web.y);
  assert.equal(await overlay.locator('[data-selected="Web"]').count(), 1);
  await shot('block-drag-edit.png');

  // Escape leaves; the block stays selected, so a press on a node enters again and drags in one go.
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'detached', timeout: 5000 });
  await drag(auto.API, { x: auto.API.x + 60, y: auto.API.y + 45 });
  await overlay.waitFor({ timeout: 5000 });
  let n = await nodes();
  assert.ok(n.API.x - auto.API.x > 30 && n.API.y - auto.API.y > 20, `API moved: ${JSON.stringify([auto.API, n.API])}`);
  near(n.Web, auto.Web, 'Web stays');
  near(n.DB, auto.DB, 'DB stays');
  let b = await saved();
  assert.deepEqual(Object.keys(b.layout.items), ['API']);
  const api1 = b.layout.items.API;
  assert.ok(Number.isInteger(api1.cx * 2) && Number.isInteger(api1.cy * 2), 'centres rounded to 0.5');
  assert.equal(b.layout.basis.type, 'cloud-architecture');

  // Snap: drop DB a few pixels off API's vertical centre line; a guide shows and DB lines up with API.
  const moved = await nodes();
  await drag(moved.DB, { x: moved.API.x + 3, y: moved.DB.y + 30 }, { up: false });
  assert.ok((await overlay.locator('[data-guide]').count()) > 0, 'a snap guide shows while dragging');
  await shot('block-drag-snap.png');
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(await overlay.locator('[data-guide]').count(), 0);
  b = await saved();
  assert.equal(b.layout.items.DB.cx, b.layout.items.API.cx, 'DB snapped to API centre');
  const db1 = b.layout.items.DB;

  // Alt turns snapping off: the same drop keeps the offset.
  n = await nodes();
  await drag(n.DB, { x: n.DB.x + 3, y: n.DB.y }, { alt: true });
  b = await saved();
  assert.notEqual(b.layout.items.DB.cx, db1.cx, 'Alt drag does not snap back');
  await page.keyboard.press('Control+z');
  b = await saved();
  assert.deepEqual(b.layout.items.DB, db1, 'one undo takes back the Alt drag');

  // Arrow keys nudge the selection (DB is selected from its drag): 1 step, 10 with Shift; each is one undo step.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  b = await saved();
  assert.deepEqual([b.layout.items.DB.cx, b.layout.items.DB.cy], [db1.cx + 1, db1.cy + 10]);
  const before = await nodes();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  b = await saved();
  assert.deepEqual([b.layout.items.DB.cx, b.layout.items.DB.cy], [db1.cx + 1, db1.cy], 'one undo takes back one nudge');
  n = await nodes();
  assert.ok(Math.abs(before.DB.y - n.DB.y) > 5, 'the picture follows the undo');
  near(n.Web, auto.Web, 'Web stays through undo');

  // Holding an arrow key (auto-repeat) is one undo step, not one per repeat.
  for (let i = 0; i < 6; i++) await page.keyboard.down('ArrowLeft');
  await page.keyboard.up('ArrowLeft');
  b = await saved();
  assert.equal(b.layout.items.DB.cx, db1.cx + 1 - 6, 'six repeats move six steps');
  await page.keyboard.press('Control+z');
  b = await saved();
  assert.deepEqual([b.layout.items.DB.cx, b.layout.items.DB.cy], [db1.cx + 1, db1.cy], 'one undo takes back the whole hold');
  const kept = b.layout;

  // Ctrl+A selects every node in the block, not every element on the canvas; Delete does nothing in edit mode (it
  // would remove the whole block).
  await page.keyboard.press('Control+a');
  assert.equal(await overlay.locator('[data-selected]').count(), 3, 'Ctrl+A selects the three nodes');
  assert.equal(await page.locator('.block-selected').count(), 0, 'no canvas element gets selected');
  await page.keyboard.press('Delete');
  b = await saved();
  assert.ok(b, 'block still there');
  assert.deepEqual(b.layout, kept);

  // Keys typed outside the canvas (a sidebar row, the page body) are not edit mode's: no nudge, no Escape exit.
  await page.mouse.click(n.DB.x, n.DB.y);
  await page.waitForTimeout(200);
  await page.locator('aside [role="button"]').first().focus();
  for (const k of ['ArrowRight', 'Delete', 'Escape']) await page.keyboard.press(k);
  await page.evaluate(() => document.activeElement?.blur());
  for (const k of ['ArrowDown', 'Backspace', 'Escape']) await page.keyboard.press(k);
  b = await saved();
  assert.deepEqual(b.layout, kept, 'keys outside the canvas do not move nodes');
  assert.equal(await overlay.count(), 1, 'keys outside the canvas do not leave edit mode');
  // Back on the canvas, Enter opens the code (design §5.2); edit mode stays under the panel.
  await page.locator('.excalidraw').focus();
  await page.keyboard.press('Enter');
  const codePanel = page.getByRole('complementary', { name: '다이어그램 코드' });
  await codePanel.locator('.cm-content').waitFor({ timeout: 5000 });
  assert.equal(await overlay.count(), 1, 'edit mode stays while the code is open');
  await codePanel.getByRole('button', { name: '닫기' }).click();
  await page.waitForTimeout(300);
  // A press outside the canvas (the sidebar) leaves edit mode.
  await page.locator('aside').click({ position: { x: 5, y: 300 } });
  await overlay.waitFor({ state: 'detached', timeout: 5000 });
  // The block stays selected, so the palette enters again.
  await palette('레이아웃 편집');
  await overlay.waitFor({ timeout: 5000 });

  // Reset drops the layout (auto layout again); undo brings it back.
  await bar.getByRole('button', { name: '레이아웃 초기화' }).click();
  b = await saved();
  assert.equal(b.layout, undefined);
  n = await nodes();
  for (const id of ['Web', 'API', 'DB']) near(n[id], auto[id], `${id} back in auto layout`);
  await page.keyboard.press('Control+z');
  b = await saved();
  assert.deepEqual(b.layout, kept, 'undo brings the layout back');

  // Done leaves; the selected block says it has a moved layout.
  await bar.getByRole('button', { name: '완료' }).click();
  await overlay.waitFor({ state: 'detached', timeout: 5000 });
  assert.match(await bar.innerText(), /직접 옮긴 배치예요/);
  await shot('block-drag-moved.png');

  // A press on the canvas outside the block leaves edit mode.
  await palette('레이아웃 편집');
  await overlay.waitFor({ timeout: 5000 });
  const settled = await nodes();
  await page.mouse.click(box.x + 40, box.y + box.height - 120);
  await overlay.waitFor({ state: 'detached', timeout: 5000 });

  // Old anchor: after a comment edit the picture is the same; dragging a node must not shift the other nodes.
  await page.mouse.click(settled.Web.x, settled.Web.y);
  await page.waitForTimeout(200);
  // The double-click's first press lands on a node of the selected block, so it enters edit mode; the code opens on top.
  await page.mouse.dblclick(settled.Web.x, settled.Web.y);
  const panel = page.getByRole('complementary', { name: '다이어그램 코드' });
  await panel.locator('.cm-content').waitFor();
  await panel.locator('.cm-line').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' two');
  // The overlay keeps its last picture while the new one is drawn, so the (hidden) block never goes blank.
  for (let i = 0; i < 5; i++) {
    assert.equal(await overlay.count(), 1, 'overlay stays while the code is redrawn');
    await page.waitForTimeout(100);
  }
  await panel.getByRole('button', { name: '닫기' }).click();
  await page.waitForTimeout(500);
  // Edit mode stays through the code panel.
  await overlay.waitFor({ timeout: 5000 });
  n = await nodes();
  for (const id of ['Web', 'API', 'DB']) near(n[id], settled[id], `${id} after a comment edit`);
  // Left and up past the picture's edge: its bounds and origin change.
  await drag(n.Web, { x: n.Web.x - 160, y: n.Web.y - 60 });
  await page.waitForTimeout(600);
  n = await nodes();
  near(n.API, settled.API, 'API stays after the comment edit and drag');
  near(n.DB, settled.DB, 'DB stays after the comment edit and drag');
  const left = n.Web;

  // Error then recovery: broken code ends edit mode and says why; fixed code edits again from the same spots.
  await overlay.locator('[aria-label="레이아웃 편집"]').dblclick({ position: { x: 2, y: 2 } });
  await panel.locator('.cm-content').waitFor();
  await panel.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('\nWeb > ');
  // While the code panel is open the broken code does not end edit mode: the last picture stays, not editable.
  // Wait for the bar to name the error (the code was parsed and refused), not for a fixed time.
  await errorBar.waitFor({ timeout: 10000 });
  assert.equal(await overlay.count(), 1, 'overlay stays through a syntax error while the panel is open');
  // Dragging and nudging a node while the code is broken changes nothing.
  const layoutBefore = (await saved()).layout;
  const frozen = await nodes();
  await drag(frozen.DB, { x: frozen.DB.x + 80, y: frozen.DB.y + 40 });
  for (const k of ['ArrowRight', 'Shift+ArrowDown']) await page.keyboard.press(k);
  assert.deepEqual((await saved()).layout, layoutBefore, 'a drag or nudge during a code error is not saved');
  near(await nodes().then((x) => x.DB), frozen.DB, 'the picture does not move during a code error');
  await page.waitForTimeout(500);
  await panel.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  for (let i = 0; i < 7; i++) await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  await panel.getByRole('button', { name: '닫기' }).click();
  await page.waitForTimeout(500);
  b = await saved();
  assert.equal(b.code, CODE.replace('// order', '// order two'));
  // The error is fixed before the panel closes: edit mode never ended and works again from the same spots.
  assert.equal(await overlay.count(), 1, 'overlay stays after the error is fixed');
  n = await nodes();
  near(n.Web, left, 'Web after the error');
  near(n.API, settled.API, 'API after the error');
  await drag(n.DB, { x: n.DB.x + 120, y: n.DB.y });
  await page.waitForTimeout(600);
  n = await nodes();
  near(n.Web, left, 'Web stays when DB moves');
  near(n.API, settled.API, 'API stays when DB moves');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  n = await nodes();
  near(n.DB, settled.DB, 'undo puts DB back');
  near(n.Web, left, 'Web stays through the undo');
  near(n.API, settled.API, 'API stays through the undo');

  // Ctrl+wheel over the overlay zooms the canvas around the pointer: the node under it stays put, the others spread.
  await page.mouse.move(n.API.x, n.API.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const zoomed = await nodes();
  near(zoomed.API, n.API, 'the node under the pointer stays put', 3);
  assert.ok(Math.hypot(zoomed.Web.x - zoomed.API.x, zoomed.Web.y - zoomed.API.y) > Math.hypot(n.Web.x - n.API.x, n.Web.y - n.API.y) * 1.05, 'zoomed in');

  // Closing the code panel on broken code is the verdict: edit mode ends and the bar says why.
  await overlay.locator('[aria-label="레이아웃 편집"]').dblclick({ position: { x: 2, y: 2 } });
  await panel.locator('.cm-content').waitFor();
  await panel.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('\nWeb > ');
  await errorBar.waitFor({ timeout: 10000 });
  assert.equal(await overlay.count(), 1, 'overlay waits for the panel to close');
  assert.match(await bar.innerText(), /코드 오류를 고치면 옮길 수 있어요/, 'the bar says why nothing moves while the code is broken');
  await panel.getByRole('button', { name: '닫기' }).click();
  await overlay.waitFor({ state: 'detached', timeout: 5000 });
  assert.match(await bar.innerText(), /코드 오류를 고치면 옮길 수 있어요/);

  // Broken code refuses entry and says why.
  await palette('레이아웃 편집');
  await page.waitForTimeout(300);
  assert.equal(await overlay.count(), 0, 'broken code does not enter');
  assert.match(await bar.innerText(), /코드 오류를 고치면 옮길 수 있어요/);
  await shot('block-drag-refused.png');

  // Pressing a block that is not a graph (sequence) never shows the refusal; only a try from the palette does.
  await page.goto(`${BASE}/#file=seq`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(600);
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.block-selected').count(), 1, 'sequence block selected');
  for (let i = 0; i < 2; i++) {
    await page.mouse.click(centre.x, centre.y);
    await page.waitForTimeout(300);
  }
  assert.equal(await bar.count(), 0, 'no refusal on a press');
  await palette('레이아웃 편집');
  assert.match(await bar.innerText(), /이 종류는 아직 노드를 옮길 수 없어요/);
  assert.deepEqual(errors, []);
});
