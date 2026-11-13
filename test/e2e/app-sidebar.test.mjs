// Headless browser check of the app shell (design doc 6 §2.1, §9 ①): views, nested projects, frames, shortcuts, drawer.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// DRAW_SHOTS=<folder> also saves screenshots (light/dark × 1440/390, home and document).
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

test('app sidebar: views, nested projects, frames A/B, shortcuts, 390px drawer', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-shell-'));
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
    ['온보딩/첫 화면 흐름', '첫 화면 흐름'],
    ['아이디어 메모', '아이디어 메모'],
  ]) assert.equal((await call('POST', '/api/file', { path: p, title })).status, 201);
  await call('POST', '/api/folder', { path: '인프라' });
  writeFileSync(join(ws, '온보딩', '.project.json'), JSON.stringify({ name: '온보딩 개편', description: '첫 사용 흐름 다시 짜기' }));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const open = async (theme, width) => {
    const page = await browser.newPage({ viewport: { width, height: width > 500 ? 900 : 844 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    await page.addInitScript((th) => localStorage.setItem('drawing.theme', th), theme);
    await page.goto(BASE);
    return page;
  };
  // A sidebar row by its visible text (row actions have their own labels).
  const row = (scope, re) => scope.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: re }).first();
  const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

  // Desktop, light.
  let page = await open('light', 1440);
  const nav = page.getByRole('navigation', { name: '사이드바' });
  const frame = () => page.locator('[data-slot="sidebar-inset"]').getAttribute('data-frame');
  await nav.getByRole('button', { name: '결제 시스템', exact: false }).first().waitFor();
  assert.equal(await nav.getByRole('button', { name: /모든 파일/ }).getAttribute('aria-current'), 'page');
  assert.equal(await frame(), 'floating');
  // Projects sorted by name; the meta name wins over the folder name.
  const projectNames = nav.locator('[data-slot="sidebar-group"] > ul > li > [data-slot="sidebar-menu-button"] > span.truncate');
  assert.deepEqual(await projectNames.allInnerTexts(), ['결제 시스템', '온보딩 개편', '인프라']);

  // Dashboard (layout B, #190): pill tabs with 프로젝트별 first shown, quick-create chips, / finds, 39px group heads, 만든 때.
  const dash = page.locator('main[data-screen="dashboard"]');
  const tabs = dash.getByRole('tablist', { name: '보기' });
  assert.deepEqual(await tabs.getByRole('tab').allInnerTexts(), ['전체', '최근', '프로젝트별', '미분류']);
  assert.equal(await tabs.getByRole('tab', { name: '프로젝트별' }).getAttribute('aria-selected'), 'true');
  const chips = dash.getByRole('group', { name: '새로 만들기' }).getByRole('button');
  // Chips show the kind only; a visually hidden "새 " keeps names like "새 파이프라인 계획" for assistive tech and e2e.
  const shown = await chips.evaluateAll((els) => els.map((el) => [...el.childNodes].filter((n) => !(n instanceof Element && n.classList.contains('sr-only'))).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim()));
  assert.deepEqual(shown, ['문서 D', '캔버스 C', '파이프라인 계획 P', '템플릿 준비 중']);
  // The not-yet template chip stays focusable (aria-disabled, not disabled) and a click does nothing (#216 review).
  const template = chips.filter({ hasText: '새 템플릿' });
  assert.equal(await template.getAttribute('aria-disabled'), 'true');
  assert.equal(await template.evaluate((el) => el.disabled), false);
  await template.focus();
  assert.equal(await template.evaluate((el) => el === document.activeElement), true);
  await template.click({ force: true });
  assert.equal(await page.locator('main[data-screen="dashboard"]').count(), 1);
  for (const name of ['새 문서', '새 캔버스', '새 파이프라인 계획', '새 템플릿']) assert.equal(await chips.filter({ hasText: name }).count(), 1, name);
  const heads = dash.locator('[data-slot="group-head"]');
  assert.deepEqual(
    (await heads.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim()),
    ['결 결제 시스템 문서 3 개', '온 온보딩 개편 문서 1 개', '인 인프라 문서 0 개', '미분류 문서 1 개'],
  );
  assert.equal(Math.round((await heads.first().boundingBox()).height), 39);
  assert.match(await dash.locator('[data-slot="column-head"]').first().innerText(), /만든 때/);
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('type')), 'search');
  await page.keyboard.type('토큰');
  assert.deepEqual(await dash.locator('[data-doc-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-doc-row'))), ['결제 시스템/로그인 로직.dpx.json', '결제 시스템/로그인 로직/토큰 갱신.dpx.json']);
  // The sub-document list sits inside its parent's <li>, so screen readers keep the level (#212 review).
  assert.equal(
    await dash.locator('[data-doc-row="결제 시스템/로그인 로직/토큰 갱신.dpx.json"]').evaluate((li) => li.parentElement?.closest('li')?.getAttribute('data-doc-row')),
    '결제 시스템/로그인 로직.dpx.json',
  );
  assert.equal(await dash.getByRole('button', { name: '로그인 로직 하위 문서' }).getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await tabs.getByRole('tab', { name: '전체' }).click();
  assert.match(await dash.locator('[data-slot="column-head"]').first().innerText(), /위치/);
  assert.equal(await dash.locator('[data-doc-row]').count(), 5);
  await tabs.getByRole('tab', { name: '프로젝트별' }).click();
  await shot(page, 'light-dash-1440');
  await page.evaluate(() => document.activeElement?.blur());

  // G P opens the menu on projects only; the 프로젝트만 chip is a button that widens it again (#216 review).
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  const chip = page.getByRole('button', { name: '프로젝트만 찾기 풀기' });
  await chip.waitFor();
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('없는이름');
  await page.getByText('맞는 프로젝트가 없어요. 프로젝트만을 풀면 모든 명령에서 찾아요.').waitFor();
  await chip.click();
  await chip.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'combobox');
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: '명령 찾기' }).waitFor({ state: 'detached' });
  await page.evaluate(() => document.activeElement?.blur());

  await page.keyboard.press('r');
  assert.equal(await nav.getByRole('button', { name: /최근/ }).getAttribute('aria-current'), 'page');
  await page.keyboard.press('a');
  assert.equal(await nav.getByRole('button', { name: /모든 파일/ }).getAttribute('aria-current'), 'page');

  // A project opens its home (still floating) and unfolds its documents; a document with sub-documents shows a count.
  const pay = row(nav, /결제 시스템/);
  await pay.click();
  assert.equal(await pay.getAttribute('aria-expanded'), 'true');
  assert.equal(await pay.getAttribute('aria-current'), 'page');
  assert.equal(await frame(), 'floating');
  const login = row(nav, /^로그인 로직/);
  await login.waitFor();
  assert.match(await login.innerText(), /1$/);
  await shot(page, 'light-home-1440');

  // Unfold the sub-documents, open one: the document screen sits flush (frame A) and the row is current.
  await nav.getByRole('button', { name: '로그인 로직 하위 문서 펼치기' }).click();
  await row(nav, /토큰 갱신/).click();
  await page.locator('.ProseMirror').waitFor();
  assert.equal(await frame(), 'attached');
  assert.equal(await row(nav, /토큰 갱신/).getAttribute('aria-current'), 'page');
  // One-letter keys belong to the editor while it has focus.
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('a');
  assert.equal(await frame(), 'attached');
  // ...and to the canvas while it has focus: R picks the rectangle tool, not 최근.
  const cbox = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.click(cbox.x + cbox.width - 80, cbox.y + cbox.height - 80);
  await page.keyboard.press('r');
  assert.equal(await frame(), 'attached');
  assert.ok(await page.locator('input[data-testid="toolbar-rectangle"]').isChecked(), 'R picked the rectangle tool');
  assert.notEqual(await nav.getByRole('button', { name: /최근/ }).getAttribute('aria-current'), 'page');
  await page.keyboard.press('Escape');
  await shot(page, 'light-doc-1440');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('a');
  assert.equal(await frame(), 'floating');
  // B opens the archive (trash) dialog; Escape closes it.
  await page.keyboard.press('b');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  // One model row each, with text next to the dot (nothing is connected in a scratch repo); a row opens its
  // the settings dialog on 모델 연결 (E57), which is closed again without connecting.
  const models = nav.getByRole('list', { name: '모델 연결' });
  await models.waitFor();
  assert.deepEqual((await models.locator('li').allInnerTexts()).map((s) => s.split('\n')[0]), ['Claude', 'Codex', 'Gemini']);
  for (const s of await models.locator('li').allInnerTexts()) assert.match(s, /연결 안 됨|꺼짐|연결됨|%|한도/);
  await models.getByRole('button', { name: /^Codex / }).click();
  const settings = page.getByRole('dialog', { name: '설정' });
  await settings.waitFor();
  assert.equal(await settings.locator('nav button[aria-current="page"]').textContent(), '모델 연결');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.close();

  page = await open('dark', 1440);
  await page.locator('[data-slot="group-head"]').first().waitFor();
  await shot(page, 'dark-dash-1440');
  await row(page.getByRole('navigation', { name: '사이드바' }), /결제 시스템/).click();
  await page.waitForTimeout(300);
  await shot(page, 'dark-home-1440');
  await row(page.getByRole('navigation', { name: '사이드바' }), /^로그인 로직/).click();
  await page.locator('.ProseMirror').waitFor();
  await shot(page, 'dark-doc-1440');
  await page.close();

  // 390px: the sidebar is a drawer; its rows are 44px touch targets; opening a file closes it.
  for (const theme of ['light', 'dark']) {
    page = await open(theme, 390);
    assert.equal(await page.getByRole('navigation', { name: '사이드바' }).count(), 0);
    await shot(page, `${theme}-home-390`);
    await page.getByRole('button', { name: '메뉴 열기' }).click();
    const drawer = page.getByRole('dialog').getByRole('navigation', { name: '사이드바' });
    await drawer.waitFor();
    const all = drawer.getByRole('button', { name: /모든 파일/ });
    assert.ok((await all.boundingBox()).height >= 44, 'drawer rows are 44px');
    await row(drawer, /결제 시스템/).click();
    await page.getByRole('button', { name: '메뉴 열기' }).click();
    await page.waitForTimeout(400);
    await shot(page, `${theme}-nav-390`);
    await row(page.getByRole('dialog'), /^로그인 로직/).click();
    await page.locator('.ProseMirror').waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole('dialog').count(), 0, 'drawer closed after opening a file');
    await shot(page, `${theme}-doc-390`);
    await page.close();
  }
  assert.deepEqual(errors, []);
});
