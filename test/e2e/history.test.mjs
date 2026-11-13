// Headless browser check: save -> version history list -> preview -> restore.
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

test('version history: list, preview, restore', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-hist-e2e-'));
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
  const f = await call('POST', '/api/file', { path: 'hist', title: 'Old title' });
  await call('PUT', '/api/file?path=hist', { ...f, title: 'Old title' }); // first save makes the first version

  browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/#file=hist`);
  const title = page.getByLabel('파일 제목');
  await title.waitFor();
  await title.fill('New title');
  // Wait for the save itself (the server has the new title), not for a status text that may already be showing.
  // Poll from Node: waitForFunction treats an async predicate's Promise as truthy and would not wait.
  for (let i = 0; (await call('GET', '/api/file?path=hist')).title !== 'New title'; i++) {
    assert.ok(i < 100, 'the new title was not saved within 10 s');
    await new Promise((r) => setTimeout(r, 100));
  }

  await page.getByRole('button', { name: '버전 기록' }).click();
  const dialog = page.getByRole('dialog', { name: '버전 기록' });
  await dialog.waitFor();
  const items = dialog.getByRole('list', { name: '저장된 버전' }).getByRole('button');
  await items.first().waitFor(); // the list loads after the dialog opens
  assert.equal(await items.count(), 1); // second save is inside the 5-minute window
  await dialog.getByText('읽기 전용 미리보기예요').waitFor();
  assert.match(await dialog.getByTestId('history-doc').innerText(), /Old title/);

  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: '이 버전으로 되돌리기' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('input[aria-label="파일 제목"]')?.value === 'Old title');

  const now = await call('GET', '/api/file?path=hist');
  assert.equal(now.title, 'Old title');
  const versions = (await call('GET', '/api/history?path=hist')).versions;
  assert.equal(versions.length, 2); // the state before the restore was kept
  const kept = await call('GET', `/api/history/version?path=hist&id=${versions[0].id}`);
  assert.equal(kept.title, 'New title');
});
