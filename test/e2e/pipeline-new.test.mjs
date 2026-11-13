// Headless browser check (E18): the sidebar "+" menu makes a pipeline from the template under pipelines/,
// and a file with a plan shows the 계획 badge in the tree.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
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

test('new pipeline from the sidebar menu gets the template and the plan badge', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-pipeline-'));
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
  await call('POST', '/api/file', { path: 'plain', title: 'Plain' });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  page.on('dialog', (d) => void d.accept('release'));
  await page.goto(BASE);
  const nav = page.getByRole('navigation', { name: '파일 목록' });
  const row = (text) => nav.getByRole('button').filter({ hasText: text }).first();
  await row('Plain').waitFor();
  assert.equal(await nav.getByRole('img', { name: '파이프라인: 계획' }).count(), 0, 'a plain file has no badge');

  await page.getByRole('button', { name: '새로 만들기' }).click();
  const items = page.getByRole('menuitem');
  assert.deepEqual(await items.allTextContents(), ['새 파일', '새 파이프라인']);
  await page.getByRole('menuitem', { name: '새 파이프라인' }).click();

  // The bare name went under pipelines/ and the file opened with the template.
  await row('release').waitFor();
  await page.waitForFunction(() => decodeURIComponent(location.hash).includes('pipelines/release'));
  const res = await call('GET', '/api/file?path=pipelines/release');
  assert.equal(res.status, 200);
  const f = await res.json();
  assert.equal(f.blocks.length, 1);
  assert.equal(f.blocks[0].type, 'flowchart');
  assert.equal(f.plan.block, f.blocks[0].id);
  assert.deepEqual(f.plan.steps.map((s) => s.id), ['계획', '구현', '리뷰']);
  const heads = f.document.content.filter((n) => n.type === 'heading').map((n) => n.content[0].text);
  assert.deepEqual(heads, ['목표', '단계', '위험']);
  assert.ok(f.document.content.some((n) => n.type === 'diagram' && n.attrs.blockId === f.blocks[0].id), 'document embeds the diagram');
  await page.getByRole('heading', { name: '목표' }).first().waitFor();

  // Only the pipeline row carries the badge (hidden while the row is hovered, so move the pointer off the sidebar).
  await page.mouse.move(900, 400);
  const badge = row('release').getByRole('img', { name: '파이프라인: 계획' });
  await badge.waitFor();
  assert.equal(await badge.textContent(), '◐계획');
  assert.equal(await nav.getByRole('img', { name: '파이프라인: 계획' }).count(), 1);
  if (process.env.DRAW_E2E_SHOT) await page.screenshot({ path: process.env.DRAW_E2E_SHOT });
  assert.deepEqual(errors, []);
});
