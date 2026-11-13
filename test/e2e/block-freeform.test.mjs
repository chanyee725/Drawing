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

/** Server on a free port against a scratch workspace, a file `path` with `put` applied, and a headless page on its canvas. */
async function open(t, path, put) {
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

  const call = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) })).json();
  const f = await call('POST', '/api/file', { path, title: '드래그' });
  await call('PUT', `/api/file?path=${path}`, put(f));
  const saved = async () => {
    await new Promise((r) => setTimeout(r, 1500)); // autosave is debounced
    return await call('GET', `/api/file?path=${path}`);
  };

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=${path}`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(600);
  return { page, saved, errors, ws };
}

const SKIP = { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 };

test('a graph block turns into plain shapes and one undo brings it back', SKIP, async (t) => {
  const { page, saved, errors, ws } = await open(t, 'drag', (f) => ({ ...f, blocks: [{ id: 'b1', type: 'architecture', code: CODE, x: 0, y: 0, w: 0, h: 0 }] }));

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

test('a block inside a frame converts into shapes that stay in that frame', SKIP, async (t) => {
  const el = (o) => ({ angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...o });
  const frame = el({ id: 'frame_1', type: 'frame', x: 0, y: 0, width: 1000, height: 1000, name: '구조도', frameId: null });
  const block = { id: 'b1', type: 'architecture', code: 'G [icon: server] {\n  Web [icon: user]\n  API [icon: server]\n}\nWeb > API', x: 350, y: 400, w: 300, h: 200 };
  const { page, saved, errors, ws } = await open(t, 'fr', (f) => ({ ...f, canvas: { ...f.canvas, elements: [frame] }, blocks: [block] }));

  // Shift+1 fits the frame to the view; the block sits in its middle (its height refits to the picture, around y 500).
  const box = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '자유 도형으로 바꾸기' }).click();
  await page.waitForTimeout(500);

  const after = await saved();
  await page.screenshot({ path: join(process.env.E2E_SHOTS ?? ws, 'freeform-frame.png') });
  assert.equal(after.blocks.length, 0, 'the block is gone');
  const made = after.canvas.elements.filter((e) => !e.isDeleted && e.id !== 'frame_1');
  assert.ok(made.length >= 5, JSON.stringify(made.map((e) => e.type)));
  assert.deepEqual([...new Set(made.map((e) => e.frameId))], ['frame_1'], 'every shape, label and arrow is in the frame');
  const title = made.find((e) => e.type === 'text' && e.text === 'G');
  const group = made.find((e) => e.type === 'rectangle' && e.strokeStyle === 'dashed');
  assert.ok(title && group, 'group box and its title');
  // The picture is scaled about 1.5x here: the padding alone is about 21, with the icon gap left in it would be about 58.
  assert.ok(title.x - group.x < 30, `the title takes the icon slot (title ${title.x}, box ${group.x})`);

  // One undo brings the block back and takes the shapes away, the frame stays.
  await page.keyboard.press('Control+z');
  const undone = await saved();
  assert.equal(undone.blocks.length, 1, 'one undo brings the block back');
  assert.equal(undone.blocks[0].code, block.code);
  assert.deepEqual(undone.canvas.elements.filter((e) => !e.isDeleted).map((e) => e.id), ['frame_1'], 'and takes the shapes away');
  assert.deepEqual(errors, []);
});

test('a block saved in a frame is in it after a reload, even where it sticks out of the frame (#83)', SKIP, async (t) => {
  const el = (o) => ({ angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...o });
  const frame = el({ id: 'frame_1', type: 'frame', x: 0, y: 0, width: 1000, height: 1000, name: '구조도', frameId: null });
  // Its right part sticks out of the frame, so only the stored frame can put it there (no frame holds it whole).
  const block = { id: 'b1', type: 'architecture', code: 'Web [icon: user]\nAPI [icon: server]\nWeb > API', x: 500, y: 400, w: 600, h: 200, frameId: 'frame_1' };
  const { page, saved, errors, ws } = await open(t, 'fr2', (f) => ({ ...f, canvas: { ...f.canvas, elements: [frame] }, blocks: [block] }));

  // Opening the file is a reload: the block keeps its frame.
  assert.equal((await saved()).blocks[0].frameId, 'frame_1', 'the stored frame survives the load and the autosave');
  const box = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '자유 도형으로 바꾸기' }).click();
  await page.waitForTimeout(500);

  const after = await saved();
  await page.screenshot({ path: join(process.env.E2E_SHOTS ?? ws, 'freeform-frame-reload.png') });
  assert.equal(after.blocks.length, 0, 'the block is gone');
  const made = after.canvas.elements.filter((e) => !e.isDeleted && e.id !== 'frame_1');
  assert.ok(made.length >= 4, JSON.stringify(made.map((e) => e.type)));
  assert.deepEqual([...new Set(made.map((e) => e.frameId))], ['frame_1'], 'the shapes stay in the frame');
  assert.deepEqual(errors, []);
});
