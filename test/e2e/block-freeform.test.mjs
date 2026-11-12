// Headless browser check for turning a diagram block into plain shapes (#38). Runs on request only:
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

test('a graph block turns into plain shapes and one undo brings it back', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-freeform-'));
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
  const saved = async () => {
    await new Promise((r) => setTimeout(r, 1500)); // autosave is debounced
    return await call('GET', '/api/file?path=drag');
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

  const shot = (name) => page.screenshot({ path: join(process.env.E2E_SHOTS ?? ws, name) });
  const box = await page.locator('[data-canvas]').boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const live = (f) => f.canvas.elements.filter((e) => !e.isDeleted);

  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('button', { name: '자유 도형으로 바꾸기' }).count(), 1, 'the block bar offers the conversion');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('자유 도형');
  await page.getByRole('option', { name: /^자유 도형으로 바꾸기/ }).first().click();
  await page.waitForTimeout(500);

  let after = await saved();
  assert.equal(after.blocks.length, 0, 'the block is gone');
  const els = live(after);
  const count = (type) => els.filter((e) => e.type === type).length;
  // 3 nodes with their labels, 2 edges, no icons.
  await shot('freeform.png');
  assert.equal(count('rectangle'), 3, JSON.stringify(els.map((e) => e.type)));
  assert.equal(count('arrow'), 2);
  assert.equal(count('text'), 3);
  assert.equal(count('image'), 0);
  assert.deepEqual(els.filter((e) => e.type === 'text').map((e) => e.text).sort(), ['API', 'DB', 'Web']);
  assert.ok(els.filter((e) => e.type === 'text').every((e) => e.containerId), 'labels are bound to their shapes');
  assert.ok(els.filter((e) => e.type === 'arrow').every((e) => e.startBinding && e.endBinding), 'arrows are bound at both ends');

  await page.keyboard.press('Control+z');
  after = await saved();
  assert.equal(after.blocks.length, 1, 'one undo brings the block back');
  assert.equal(after.blocks[0].code, CODE);
  assert.equal(live(after).length, 0, 'and takes the shapes away');
  assert.deepEqual(errors, []);
});
