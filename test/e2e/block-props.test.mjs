// Headless browser check: the property pickers in the code panel write global style lines into the code.
// Needs a Chromium and playwright-core, so it only runs on request:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir, and refuses to go on
// unless the server's own log names that port and folder.
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

test('property pickers edit the code', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-props-'));
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

  const call = async (m, u, b) => {
    const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) });
    return r.json();
  };
  const f = await call('POST', '/api/file', { path: 'props', title: 'Props' });
  await call('PUT', '/api/file?path=props', {
    ...f,
    version: 2,
    blocks: [{ id: 'b1', type: 'architecture', code: 'title T\nWeb [icon: user]', x: 0, y: 0, w: 0, h: 0 }],
    document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }] },
  });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=props`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(500);

  const panel = page.getByRole('complementary', { name: '다이어그램 코드' });
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(400);
  const box = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await panel.locator('.cm-content').waitFor();

  await panel.locator('[data-prop="colorMode"]').selectOption('bold');
  await panel.locator('[data-prop="direction"]').selectOption('down');
  await page.waitForTimeout(300);
  const text = async () => (await panel.locator('.cm-content').innerText()).replace(/\u00a0/g, ' ');
  assert.equal(await text(), 'title T\ndirection down\ncolorMode bold\nWeb [icon: user]');

  await panel.locator('[data-prop="colorMode"]').selectOption('');
  await page.waitForTimeout(300);
  assert.equal(await text(), 'title T\ndirection down\nWeb [icon: user]');
  assert.deepEqual(errors, []);
});
