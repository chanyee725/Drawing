// Headless browser check of moving in the app sidebar (E44b): a document (with its sub-documents) or a group
// dragged onto a project or group row moves there; a refused drop (onto itself, its own place, its own
// sub-documents, a document row) moves nothing and never falls through to the workspace root. The row menu's
// 옮기기 does the same from the keyboard, announces the move and keeps focus on the moved row.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace inside a scratch git repo (one commit) in a
// temp dir, and refuses to go on unless the server's own log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('refused sidebar drops do not move to the root', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-move-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
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

  const call = (m, u, b) => fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
  for (const [p, title] of [
    ['A/login', '로그인'],
    ['A/login/token', '토큰'],
    ['A/g/memo', '메모'],
    ['B/keep', '남길 문서'],
  ]) assert.equal((await call('POST', '/api/file', { path: p, title })).status, 201);
  assert.equal((await call('POST', '/api/folder', { path: 'C' })).status, 201);
  const rootNow = () => readdirSync(ws).filter((n) => !n.startsWith('.')).sort();
  const rootBefore = rootNow();

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(BASE);
  const row = (path) => page.locator(`[data-move-path="${path}"]`);
  const settle = () => page.waitForTimeout(700);
  // Unfold the projects and the login document's sub-documents.
  for (const p of ['A', 'B', 'C']) {
    await page.getByRole('button', { name: `${p} 펼치기` }).click();
  }
  await page.getByRole('button', { name: '로그인 하위 문서 펼치기' }).click();
  await row('A/login/token.dpx.json').waitFor();
  await row('A/g').click(); // unfold the group
  await row('A/g/memo.dpx.json').waitFor();

  // Refused: onto a document row, onto its own project, into its own sub-documents, a group onto itself.
  await row('A/login.dpx.json').dragTo(row('B/keep.dpx.json'));
  await settle();
  await row('A/login.dpx.json').dragTo(row('A'));
  await settle();
  await row('A/g/memo.dpx.json').dragTo(row('A/login/token.dpx.json'));
  await settle();
  await row('A/g').dragTo(row('A/g'));
  await settle();
  assert.ok(existsSync(join(ws, 'A', 'login.dpx.json')) && existsSync(join(ws, 'A', 'login', 'token.dpx.json')), 'login and its sub-documents stay');
  assert.ok(existsSync(join(ws, 'A', 'g', 'memo.dpx.json')), 'the group stays');
  assert.deepEqual(rootNow(), rootBefore, 'nothing was moved to the workspace root');

  // A document dropped on another project takes its sub-documents along.
  await row('A/login.dpx.json').dragTo(row('B'));
  await settle();
  assert.ok(existsSync(join(ws, 'B', 'login.dpx.json')), 'login moved to B');
  assert.ok(existsSync(join(ws, 'B', 'login', 'token.dpx.json')), 'its sub-document moved too');
  assert.ok(!existsSync(join(ws, 'A', 'login.dpx.json')) && !existsSync(join(ws, 'A', 'login')), 'nothing left behind in A');
  // A group dropped on a project row.
  await row('A/g').dragTo(row('C'));
  await settle();
  assert.ok(existsSync(join(ws, 'C', 'g', 'memo.dpx.json')), 'the group moved to C');
  // A document dropped on a group row.
  await row('C/g').click(); // unfold
  await row('B/keep.dpx.json').dragTo(row('C/g'));
  await settle();
  assert.ok(existsSync(join(ws, 'C', 'g', 'keep.dpx.json')), 'keep moved into the group');
  assert.deepEqual(rootNow(), rootBefore);

  // Keyboard: row menu → 옮기기 → a project. The move is announced and focus lands on the moved row.
  const trigger = page.getByRole('button', { name: '남길 문서 메뉴' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await menu.waitFor();
  await page.getByRole('menuitem', { name: '옮기기' }).focus();
  await page.keyboard.press('ArrowRight');
  const target = page.getByRole('menuitem', { name: 'A', exact: true });
  await target.waitFor();
  await target.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-move-path') === 'A/keep.dpx.json', null, { timeout: 5000 });
  assert.ok(existsSync(join(ws, 'A', 'keep.dpx.json')), 'keep moved to A from the keyboard');
  await page.waitForFunction(() => /옮겼어요/.test(document.querySelector('[aria-live="polite"].sr-only')?.textContent ?? ''), null, { timeout: 3000 });
  assert.match(await page.locator('[aria-live="polite"].sr-only').textContent(), /남길 문서을\(를\) A\(으\)로 옮겼어요/);

  assert.deepEqual(rootNow(), rootBefore);

  // Rename and delete keep a document and its sub-documents folder together.
  for (const [p, title] of [
    ['D/login', '로그인 D'],
    ['D/login/token', '토큰 D'],
    ['D/solo', '혼자'],
    ['E/plan', '계획'],
    ['E/plan/step', '단계'],
  ]) assert.equal((await call('POST', '/api/file', { path: p, title })).status, 201);
  for (const p of ['D/new', 'D/solo']) assert.equal((await call('POST', '/api/folder', { path: p })).status, 201);
  await page.reload();
  for (const p of ['D', 'E']) await page.getByRole('button', { name: `${p} 펼치기` }).click();
  const dialogs = [];
  const menuAction = async (label, action, answer) => {
    page.once('dialog', (d) => {
      dialogs.push(d.message());
      void (answer === undefined ? d.accept() : d.accept(answer));
    });
    await page.getByRole('button', { name: `${label} 메뉴` }).click();
    await page.getByRole('menuitem', { name: action }).click();
    await settle();
  };
  // Renaming onto a name whose sub-documents folder is taken (group D/new) refuses the whole rename: nothing is orphaned.
  await menuAction('로그인 D', '이름 바꾸기', 'new');
  assert.ok(existsSync(join(ws, 'D', 'login.dpx.json')), 'login keeps its name');
  assert.ok(existsSync(join(ws, 'D', 'login', 'token.dpx.json')), 'its sub-documents stay with it');
  assert.ok(!existsSync(join(ws, 'D', 'new.dpx.json')), 'no half-renamed document');
  await page.getByRole('alert').filter({ hasText: /./ }).first().waitFor();
  // A document without sub-documents never takes the unrelated group over as its own.
  await menuAction('혼자', '이름 바꾸기', 'new');
  assert.ok(existsSync(join(ws, 'D', 'solo.dpx.json')) && !existsSync(join(ws, 'D', 'new.dpx.json')), 'solo keeps its name');
  // An empty sub-documents folder takes the new name too.
  await menuAction('혼자', '이름 바꾸기', 'alone');
  assert.ok(existsSync(join(ws, 'D', 'alone.dpx.json')) && existsSync(join(ws, 'D', 'alone')), 'document and its empty folder renamed');
  assert.ok(!existsSync(join(ws, 'D', 'solo')), 'the old empty folder is gone');
  // Deleting a document with sub-documents trashes both; the confirmation says so.
  await menuAction('계획', '지우기');
  assert.match(dialogs.at(-1), /하위 문서/);
  assert.ok(!existsSync(join(ws, 'E', 'plan.dpx.json')) && !existsSync(join(ws, 'E', 'plan')), 'document and its sub-documents folder are gone');
  const trashed = (await (await call('GET', '/api/trash')).json()).items.map((i) => i.path).sort();
  assert.deepEqual(trashed.filter((p) => p.startsWith('E/')), ['E/plan.dpx.json', 'E/plan/step.dpx.json']);

  assert.deepEqual(errors, []);
});
