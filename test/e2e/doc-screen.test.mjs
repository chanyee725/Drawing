// Headless browser check of the document screen (design doc 6 §2.4, §9 ③): 52px header, path, view switch, sub-documents, 390px.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// DRAW_SHOTS=<folder> also saves screenshots (light/dark × 1440/390, document screen).
// It starts its own server on a free port against a scratch workspace inside a scratch git repo (one commit) in a
// temp dir, and refuses to go on unless the server's own log names that port and folder. No provider is connected,
// so no agent CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
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

test('document screen: path, view switch, ⋯ menu, sub-documents, 390px', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-docscreen-'));
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
    ['결제 시스템/로그인 로직', '로그인 로직'],
    ['결제 시스템/로그인 로직/토큰 갱신', '토큰 갱신'],
    ['결제 시스템/데이터 수집 로직', '데이터 수집 로직'],
  ]) assert.equal((await call('POST', '/api/file', { path: p, title })).status, 201);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const open = async (theme, width) => {
    const page = await browser.newPage({ viewport: { width, height: width > 500 ? 900 : 844 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    await page.addInitScript((th) => localStorage.setItem('drawing.theme', th), theme);
    await page.goto(BASE);
    return page;
  };
  const row = (scope, re) => scope.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: re }).first();
  const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });
  const title = (page) => page.getByLabel('파일 제목').inputValue();
  const pressed = (page) => page.getByRole('group', { name: '보기 방식' }).getByRole('button').evaluateAll((bs) => bs.map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`));

  for (const theme of ['light', 'dark']) {
    const page = await open(theme, 1440);
    const nav = page.getByRole('navigation', { name: '사이드바' });
    await row(nav, /결제 시스템/).click();
    await row(nav, /^로그인 로직/).click();
    await page.locator('.ProseMirror').waitFor();
    // 52px header; path = project, then the document (editable title, the current page).
    assert.equal((await page.locator('header').filter({ has: page.getByLabel('파일 제목') }).boundingBox()).height, 52);
    const path = page.getByRole('navigation', { name: '경로' });
    assert.deepEqual(await path.getByRole('button').allInnerTexts(), ['결제 시스템']);
    assert.equal(await page.getByLabel('파일 제목').getAttribute('aria-current'), 'page');
    // View switch: toggle buttons with aria-pressed, exactly one pressed.
    assert.deepEqual(await pressed(page), ['문서:false', '둘 다:true', '캔버스:false']);
    // Sub-document block at the end of the document: same data as the sidebar.
    const subs = page.getByRole('region', { name: '하위 문서' });
    await subs.getByRole('button', { name: /토큰 갱신/ }).waitFor();
    await shot(page, `${theme}-doc-1440`);
    if (theme === 'dark') {
      await page.close();
      continue;
    }
    await page.getByRole('button', { name: '캔버스', exact: true }).click();
    assert.deepEqual(await pressed(page), ['문서:false', '둘 다:false', '캔버스:true']);
    assert.equal(await page.locator("section[aria-label='문서']").count(), 0, 'canvas view hides the document');
    await page.getByRole('button', { name: '둘 다', exact: true }).click();
    // Picking the pressed choice again keeps it pressed (never zero pressed).
    await page.getByRole('button', { name: '둘 다', exact: true }).click();
    assert.deepEqual(await pressed(page), ['문서:false', '둘 다:true', '캔버스:false']);

    // Open a sub-document: the path grows by its parent; the parent step opens it again.
    await subs.getByRole('button', { name: /토큰 갱신/ }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="파일 제목"]')?.value === '토큰 갱신');
    assert.deepEqual(await path.getByRole('button').allInnerTexts(), ['결제 시스템', '로그인 로직']);
    await page.getByRole('region', { name: '하위 문서' }).getByText('아직 하위 문서가 없어요.').waitFor();
    await path.getByRole('button', { name: '로그인 로직' }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="파일 제목"]')?.value === '로그인 로직');

    // ⋯ → 하위 문서 추가 makes it in the folder named after the document and opens it.
    page.once('dialog', (d) => d.accept('세부 규칙'));
    await page.getByRole('button', { name: '더 보기' }).click();
    await page.getByRole('menuitem', { name: '하위 문서 추가' }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="파일 제목"]')?.value === '세부 규칙');
    assert.equal((await call('GET', `/api/file?path=${encodeURIComponent('결제 시스템/로그인 로직/세부 규칙')}`)).status, 200);
    assert.deepEqual(await path.getByRole('button').allInnerTexts(), ['결제 시스템', '로그인 로직']);
    assert.equal(await title(page), '세부 규칙');

    // The project step opens the project home (floating frame).
    await path.getByRole('button', { name: '결제 시스템' }).click();
    assert.equal(await page.locator('[data-slot="sidebar-inset"]').getAttribute('data-frame'), 'floating');
    await page.close();
  }

  // 390px: [문서 | 캔버스], one pane at a time, 44px header targets.
  for (const theme of ['light', 'dark']) {
    const page = await open(theme, 390);
    await page.getByRole('button', { name: '메뉴 열기' }).click();
    const drawer = page.getByRole('dialog').getByRole('navigation', { name: '사이드바' });
    await row(drawer, /결제 시스템/).click();
    await page.getByRole('button', { name: '메뉴 열기' }).click();
    await row(page.getByRole('dialog'), /^로그인 로직/).click();
    await page.locator('.ProseMirror').waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await pressed(page), ['문서:true', '캔버스:false']);
    for (const name of ['파일 목록 열기', '더 보기', '문서', '캔버스']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box.height >= 40 && box.width >= 40, `${name} is a touch target: ${JSON.stringify(box)}`);
    }
    for (const name of ['파일 목록 열기', '더 보기']) assert.ok((await page.getByRole('button', { name, exact: true }).boundingBox()).height >= 44, name);
    await shot(page, `${theme}-doc-390`);
    await page.getByRole('button', { name: '캔버스', exact: true }).click();
    assert.equal(await page.locator("section[aria-label='문서']").count(), 0);
    await page.locator('.excalidraw').first().waitFor();
    assert.deepEqual(await pressed(page), ['문서:false', '캔버스:true']);
    await page.waitForTimeout(400);
    await shot(page, `${theme}-canvas-390`);
    await page.close();
  }
  assert.deepEqual(errors, []);
});
