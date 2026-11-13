// Headless check of the live agent cursor (E56, #226): a fake Claude session edits a diagram file twice; the cursor
// appears with the session's name at the first edit, then glides to the second, then fades out.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude, codex or agy can start. It refuses to go on unless the server log names its port and workspace.
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

const rect = (id, x, y) => ({ id, type: 'rectangle', x, y, width: 120, height: 60, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false });

const SKIP = !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run';

test('agent cursor: a fake session edits a diagram; the cursor appears, moves and fades', { skip: SKIP, timeout: 180_000 }, (t) => run(t, 0));

// The second edit remounts the canvas: on a slow page (or while screen-recording a demo) the remount stalls the main
// thread for longer than the glide. The glide must still be seen, not jump (#254).
test('agent cursor: the glide is still seen with the page CPU throttled', { skip: SKIP, timeout: 240_000 }, (t) => run(t, 8));

async function run(t, cpuThrottle) {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-cursor-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-cursor-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const abs = join(ws, 'demo.dpx.json');

  // The agent's turn: say it edits the file, write the file (as an Edit tool would), think, edit again, finish.
  const tool = (n) => ({ type: 'assistant', message: { id: `m${n}`, content: [{ type: 'tool_use', id: `t${n}`, name: 'Edit', input: { file_path: abs, old_string: 'x', new_string: 'y' } }], usage: { input_tokens: 1, output_tokens: 1 } } });
  const result = (n) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: 'ok' }] } });
  const fileWith = (elements, revision) => JSON.stringify({ version: 4, title: 'demo', document: { type: 'doc', content: [] }, canvas: { elements, appState: {} }, blocks: [], revision });
  const r1 = rect('r1', 0, 0);
  const scenario = [
    { type: 'system', subtype: 'init', session_id: 'fake-cursor-session' },
    // Wait for the page to open the file first.
    { $sleep: 4000 },
    tool(1),
    { $sleep: 300 },
    { $write: { file: abs, text: fileWith([r1, rect('r2', 400, 0)], 50) } }, // r2 centre: 460,30
    result(1),
    { $sleep: 1800 },
    tool(2),
    { $sleep: 300 },
    { $write: { file: abs, text: fileWith([r1, rect('r2', 400, 0), rect('r3', 400, 300)], 60) } }, // r3 centre: 460,330
    result(2),
    { $sleep: 2500 },
    { type: 'assistant', message: { id: 'm3', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
  ];
  const fake = fakeCliBin({ scenario });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), ...fake.env, PATH, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => {
    const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    const body = await res.json();
    assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
    return body;
  };
  const f = await call('POST', '/api/file', { path: 'demo.dpx.json', title: 'demo', canvas: { elements: [r1], appState: {} } });
  assert.equal(f.path, 'demo.dpx.json');
  assert.ok(readFileSync(abs, 'utf8').includes('"r1"'));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=demo.dpx.json`);
  await page.locator('.excalidraw').first().waitFor();
  if (cpuThrottle) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  }

  // Every cursor node, when it enters the DOM (each outside edit remounts the canvas and its cursor layer), must
  // already be placed or hidden (while the canvas loads): a node without `translate` paints at the overlay's
  // top-left corner (#249).
  await page.evaluate(() => {
    const added = (window.__cursorAdds = []);
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes)
          if (n instanceof HTMLElement)
            for (const el of [n, ...n.querySelectorAll('[data-agent-cursor]')])
              if (el.matches('[data-agent-cursor]')) added.push({ at: el.style.translate, hidden: el.style.visibility === 'hidden' });
    }).observe(document.body, { childList: true, subtree: true });
  });

  await call('POST', '/api/providers/claude/login');
  const { sessions } = await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'draw two boxes' }], worktree: false });
  assert.equal(sessions.length, 1);
  const name = sessions[0].name; // the hub picks the session's name
  assert.ok(name);

  const cursor = page.locator('[data-agent-cursor]');
  await cursor.waitFor({ timeout: 15_000 });
  assert.equal(await cursor.getAttribute('data-role'), 'impl');
  // The session's own colour, picked when it was created: the same on the pointer and the tag, white text on it.
  assert.match(sessions[0].color, /^#[0-9a-f]{6}$/);
  const paint = await cursor.evaluate((el) => {
    const tag = el.querySelector('.agent-cursor-tag');
    return { agent: el.style.getPropertyValue('--agent'), pointer: getComputedStyle(el.querySelector('path')).fill, tag: getComputedStyle(tag).backgroundColor, text: getComputedStyle(tag).color };
  });
  const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  assert.equal(paint.agent, sessions[0].color);
  assert.equal(hex(paint.pointer), sessions[0].color);
  assert.equal(hex(paint.tag), sessions[0].color);
  assert.equal(hex(paint.text), '#ffffff');
  assert.match(await cursor.locator('.agent-cursor-tag').textContent(), new RegExp(name));
  const at = () => cursor.evaluate((el) => el.style.translate.split(' ').map((v) => parseFloat(v)));
  await page.waitForTimeout(400);
  const first = await at();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'agent-cursor-first.png') });

  // Thinking near the last edit before the second edit arrives.
  await page.locator('[data-agent-cursor][data-phase="thinking"]').waitFor({ timeout: 5000 });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'agent-cursor-thinking.png') });

  // Record where the cursor is drawn on every frame, so the 220 ms glide is seen whole.
  await page.evaluate(() => {
    const ys = (window.__cursorYs = []);
    const tick = () => {
      const el = document.querySelector('[data-agent-cursor]');
      if (el?.style.translate && el.style.visibility !== 'hidden') ys.push(parseFloat(el.style.translate.split(' ')[1]));
      if (ys.length < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // The second edit: the cursor goes from r2's centre (460,30) to r3's (460,330).
  await page.locator('[data-agent-cursor][data-phase="editing"]').waitFor({ timeout: 8000 });
  // Until it has landed (a throttled page draws fewer frames, so the glide takes longer there).
  await page.waitForFunction(
    (y0) => {
      const el = document.querySelector('[data-agent-cursor]');
      return el && el.style.visibility !== 'hidden' && Math.abs(parseFloat(el.style.translate.split(' ')[1]) - y0 - 150) < 2;
    },
    first[1],
    { timeout: 10_000, polling: 'raf' },
  ).catch(() => {});
  await page.waitForTimeout(100);
  const second = await at();
  const ys = await page.evaluate(() => window.__cursorYs);
  // An edit from outside reopens the canvas centred on its content at zoom 1 (ExcalidrawCanvas initialData,
  // scrollToContent). Content bounds: y 0..60 before (centre 30), y 0..360 after (centre 180); x 0..520 both times.
  // So on screen the cursor keeps its x and lands (330 - 180) - (30 - 30) = 150 px lower: still on r3's centre.
  assert.ok(Math.abs(second[0] - first[0]) < 2, `same x: ${first} → ${second}`);
  assert.ok(Math.abs(second[1] - first[1] - 150) < 2, `on r3's centre: ${first} → ${second}`);
  // It glided: some frames drew it between the two places, not only at one or the other.
  assert.ok(ys.some((y) => y > first[1] + 5 && y < second[1] - 5), `glided through the middle: ${JSON.stringify(ys.filter((y, i) => y !== ys[i - 1]))}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'agent-cursor-second.png') });

  // No cursor node ever entered the DOM unplaced (one per mount: the first edit and the remount after the second).
  const adds = await page.evaluate(() => window.__cursorAdds);
  assert.ok(adds.length >= 2, `cursor mounts seen: ${JSON.stringify(adds)}`);
  assert.ok(adds.every((a) => a.hidden || (a.at && a.at !== 'none')), `placed or hidden before the first paint: ${JSON.stringify(adds)}`);

  // The session stops editing and its turn ends: the cursor goes.
  await cursor.waitFor({ state: 'detached', timeout: 15_000 });
  assert.deepEqual(errors, []);
}
