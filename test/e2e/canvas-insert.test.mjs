// Headless browser check for the canvas `/` insert menu (#27). Runs on request only, like export-shortcuts:
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

test('canvas insert menu in a headless browser', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-insert-'));
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
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) })).json();
  await call('POST', '/api/file', { path: 'ins', title: '삽입' });
  const saved = async () => {
    await new Promise((r) => setTimeout(r, 1500)); // autosave is debounced
    const g = await call('GET', '/api/file?path=ins');
    return { free: (g.canvas.elements ?? []).filter((e) => !e.isDeleted), blocks: g.blocks };
  };

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 300)));
  await page.goto(`${BASE}/#file=ins`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(500);
  const menu = page.getByRole('listbox', { name: '캔버스에 넣기' });
  const open = async (x, y) => {
    await page.mouse.click(x, y);
    await page.keyboard.press('/');
    await menu.waitFor({ timeout: 5000 });
  };

  // `/` opens the menu; Escape closes it without inserting.
  await open(700, 450);
  assert.ok(await page.getByRole('option', { name: /사각형/ }).isVisible());
  await page.screenshot({ path: join(process.env.E2E_SHOTS ?? ws, 'canvas-insert-menu.png') });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached', timeout: 5000 });

  // Filter + Enter inserts a rectangle, selected and saved.
  await open(700, 450);
  await page.keyboard.type('네모');
  assert.equal(await page.getByRole('option').count(), 1);
  await page.keyboard.press('Enter');
  await menu.waitFor({ state: 'detached', timeout: 5000 });
  let s = await saved();
  assert.deepEqual(s.free.map((e) => e.type), ['rectangle']);

  // Text and frame by click.
  await open(400, 300);
  await page.getByRole('option', { name: /텍스트/ }).click();
  await open(1000, 600);
  await page.keyboard.type('frame');
  await page.keyboard.press('Enter');
  s = await saved();
  assert.deepEqual(s.free.map((e) => e.type).sort(), ['frame', 'rectangle', 'text']);
  assert.equal(s.free.find((e) => e.type === 'text').text, '텍스트');

  // A diagram block starts from its example and opens its code.
  await open(700, 450);
  await page.keyboard.type('erd');
  await page.keyboard.press('Enter');
  await page.getByRole('complementary', { name: '다이어그램 코드' }).waitFor({ timeout: 10000 });
  s = await saved();
  assert.equal(s.blocks.length, 1);
  assert.equal(s.blocks[0].type, 'erd');
  assert.ok(s.blocks[0].w > 0 && s.blocks[0].h > 0);
  await page.screenshot({ path: join(process.env.E2E_SHOTS ?? ws, 'canvas-insert.png') });

  // Inside the code panel `/` is just a slash.
  await page.locator('aside .cm-content').click();
  await page.keyboard.press('/');
  assert.equal(await menu.count(), 0);
  assert.deepEqual(errors, []);
});
