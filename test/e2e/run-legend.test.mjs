// Headless browser check (E26 follow-ups, #257): a running run with a blocked step whose history fell off the
// timeline. The run strip shows the bar (w-16, after the glyph, labelled "진행률") and the blocked step keeps its
// weight; the legend sits under the picture in the document and beside it on the canvas, inside the pane.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir, and refuses to go on
// unless the server's own log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const CODE = ['plan [label: "Plan"]', 'impl [label: "Implement"]', 'review [label: "Review"]', 'test [label: "Test"]', 'merge [label: "Merge"]', 'plan > impl > review > merge', 'impl > test > merge'].join('\n');
const STEPS = ['plan', 'impl', 'review', 'test', 'merge'];

test('run strip bar and the progress legend in the document and on the canvas', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-run-legend-'));
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
  const plan = { v: 1, block: 'b1', defaults: { role: 'impl' }, steps: STEPS.map((id) => ({ id, node: id })) };
  const f = await call('POST', '/api/file', { path: 'run', title: 'Run' });
  const put = await call('PUT', '/api/file?path=run', {
    ...f,
    version: 2,
    blocks: [{ id: 'b1', type: 'flowchart', code: CODE, x: 0, y: 0, w: 0, h: 0 }],
    document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }] },
    plan,
  });
  assert.ok(!put.error, JSON.stringify(put));

  // A running run on disk: test is blocked and its timeline holds only failed/blocked (the history fell off the cap).
  const T0 = Date.now() - 20 * 60e3;
  const id = `${T0}-abcdef`;
  const step = (state, startedAt, sessions = []) => ({ state, startedAt, endedAt: null, sessions });
  const record = {
    v: 1,
    id,
    file: 'run.dpx.json',
    plan: { revision: 1, hash: 'sha256:x', snapshot: plan },
    startedAt: T0,
    endedAt: null,
    state: 'running',
    steps: {
      plan: { ...step('done', T0, [{ sid: 's1', name: 'Mira', state: 'done' }]), endedAt: T0 + 60e3 },
      impl: step('working', T0 + 60e3, [{ sid: 's2', name: 'Juno', state: 'working' }]),
      review: step('pending', null),
      test: step('blocked', T0 + 2 * 60e3, [{ sid: 's3', name: 'Pell', state: 'failed' }]),
      merge: step('pending', null),
    },
    totals: { cost: 0, mtok: 0 },
    timeline: [
      [T0 + 3 * 60e3, 'test', 'failed'],
      [T0 + 4 * 60e3, 'test', 'blocked'],
    ],
  };
  const dir = join(ws, '.drawing', 'runs', 'run.dpx.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(record));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=run`);

  // Run strip: plan 0.8 (its session is done: in review) + impl 0.5 + test (blocked, was active) 0.5 = 1.8 of 5 → 36%.
  const strip = page.locator('[data-run-strip]');
  await strip.waitFor({ timeout: 30000 });
  assert.match(await strip.innerText(), /5단계 중 0 완료 · 36% · 남은 5 \(막힘 1\)/);
  const bar = strip.locator('progress');
  assert.equal(await bar.getAttribute('aria-label'), '진행률');
  assert.equal(await bar.getAttribute('value'), '36');
  assert.equal((await bar.boundingBox()).width, 64, 'w-16 bar');
  assert.equal(await bar.evaluate((el) => el.previousElementSibling?.textContent), '●', 'bar right after the glyph');

  // Document: the legend under the picture.
  await page.getByRole('button', { name: '문서', exact: true }).click();
  const docLegend = page.locator('.doc-diagram > [data-run-legend]');
  await docLegend.waitFor({ timeout: 30000 });
  const pic = await page.locator('.doc-diagram-pic img').boundingBox();
  const dl = await docLegend.boundingBox();
  assert.ok(dl.y >= pic.y + pic.height - 1, 'document legend under the picture');
  assert.match(await docLegend.innerText(), /36%/);

  // Canvas: beside the picture, not over it, inside the overlay.
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  const legend = page.locator('[data-run-overlay] [data-run-legend]');
  await legend.waitFor({ timeout: 30000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-run-overlay] [data-run-legend]')).visibility === 'visible');
  const area = await page.locator('[data-run-overlay]').boundingBox();
  const layer = await page.locator('[data-run-overlay] [data-run-layer]').boundingBox();
  const lb = await legend.boundingBox();
  assert.ok(lb.x >= area.x && lb.y >= area.y && lb.x + lb.width <= area.x + area.width + 0.5 && lb.y + lb.height <= area.y + area.height + 0.5, `legend inside the pane: ${JSON.stringify({ lb, area })}`);
  const overlaps = lb.x < layer.x + layer.width && layer.x < lb.x + lb.width && lb.y < layer.y + layer.height && layer.y < lb.y + lb.height;
  assert.ok(!overlaps, `legend off the picture: ${JSON.stringify({ lb, layer })}`);
  assert.equal(await legend.evaluate((el) => getComputedStyle(el).pointerEvents), 'none', 'clicks pass through to shapes');
  assert.equal(await legend.locator('summary').evaluate((el) => getComputedStyle(el).pointerEvents), 'auto', 'the fold toggle still works');
  if (process.env.DRAW_E2E_SHOT) await page.screenshot({ path: process.env.DRAW_E2E_SHOT });
  assert.deepEqual(errors, []);
});
