// Headless browser check for the document outline, heading links and `+` wikilinks. Runs only on request:
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

test('outline, heading link and wikilink in a headless browser', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-outline-'));
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
    const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    return r.json();
  };
  const head = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
  const filler = Array.from({ length: 30 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: 'filler line' }] }));
  await call('POST', '/api/file', { path: 'other', title: '다른 문서' });
  let f = await call('POST', '/api/file', { path: 'main', title: '본문' });
  f = await call('PUT', '/api/file?path=main', { ...f, version: 2, document: { type: 'doc', content: [head(1, '개요'), ...filler, head(2, '세부 내용'), ...filler, { type: 'paragraph' }] } });

  browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/#file=main`);
  await page.waitForSelector('.doc-editor h1');

  // Outline lists both headings; clicking one scrolls to it.
  await page.getByRole('button', { name: '목차' }).click();
  const items = await page.locator('#doc-outline li').allTextContents();
  assert.deepEqual(items, ['개요', '세부 내용']);
  await page.locator('#doc-outline li button', { hasText: '세부 내용' }).click();
  await page.waitForFunction(() => document.querySelector('.doc-editor h2').getBoundingClientRect().top < 400);

  // Typing at the end of the last paragraph gives every heading an id; copy a link from the heading button.
  await page.locator('.doc-editor p').last().click();
  await page.keyboard.type('x');
  await page.locator('.doc-editor h2').hover();
  await page.locator('.doc-editor h2 .doc-h-link').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /#file=main&h=h_[a-z0-9]+$/);

  await page.locator('[data-save="saved"]').waitFor();

  // Opening the link in a fresh page jumps to that heading.
  const page2 = await ctx.newPage();
  await page2.goto(link);
  await page2.waitForSelector('.doc-editor h2');
  await page2.waitForFunction(() => document.querySelector('.doc-editor h2').getBoundingClientRect().top < 400);

  // Following a heading link in this tab drops `&h=`, so the same link works a second time.
  const hashOnly = link.slice(link.indexOf('#'));
  for (let round = 0; round < 2; round++) {
    await page.evaluate(() => document.querySelector('.doc-editor').scrollIntoView());
    await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0; });
    await page.evaluate((h) => { location.hash = h; }, hashOnly);
    await page.waitForFunction(() => location.hash === '#file=main');
    await page.waitForFunction(() => document.querySelector('.doc-editor h2').getBoundingClientRect().top < 400);
  }

  // A link to a file that cannot be opened leaves the address bar on the open file.
  await page.evaluate(() => { location.hash = '#file=does-not-exist'; });
  await page.waitForFunction(() => location.hash === '#file=main');

  // `+` after a space offers headings and files; choosing a file inserts a link that opens it.
  await page.locator('.doc-editor p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' +다른');
  await page.getByRole('option', { name: /다른 문서/ }).waitFor();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.doc-editor a[data-wikilink]');
  await page.locator('.doc-editor a[data-wikilink]').click();
  await page.waitForFunction(() => location.hash.startsWith('#file=other'));
  assert.match(await page.evaluate(() => location.hash), /^#file=other(\.dpx\.json)?$/);

  assert.deepEqual(errors, []);
  assert.ok(log.includes(`workspace ${ws}`));
});
