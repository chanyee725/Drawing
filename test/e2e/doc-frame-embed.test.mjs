// Headless browser check for embedding a canvas frame in the document (#32). Runs on request only:
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

test('frame embed: / menu, preview, jump to the canvas, deleted frame', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-frame-'));
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
  const box = el({ id: 'box_1', type: 'rectangle', x: 140, y: 140, width: 120, height: 80, frameId: 'frame_1', backgroundColor: '#a5d8ff' });
  const bare = el({ id: 'frame_2', type: 'frame', x: 700, y: 100, width: 300, height: 200, name: '', frameId: null });
  // The canvas refits its height to the picture (about 416), so the centre still lies inside the frame.
  const block = { id: 'b_in', type: 'architecture', code: 'title T\nWeb [icon: user]', x: 110, y: 110, w: 240, h: 120 };
  let f = await call('POST', '/api/file', { path: 'fr', title: '프레임' });
  f = await call('PUT', '/api/file?path=fr', { ...f, version: 2, canvas: { ...f.canvas, elements: [frame, box, bare] }, blocks: [block], document: { type: 'doc', content: [{ type: 'paragraph' }] } });

  browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/#file=fr`);
  await page.waitForSelector('.doc-editor');

  // / menu lists the frame; choosing it puts a read-only preview in the document.
  await page.locator('.doc-editor p').first().click();
  await page.keyboard.type('/구조');
  const item = page.getByRole('option', { name: /프레임 넣기: 구조도/ });
  await item.waitFor();
  await item.click();
  const pic = page.locator('.doc-frame .doc-diagram-pic img');
  await pic.waitFor({ timeout: 30000 });
  assert.match(await pic.getAttribute('src'), /^data:image\/svg\+xml/);
  assert.equal(await page.locator('.doc-frame figcaption').textContent(), '프레임 구조도 · 누르면 캔버스로 가요');
  await page.locator('[data-save="saved"]').waitFor();
  // The diagram block inside the frame is drawn in the preview (it is not a canvas element).
  await page.waitForFunction(() => decodeURIComponent(document.querySelector('.doc-frame .doc-diagram-pic img')?.getAttribute('src') ?? '').includes('data-block-id'), null, { timeout: 30000 });
  const svgText = decodeURIComponent((await pic.getAttribute('src')).split(',')[1]);
  assert.match(svgText, /data-block-id="b_in"/);
  let saved = await call('GET', '/api/file?path=fr');
  const node = saved.document.content.find((n) => n.type === 'frameEmbed');
  assert.deepEqual(node.attrs, { frameId: 'frame_1', name: '구조도' });

  // Dark mode: Excalidraw inverts the whole exported SVG, so the block layer is drawn pre-corrected for that filter.
  const lightPic = /<image[^>]*data-block-id="b_in"/.exec(svgText)?.[0].match(/href="([^"]+)"/)?.[1];
  const dark = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' })).newPage();
  await dark.goto(`${BASE}/#file=fr`);
  await dark.waitForFunction(() => decodeURIComponent(document.querySelector('.doc-frame .doc-diagram-pic img')?.getAttribute('src') ?? '').includes('data-block-id'), null, { timeout: 30000 });
  const darkSvg = decodeURIComponent((await dark.locator('.doc-frame .doc-diagram-pic img').getAttribute('src')).split(',')[1]);
  assert.match(darkSvg, /invert\(/, 'the export is in dark mode');
  const darkPic = /<image[^>]*data-block-id="b_in"/.exec(darkSvg)?.[0].match(/href="([^"]+)"/)?.[1];
  assert.ok(lightPic && darkPic);
  // E17: a dark export puts Excalidraw's dark filter over the SVG, so its block pictures are the dark palette
  // pre-corrected for that filter (like on the dark canvas), not the light picture.
  assert.notEqual(darkPic, lightPic, 'frame preview draws blocks with the pre-corrected dark palette in dark mode');
  await dark.close();

  // Clicking the preview shows the frame on the canvas and selects it. Check the selection itself:
  // Delete removes the selected elements, so only the frame itself may go; its child and the other frame stay.
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.locator('.doc-frame .doc-diagram-pic').click();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Delete');
  let live = [];
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(200);
    live = ((await call('GET', '/api/file?path=fr')).canvas.elements ?? []).filter((e) => !e.isDeleted).map((e) => e.id);
    if (!live.includes('frame_1')) break;
  }
  assert.deepEqual(live, ['box_1', 'frame_2']);

  // An unnamed frame is numbered by its place among the frames.
  await page.reload();
  await page.waitForSelector('.doc-editor');
  await page.locator('.doc-editor p').first().click();
  await page.keyboard.type('/프레임');
  await page.getByRole('option', { name: /프레임 넣기: 프레임 1/ }).waitFor();
  await page.keyboard.press('Escape');
  saved = await call('GET', '/api/file?path=fr');

  // Delete the frame on the canvas: the embed shows a broken-reference note, keeping the saved name.
  await call('PUT', '/api/file?path=fr', { ...saved, canvas: { ...saved.canvas, elements: [] } });
  await page.reload();
  await page.waitForSelector('.doc-frame');
  await page.locator('.doc-frame [role=note]').waitFor();
  assert.match(await page.locator('.doc-frame [role=note]').textContent(), /"구조도" 프레임을 찾을 수 없어요/);
  assert.deepEqual(errors, []);
});
