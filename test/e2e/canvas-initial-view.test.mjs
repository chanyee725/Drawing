// Headless check of the canvas's opening view (E494, #357; E494b, #359), through ExcalidrawCanvas itself:
// an empty file that an agent fills from outside fits the new blocks, and a view the user moved to is kept when
// the file changes again. Runs on request only:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Needs `npm run build` first. It starts its own server on a free port against a scratch workspace inside a scratch
// git repo (one commit) in a temp dir, and refuses to go on unless the server log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SKIP = !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run';
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

const rect = (id, x, y) => ({ id, type: 'rectangle', x, y, width: 300, height: 200, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false });

test('an empty file an agent fills fits the new blocks; a view the user moved to is kept', { skip: SKIP, timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-view-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const abs = join(ws, 'fill.dpx.json');
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
    rmSync(repo, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  // Another session's server may share ports: write only once the log names this workspace.
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const res = await fetch(`${BASE}/api/file`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: JSON.stringify({ path: 'fill.dpx.json', title: 'fill' }) });
  assert.ok(res.ok, `POST /api/file: ${res.status}`);
  /** An outside edit (an agent writing the file): the canvas gets `elements`. */
  const write = (elements) => {
    const f = JSON.parse(readFileSync(abs, 'utf8'));
    writeFileSync(abs, JSON.stringify({ ...f, canvas: { ...f.canvas, elements }, revision: (f.revision ?? 0) + 10 }));
  };

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  // Wide enough for Excalidraw's zoom controls.
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=fill.dpx.json`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(800);
  const zoom = async () => parseInt(await page.locator('.reset-zoom-button').first().innerText(), 10);
  /** The zoom once it has settled after an outside edit (the canvas reloads the file). */
  const zoomAfterEdit = async (until) => {
    let z = await zoom();
    for (let i = 0; i < 40 && !until(z); i++) {
      await page.waitForTimeout(100);
      z = await zoom();
    }
    return z;
  };

  // Empty: Excalidraw's own view at 100%.
  assert.equal(await zoom(), 100);

  // The agent adds blocks at x=3000 and x=6000: the view fits them (3000..6300 wide in 1500px: well under 50%).
  write([rect('a', 3000, 0), rect('b', 6000, 0)]);
  const fitted = await zoomAfterEdit((z) => z < 100);
  assert.ok(fitted <= 40, `the new blocks were fitted, zoom ${fitted}%`);

  // The user zooms in; another outside edit keeps their view.
  await page.locator('.zoom-in-button').first().click();
  await page.locator('.zoom-in-button').first().click();
  const mine = await zoom();
  assert.ok(mine > fitted, `zoomed in: ${fitted}% → ${mine}%`);
  await page.waitForTimeout(300);
  write([rect('a', 3000, 0), rect('b', 6000, 0), rect('c', 20000, 0)]);
  await page.waitForTimeout(2500);
  assert.equal(await zoom(), mine, 'the view the user moved to is kept');
  assert.deepEqual(errors, []);
});
