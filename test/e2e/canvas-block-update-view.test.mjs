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
const SHOTS = process.env.DRAW_SHOTS;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });


for (const empty of [false, true]) test(`a view the user zoomed to survives a block update on a file ${empty ? 'that agents fill from empty' : 'that already has blocks'} (E497)`, { skip: SKIP, timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-view-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const abs = join(ws, 'blocks.dpx.json');
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
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const blk = (id, x, code) => ({ id, type: 'flowchart', code, x, y: 0, w: 900, h: 420 });
  const res = await fetch(`${BASE}/api/file`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-drawing': '1' },
    body: JSON.stringify({ path: 'blocks.dpx.json', title: 'blocks', document: { type: 'doc', content: [{ type: 'paragraph' }] }, blocks: empty ? [] : [blk('b1', 0, 'direction right\n\nA > B\n'), blk('b2', 1000, 'direction right\n\nC > D\n')] }),
  });
  assert.ok(res.ok, `POST /api/file: ${res.status}`);
  /** An outside edit of a block's code (an agent writing the file). */
  const setCode = (id, code) => {
    const f = JSON.parse(readFileSync(abs, 'utf8'));
    const has = f.blocks.some((b) => b.id === id);
    const blocks = has ? f.blocks.map((b) => (b.id === id ? { ...b, code } : b)) : [...f.blocks, blk(id, id === 'b1' ? 0 : 1000, code)];
    writeFileSync(abs, JSON.stringify({ ...f, blocks, revision: (f.revision ?? 0) + 10 }));
  };

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=blocks.dpx.json`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(1500);
  const zoom = async () => parseInt(await page.locator('.reset-zoom-button').first().innerText(), 10);
  const opened = await zoom();
  await page.locator('.zoom-out-button').first().click();
  await page.locator('.zoom-out-button').first().click();
  await page.locator('.zoom-out-button').first().click();
  await page.waitForTimeout(500);
  const mine = await zoom();
  assert.ok(mine < opened, `zoomed out: ${opened}% → ${mine}%`);
  // First live update, then a second one.
  for (const code of ['direction right\n\nA > B > X\n', 'direction right\n\nC > D > Y\n']) {
    setCode(code.includes('X') ? 'b1' : 'b2', code);
    await page.waitForTimeout(3000);
    assert.equal(await zoom(), mine, 'the view the user zoomed to is kept after a block update');
  }
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'block-update-kept.png') });
  assert.deepEqual(errors, []);
});
