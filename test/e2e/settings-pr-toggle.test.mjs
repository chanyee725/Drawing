// Headless check of the PR/CI tracking switch in the settings dialog (#402): it flips and persists, and a broken
// <workspace>/.drawing/settings.json (server 409) shows the real cause instead of "이 서버에선 바꿀 수 없어요".
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Scratch git repo + scratch HOME; PATH holds the fake CLIs from test/fixtures/fake-cli/, so no real claude, codex or agy can start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';
import { which } from '../../server/dispatch/cli.js';

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

test('settings dialog: PR/CI switch flips, persists, names a broken settings file once, keeps focus, says when a retry still fails and recovers', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-prtoggle-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-prtoggle-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const settingsFile = join(ws, '.drawing', 'settings.json');
  const fake = fakeCliBin();
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), FAKE_CLI_LOG: fake.env.FAKE_CLI_LOG, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    // Wait for the server to exit so it cannot write into the scratch repo while it is being removed (ENOTEMPTY).
    const exited = server.exitCode !== null ? Promise.resolve() : new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  const dialog = page.getByRole('dialog', { name: '설정' });
  const open = async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '실행' }).click();
  };
  const sw = () => dialog.getByRole('switch');

  // 1. Healthy: on by default, flips off, persists in settings.json, and flips back on.
  await open();
  await dialog.getByText("켜짐", { exact: true }).waitFor();
  assert.equal(await sw().getAttribute('aria-checked'), 'true');
  await sw().click();
  await dialog.getByRole('status').filter({ hasText: '저장했어요.' }).waitFor();
  assert.equal(await sw().getAttribute('aria-checked'), 'false');
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).prStatus, false);
  await sw().click();
  await dialog.getByText('켜짐', { exact: true }).waitFor();

  // 2. File breaks while the dialog is open: the toggle's 409 shows the cause once (not in the status line too),
  // the red line describes the switch, and the switch stays enabled with keyboard focus on it.
  const BROKEN = '설정 파일을 읽을 수 없어요. 파일을 확인해 주세요.';
  const STILL = '아직 읽을 수 없어요.';
  const describedBy = async () => {
    const ids = (await sw().getAttribute('aria-describedby')) ?? '';
    return page.evaluate((list) => list.split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' '), ids);
  };
  writeFileSync(settingsFile, '{ not json');
  await sw().focus();
  await page.keyboard.press('Space');
  await dialog.getByText(BROKEN).waitFor();
  assert.equal(await dialog.getByText(BROKEN).count(), 1, 'the 409 cause shows once');
  assert.equal(await dialog.getByRole('status').filter({ hasText: BROKEN }).count(), 0);
  assert.equal(await dialog.getByText('이 서버에선 바꿀 수 없어요').count(), 0);
  assert.equal(await describedBy(), BROKEN);
  assert.equal(await sw().isDisabled(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'switch', 'focus stays on the switch');
  assert.equal(await dialog.getByText(STILL).count(), 0, 'the first 409 shows no retry notice');

  // 2b. Pressing again with the file still broken keeps the cause and focus; after fixing the file it recovers in place.
  // A retry that still fails says so in the status line, every time (#409).
  await page.keyboard.press('Space');
  await dialog.getByRole('status').filter({ hasText: STILL }).waitFor();
  await dialog.getByText(BROKEN).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'switch');
  await dialog.getByRole('status').evaluate((el) => {
    const seen = [];
    new MutationObserver(() => seen.push(el.textContent)).observe(el, { childList: true, subtree: true, characterData: true });
    window.__statusSeen = seen;
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__statusSeen.at(-1) === '아직 읽을 수 없어요.' && window.__statusSeen.includes(''));
  writeFileSync(settingsFile, JSON.stringify({ prStatus: true }));
  await page.keyboard.press('Space');
  await dialog.getByText('켜짐', { exact: true }).waitFor();
  assert.equal(await sw().getAttribute('aria-checked'), 'true');
  assert.equal(await dialog.getByText(BROKEN).count(), 0);
  assert.equal(await sw().getAttribute('aria-describedby'), null);
  // The red live region stays rendered (not display:none) while empty, so its next text is announced (#409).
  assert.equal(await dialog.locator('p[aria-live="polite"]').evaluate((el) => el.textContent === '' && getComputedStyle(el).display !== 'none'), true);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'switch');
  await page.keyboard.press('Space');
  await dialog.getByText('꺼짐', { exact: true }).waitFor();
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).prStatus, false, 'toggling works again after recovery');

  // 3. Dialog opened with the file already broken (GET 409): same cause shown once and linked; switch stays usable.
  writeFileSync(settingsFile, '{ not json');
  await open();
  await dialog.getByText(BROKEN).waitFor();
  assert.equal(await dialog.getByText(BROKEN).count(), 1);
  assert.equal(await dialog.getByText('이 서버에선 바꿀 수 없어요').count(), 0);
  assert.equal(await describedBy(), BROKEN);
  assert.equal(await sw().isDisabled(), false);
  await sw().focus();
  await page.keyboard.press('Space');
  await dialog.getByRole('status').filter({ hasText: STILL }).waitFor();
  assert.deepEqual(errors, []);
});
