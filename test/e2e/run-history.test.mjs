// Headless browser check (E28, #155): version labels in 버전 기록, picking a past run in the run view (buttons with
// aria-current, the strip says 지난 실행 and the canvas draws that run), and 복제해서 새 계획 on a done run.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace inside a temp git repo with one commit, and
// refuses to go on unless the server's own log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

const CODE = ['plan [label: "Plan"]', 'impl [label: "Implement"]', 'merge [label: "Merge"]', 'plan > impl > merge'].join('\n');
const STEPS = ['plan', 'impl', 'merge'];

test('version labels, past runs and 복제해서 새 계획', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-run-history-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
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

  // One saved version, labelled the way write_plan, 시작하기 and the done run label theirs.
  await call('POST', '/api/history?path=run', {});
  const hdir = join(ws, '.drawing', 'history', 'run.dpx.json');
  const vid = readdirSync(hdir).filter((n) => /^\d{13}\.json$/.test(n)).map((n) => n.slice(0, -5)).sort().pop();
  assert.ok(vid, 'a saved version');
  writeFileSync(join(hdir, 'labels.json'), JSON.stringify({ [vid]: ['done', 'draft', 'approved'] }));

  // Two finished runs on disk: an older stopped one (impl blocked) and the newest done one.
  const rec = (T0, state, impl) => ({
    v: 1,
    id: `${T0}-abcdef`,
    file: 'run.dpx.json',
    plan: { revision: 1, hash: 'sha256:x', snapshot: plan },
    startedAt: T0,
    endedAt: T0 + 10 * 60e3,
    state,
    steps: {
      plan: { state: 'done', startedAt: T0, endedAt: T0 + 60e3, sessions: [] },
      impl: { state: impl, startedAt: T0 + 60e3, endedAt: impl === 'done' ? T0 + 5 * 60e3 : null, sessions: [] },
      merge: { state: state === 'done' ? 'done' : 'pending', startedAt: null, endedAt: null, sessions: [] },
    },
    totals: { cost: 0.5, mtok: 0 },
    timeline: [],
  });
  const rdir = join(ws, '.drawing', 'runs', 'run.dpx.json');
  mkdirSync(rdir, { recursive: true });
  const OLD = Date.now() - 3 * 3600e3;
  const NEW = Date.now() - 3600e3;
  writeFileSync(join(rdir, `${OLD}-abcdef.json`), JSON.stringify(rec(OLD, 'stopped', 'blocked')));
  writeFileSync(join(rdir, `${NEW}-abcdef.json`), JSON.stringify(rec(NEW, 'done', 'done')));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=run`);

  // 버전 기록: labels in run order.
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name: '버전 기록' }).click();
  const dialog = page.getByRole('dialog', { name: '버전 기록' });
  await dialog.waitFor();
  const item = dialog.getByRole('list', { name: '저장된 버전' }).getByRole('button').first();
  await item.waitFor();
  assert.match(await item.innerText(), /계획 초안\s*승인\s*완료/);
  if (process.env.DRAW_E2E_SHOT) await page.screenshot({ path: `${process.env.DRAW_E2E_SHOT}-history.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  // The strip on the newest (done) run offers 복제해서 새 계획.
  const strip = page.locator('[data-run-strip]');
  await strip.waitFor({ timeout: 30000 });
  assert.equal(await strip.getAttribute('data-run-state'), 'done');
  const dup = strip.getByRole('button', { name: '복제해서 새 계획' });
  await dup.waitFor();

  // Run view: the runs are buttons, the shown one has aria-current and a text cue.
  await strip.getByRole('button', { name: '실행 보기' }).click();
  const list = page.locator('[data-run-view] section[aria-label="기록"] ul');
  await list.waitFor({ timeout: 30000 });
  const runs = list.getByRole('button');
  assert.equal(await runs.count(), 2);
  assert.equal(await runs.nth(0).getAttribute('aria-current'), 'true');
  assert.match(await runs.nth(0).innerText(), /보는 중/);
  assert.equal(await runs.nth(1).getAttribute('aria-current'), null);

  // Pick the older run: it is current, the strip says 지난 실행 without run actions, the canvas draws it.
  await runs.nth(1).click();
  await page.waitForFunction(() => document.querySelector('[data-run-strip]')?.getAttribute('data-run-state') === 'stopped');
  assert.equal(await runs.nth(1).getAttribute('aria-current'), 'true');
  assert.equal(await runs.nth(0).getAttribute('aria-current'), null);
  assert.match(await strip.innerText(), /지난 실행/);
  assert.equal(await dup.count(), 0, 'no 복제 on a past run');
  if (process.env.DRAW_E2E_SHOT) await page.screenshot({ path: `${process.env.DRAW_E2E_SHOT}-past.png` });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.locator('[data-run-overlay] [data-run-layer]').waitFor({ timeout: 30000 });
  if (process.env.DRAW_E2E_SHOT) await page.screenshot({ path: `${process.env.DRAW_E2E_SHOT}-canvas.png` });

  // Back to the newest, then duplicate: the new draft opens.
  await strip.getByRole('button', { name: '최근 실행 보기' }).click();
  await page.waitForFunction(() => document.querySelector('[data-run-strip]')?.getAttribute('data-run-state') === 'done');
  await dup.click();
  await page.waitForFunction(() => /^#file=./.test(location.hash) && location.hash !== '#file=run', null, { timeout: 30000 });
  const opened = new URLSearchParams((await page.evaluate(() => location.hash)).slice(1)).get('file');
  const copy = await call('GET', `/api/file?path=${encodeURIComponent(opened)}`);
  assert.equal(copy.title, 'Run 복사');
  assert.ok(copy.plan, `the copy keeps the plan: ${JSON.stringify(copy).slice(0, 200)}`);
  assert.deepEqual(errors, []);
});
