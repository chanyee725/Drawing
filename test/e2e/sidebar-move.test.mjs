// Headless browser check: dragging in the sidebar moves things only onto a folder row; a refused drop
// (own folder, a child folder, a file row) must not fall through to "move to the root".
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir, and refuses to go on
// unless the server's own log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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

test('refused sidebar drops do not move to the root', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-move-'));
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

  const call = (m, u, b) => fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
  await call('POST', '/api/folder', { path: 'outer/inner' });
  await call('POST', '/api/folder', { path: 'dest' });
  await call('POST', '/api/file', { path: 'outer/note', title: 'Note' });
  await call('POST', '/api/file', { path: 'top', title: 'Top' });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(BASE);
  const nav = page.getByRole('navigation', { name: '파일 목록' });
  const row = (text) => nav.getByRole('button').filter({ hasText: text }).first();
  await row('Note').waitFor();
  const settle = () => page.waitForTimeout(700);

  // The folder onto itself, onto its own child, and onto a file row: nothing moves.
  await row('outer').dragTo(row('inner'));
  await settle();
  await row('outer').dragTo(row('Note'));
  await settle();
  await row('Note').dragTo(row('Top'));
  await settle();
  // Last, because a drag from and to the same row also clicks it (which folds the folder).
  await row('outer').dragTo(row('outer'));
  await settle();
  assert.ok(existsSync(join(ws, 'outer', 'inner')), 'outer/inner stays');
  assert.ok(existsSync(join(ws, 'outer', 'note.dpx.json')), 'outer/note stays');
  assert.ok(!existsSync(join(ws, 'inner')), 'inner was not moved to the root');
  assert.ok(!existsSync(join(ws, 'note.dpx.json')), 'note was not moved to the root');

  // A real drop on a folder row still moves, and the list background still means the root.
  await row('Top').dragTo(row('dest'));
  await settle();
  assert.ok(existsSync(join(ws, 'dest', 'top.dpx.json')), 'top moved into dest');
  await row('Top').dragTo(nav, { targetPosition: { x: 100, y: 500 } });
  await settle();
  assert.ok(existsSync(join(ws, 'top.dpx.json')), 'top moved back to the root');
  assert.deepEqual(errors, []);
});
