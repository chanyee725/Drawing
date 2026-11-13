// Headless browser check for the document screen on a narrow (375px) window (design review P1-4, #189).
// Runs on request only:
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

test('narrow document screen: one pane at a time, ⋯ menu, a frame click goes to the canvas', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-narrow-'));
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
  const el = (o) => ({ angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...o });
  const frame = el({ id: 'frame_1', type: 'frame', x: 100, y: 100, width: 400, height: 300, name: '구조도', frameId: null });
  const box = el({ id: 'box_1', type: 'rectangle', x: 140, y: 140, width: 120, height: 80, frameId: 'frame_1' });
  let f = await call('POST', '/api/file', { path: 'nd', title: '좁은 화면' });
  f = await call('PUT', '/api/file?path=nd', {
    ...f,
    version: 2,
    canvas: { ...f.canvas, elements: [frame, box] },
    document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '본문이에요.' }] }, { type: 'frameEmbed', attrs: { frameId: 'frame_1', name: '구조도' } }] },
  });

  browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/#file=nd`);
  await page.waitForSelector('.doc-editor');

  // One pane: the document shows, the canvas does not, and the view switch has no 둘 다.
  const views = page.getByRole('toolbar', { name: '보기 방식' });
  assert.equal(await views.getByRole('button', { name: '둘 다' }).count(), 0, 'no 둘 다 below md');
  assert.equal(await views.getByRole('button', { name: '문서' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.excalidraw').count(), 0, 'canvas pane is not shown next to the document');

  // The document is not squeezed: it uses most of the window width.
  const docWidth = await page.locator('.doc-editor').evaluate((n) => n.getBoundingClientRect().width);
  assert.ok(docWidth > 300, `document pane is ${docWidth}px wide`);

  // Nothing in the top bar spills past the right edge of the window.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);

  // ⋯ holds 버전 기록 (내보내기 is its own icon button) and is a 44px touch target.
  const more = page.getByRole('button', { name: '더 보기' });
  const size = await more.evaluate((n) => n.getBoundingClientRect());
  assert.ok(size.width >= 44 && size.height >= 44, `⋯ is ${size.width}x${size.height}`);
  await more.click();
  await page.getByRole('menuitem', { name: /버전 기록/ }).waitFor();
  await page.keyboard.press('Escape');

  // Clicking the frame preview in the document switches to the canvas (not to a hidden 둘 다).
  await page.locator('.doc-frame .doc-diagram-pic').waitFor({ timeout: 30000 });
  await page.locator('.doc-frame .doc-diagram-pic').click();
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  assert.equal(await views.getByRole('button', { name: '캔버스' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.doc-editor').count(), 0, 'document pane is hidden while the canvas shows');

  assert.deepEqual(errors, []);
});
