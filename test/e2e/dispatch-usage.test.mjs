// Headless check of the rest of the Dispatch screens (E29, #156): one fake Claude session reports tokens, a cost and
// a usage-limit event; then 사용량 shows today's cost, the 5-hour limit and the session in the top-10 table,
// 타임라인 shows the session's row, and 상시 화면 (#tv) shows its tile in the dark theme and Esc goes back.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no real
// claude, codex or agy can start. It refuses to go on unless the server log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';
import { which } from '../../server/dispatch/cli.js';

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

test('사용량, 타임라인 and 상시 화면 show a fake session', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-usage-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-usage-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);

  const far = Math.floor(Date.now() / 1000) + 3600;
  const scenario = [
    { type: 'system', subtype: 'init', session_id: 'fake-usage-session' },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000 } } },
    { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.42, resetsAt: far, status: 'allowed' }, seven_day: { utilization: 0.1, resetsAt: far, status: 'allowed' } } } },
    { type: 'result', subtype: 'success', total_cost_usd: 1.25 },
  ];
  const fake = fakeCliBin({ scenario });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { HOME: home, DRAW_PORT: String(port), ...fake.env, PATH, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  let page;
  // Each check names its step, so a failure says where it stopped (with the server log tail and a screenshot).
  let step = 'server start';
  const at = (s) => { step = s; };
  t.after(async () => {
    await browser?.close();
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  try {
    for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

    const call = async (m, u, b) => {
      const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
      const body = await res.json();
      assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
      return body;
    };
    at('fake session');
    await call('POST', '/api/providers/claude/login');
    const { sessions } = await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'say ok' }], worktree: false });
    const name = sessions[0].name;
    // Wait until the fake turn's cost is counted and the session is at rest, so nothing moves under the page.
    let settled = false;
    for (let i = 0; i < 100 && !settled; i++) {
      const { days } = await call('GET', '/api/usage');
      const { sessions: list } = await call('GET', '/api/state');
      settled = days.at(-1).cost > 0 && list.find((s) => s.name === name)?.state === 'resting';
      if (!settled) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(settled, 'the fake turn should finish with its cost counted');

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
    const errors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    let usageFetches = 0;
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/usage') usageFetches++; });

    at('사용량');
    await page.goto(`${BASE}/dispatch#usage`);
    const nav = page.getByRole('navigation', { name: '세션 화면' });
    await nav.getByRole('link', { name: '사용량' }).and(page.locator('[aria-current="page"]')).waitFor();
    await page.getByText('$1.25').first().waitFor();
    await page.locator('[data-limit="5시간"]').getByText('42%').waitFor();
    await page.locator(`[data-session="${name}"]`).waitFor();
    assert.ok(await page.getByRole('columnheader', { name: '모델' }).first().isVisible());
    // Cost shares are neutral bars: the only session holds 100% of the cost, which must not read as a limit warning.
    const shares = page.locator('[aria-label$="비용 비율"]');
    assert.ok(await shares.count() >= 1, 'at least one cost share bar');
    for (const tone of await shares.evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')))) assert.equal(tone, 'neutral');
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e29-usage.png'), fullPage: true });
    // Session events that don't move the cost total (the snapshot, state pushes) don't refetch /api/usage.
    await page.waitForTimeout(2500);
    assert.equal(usageFetches, 1, 'one /api/usage request while the cost total stays the same');

    at('타임라인');
    await nav.getByRole('link', { name: '타임라인' }).click();
    assert.equal(new URL(page.url()).hash, '#timeline');
    const row = page.locator(`[data-row="${name}"]`);
    await row.waitFor();
    assert.match(await row.getAttribute('aria-label'), new RegExp(`^${name}, 지금 `));
    await row.locator('[data-span]').first().waitFor(); // at least one state span
    // A finished fake turn leaves the session resting; its bar is drawn solid so it stays visible on the track.
    const resting = row.locator('[data-span="resting"] > span');
    if (await resting.count()) assert.equal(await resting.first().evaluate((e) => getComputedStyle(e).opacity), '1');
    // The 실패한 순간 legend mark uses the failure colour token in both themes (a missing token renders it transparent).
    const legend = page.locator('[data-legend="failed"]');
    const themeAtStart = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((th) => (document.documentElement.dataset.theme = th), theme);
      const bg = await legend.evaluate((e) => getComputedStyle(e).backgroundColor);
      assert.ok(!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg) && !/\/ 0\)$/.test(bg), `legend mark is transparent in ${theme}: ${bg}`);
    }
    await page.evaluate((th) => (th ? (document.documentElement.dataset.theme = th) : delete document.documentElement.dataset.theme), themeAtStart);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e29-timeline.png') });
    // Forced colors drop the bar backgrounds; a system-colour border keeps each mark visible.
    await page.emulateMedia({ forcedColors: 'active' });
    for (const mark of [row.locator('[data-span] > span').first(), legend]) {
      const b = await mark.evaluate((e) => { const c = getComputedStyle(e); return { style: c.borderLeftStyle, width: parseFloat(c.borderLeftWidth) }; });
      assert.ok(b.style !== 'none' && b.width > 0, `mark has no border in forced colors: ${JSON.stringify(b)}`);
    }
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e29-timeline-forced.png') });
    await page.emulateMedia({ forcedColors: 'none' });

    // 상시 화면: dark, a tile per session, Esc goes back to the board.
    at('상시 화면');
    const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByRole('link', { name: '상시 화면' }).click();
    await page.locator('[data-always-on]').waitFor();
    assert.equal(new URL(page.url()).hash, '#tv');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.locator(`[data-tile="${name}"]`).waitFor();
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e29-always-on.png') });
    at('상시 화면 after reload');
    await page.reload();
    await page.locator(`[data-tile="${name}"]`).waitFor(); // #tv survives a reload
    await page.keyboard.press('Escape');
    await page.locator('[data-always-on]').waitFor({ state: 'detached' });
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), themeBefore);

    // A tile opens the session sheet on the board.
    at('tile opens the sheet');
    await page.goto(`${BASE}/dispatch#tv`);
    await page.locator(`[data-tile="${name}"]`).click();
    await page.locator('[data-always-on]').waitFor({ state: 'detached' });
    await page.getByRole('dialog').waitFor();

    assert.deepEqual(errors, []);
  } catch (e) {
    const shot = join(tmpdir(), `dispatch-usage-fail-${Date.now()}.png`);
    await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
    throw new Error(`[step: ${step}] ${e.message}\nscreenshot: ${shot}\nserver log tail:\n${log.slice(-1500)}`, { cause: e });
  }
});
