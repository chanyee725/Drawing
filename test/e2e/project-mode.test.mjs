// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Project mode (E30a): the server started with --project-mode opens only the Dispatch run screen.
// Scratch git repo in a temp dir, scratch HOME, fake CLIs only; the server log must name this workspace.
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
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('project mode: / opens the run screen, not the editor', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 60_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-pmode-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-pmode-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'pipelines');
  mkdirSync(ws);
  const fake = fakeCliBin({ scenario: [] });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', '--project-mode', ws], {
    env: { HOME: home, DRAW_PORT: String(port), ...fake.env, PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  let browser;
  t.after(async () => {
    await browser?.close();
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForURL(/\/dispatch$/);
  await page.getByText('세션', { exact: true }).first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('[data-testid="sidebar"], aside').count(), 0, 'no editor sidebar');
  assert.deepEqual(errors, []);
});
