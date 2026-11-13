// Headless browser check for PDF export through the print dialog (#62). Needs a Chromium and playwright-core:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// window.print is stubbed, so no dialog ever opens. Scratch workspace in a temp dir; the server log must name our port and folder.
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

test('PDF export prints the document or one picture', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-pdf-'));
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

  const call = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json();
  let f = await call('POST', '/api/file', { path: 'pdf', title: 'PDF 시험' });
  f = await call('PUT', '/api/file?path=pdf', {
    ...f,
    version: 2,
    blocks: [{ id: 'b1', type: 'flowchart', code: 'A > B', x: 0, y: 0, w: 0, h: 0 }],
    document: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '인쇄 제목' }] },
        { type: 'diagram', attrs: { blockId: 'b1' } },
      ],
    },
  });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const origins = new Set();
  page.on('request', (r) => !/^(data|blob|about):/.test(r.url()) && origins.add(new URL(r.url()).origin));
  await page.addInitScript(() => {
    window.__prints = [];
    const snap = (where) => {
      const sec = document.querySelector("section[aria-label='문서']");
      const vis = (el) => !!el && getComputedStyle(el).visibility === 'visible';
      window.__prints.push({
        where,
        cls: document.documentElement.className,
        docVisible: vis(sec),
        docHasImg: !!sec?.querySelector('.doc-diagram-pic img') && vis(sec.querySelector('.doc-diagram-pic img')),
        sidebarVisible: vis(document.querySelector('aside, nav:not(#doc-outline)')),
        headerVisible: vis(document.querySelector('header')),
      });
    };
    window.print = () => snap('top');
    const orig = HTMLIFrameElement.prototype.__lookupGetter__('contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get() {
        const w = orig.call(this);
        if (w && this.hasAttribute('data-print-frame') && !w.__stubbed) {
          w.__stubbed = true;
          w.print = () => window.__prints.push({ where: 'frame', svg: !!w.document.querySelector('svg'), text: w.document.body.innerText.slice(0, 20) });
        }
        return w;
      },
    });
  });
  await page.goto(`${BASE}/#file=pdf`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.waitForSelector('.doc-diagram-pic img', { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.emulateMedia({ media: 'print' });

  await t.test('document print shows only the document column', async () => {
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await page.locator('[data-export=pdf]').click();
    const p = await page.evaluate(() => window.__prints);
    assert.equal(p.length, 1);
    assert.equal(p[0].where, 'top');
    assert.ok(p[0].cls.includes('print-doc'));
    assert.ok(p[0].docVisible && p[0].docHasImg, 'document and its diagram are printed');
    assert.ok(!p[0].headerVisible, 'toolbar hidden');
    assert.ok(!p[0].sidebarVisible, 'sidebar hidden');
    // The stubbed print() returns at once; print mode stays until the browser says printing is over.
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('print-doc')), true, 'print mode lasts until afterprint');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('print-doc')), false, 'print mode is cleared afterwards');
  });

  await t.test('diagram block prints its SVG from a hidden iframe', async () => {
    await page.evaluate(() => (window.__prints = []));
    await page.locator('[data-export-block=pdf]').first().click();
    await page.waitForFunction(() => window.__prints.length > 0, null, { timeout: 15000 });
    const p = await page.evaluate(() => window.__prints);
    assert.equal(p[0].where, 'frame');
    assert.ok(p[0].svg, 'iframe holds the svg');
    // Sandboxed, and kept (however long the dialog stays open) until the browser fires afterprint.
    const sandbox = await page.evaluate(() => document.querySelector('iframe[data-print-frame]')?.getAttribute('sandbox'));
    assert.ok(sandbox && !sandbox.includes('allow-scripts'), `sandbox: ${sandbox}`);
    assert.equal(await page.locator('iframe[data-print-frame]').count(), 1, 'frame stays while printing');
    await page.evaluate(() => document.querySelector('iframe[data-print-frame]').contentWindow.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('iframe[data-print-frame]').count(), 0, 'afterprint removes the frame');
  });

  await t.test('canvas print (nothing selected, canvas only) uses the iframe', async () => {
    await page.evaluate(() => (window.__prints = []));
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('button', { name: '캔버스', exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await page.locator('[data-export=pdf]').click();
    await page.waitForFunction(() => window.__prints.length > 0, null, { timeout: 15000 });
    assert.equal((await page.evaluate(() => window.__prints))[0].where, 'frame');
  });

  assert.deepEqual([...origins], [BASE], `outside requests: ${[...origins]}`);
});
