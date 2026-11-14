// Headless browser check for the size of new free-form text (E64, #275). Runs on request only:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLEAN_LINE_HEIGHT } from '../../web/src/canvas/cleanStyle.ts';
import { TEXT_OFFSET } from '../../web/src/canvas/insert.ts';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SKIP = { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 };
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

const base = (id, type, x, y, w, h) => ({
  id,
  type,
  x,
  y,
  width: w,
  height: h,
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 1,
  strokeStyle: 'solid',
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 5,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  index: 'a0', // a saved file has its order: without it Excalidraw adds one and bumps the version
});
/** A saved 20px text element (the size new text had before E64). */
const text = (id, x, y, str, fontFamily, extra = {}) => ({
  ...base(id, 'text', x, y, 3, 25),
  text: str,
  originalText: str,
  fontSize: 20,
  fontFamily,
  textAlign: 'left',
  verticalAlign: 'top',
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
  ...extra,
});

/**
 * On Linux, the browser sees only the DejaVu fonts, so Liberation Sans is not on the system (as on macOS and
 * Windows): text measured before Excalidraw's copy of it has loaded gets a fallback font's width.
 */
const DEJAVU = '/usr/share/fonts/truetype/dejavu';
function withoutCleanFont(dir) {
  if (!existsSync(DEJAVU)) return {};
  const file = join(dir, 'fonts.conf');
  writeFileSync(file, `<?xml version="1.0"?><fontconfig><dir>${DEJAVU}</dir><cachedir>${join(dir, 'fc-cache')}</cachedir></fontconfig>`);
  return { FONTCONFIG_FILE: file };
}

/** Server on a free port against a scratch workspace, a file `path` with `elements`, and a headless page on its canvas. */
async function open(t, path, elements) {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-textsize-'));
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
  // Another session's server may share ports: write only once the log names this workspace.
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) })).json();
  const f = await call('POST', '/api/file', { path, title: '글자 크기' });
  await call('PUT', `/api/file?path=${path}`, { ...f, canvas: { ...f.canvas, elements } });
  /**
   * The saved elements by id, once `ready(elements)` holds. Autosave is debounced and slower under load,
   * so poll the file until then, up to a deadline; past it return the last read and let the asserts say what is missing.
   */
  const saved = async (ready, ms = 30_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const g = await call('GET', `/api/file?path=${path}`);
      const s = new Map(g.canvas.elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
      if (ready(s) || Date.now() > deadline) return s;
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME, env: { ...process.env, ...withoutCleanFont(ws) } });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=${path}`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  // Only the canvas view: wait until the canvas is drawn, fills the space the document had, and keeps that size.
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForFunction(
    () => {
      if (!document.querySelector('.excalidraw canvas')) return false;
      const w = document.querySelector('.excalidraw')?.getBoundingClientRect().width ?? 0;
      const last = window.__canvasWidth;
      window.__canvasWidth = w;
      return w > window.innerWidth / 2 && w === last;
    },
    null,
    { polling: 100, timeout: 30_000 },
  );
  /** Width of one line of `str` in the clean font, measured once the font has loaded. */
  const cleanWidth = (str, px) =>
    page.evaluate(async ([s, size]) => {
      const font = `${size}px Liberation Sans`;
      await document.fonts.load(font, s);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = font;
      return ctx.measureText(s).width;
    }, [str, px]);
  return { page, saved, errors, cleanWidth };
}

test('new text is 13px, a saved text keeps its size, and a new label wraps inside its shape', SKIP, async (t) => {
  const { page, saved, errors, cleanWidth } = await open(t, 'size', [text('old', 100, 100, 'Saved at twenty', 9)]);

  // A text typed with the text tool.
  const typed = 'Typed just now';
  await page.mouse.click(500, 600); // keys go to the canvas
  await page.keyboard.press('t');
  await page.mouse.click(500, 600);
  await page.waitForSelector('textarea.excalidraw-wysiwyg');
  await page.keyboard.type(typed);
  await page.keyboard.press('Escape');

  // A text from the insert menu.
  await page.mouse.click(1100, 700);
  await page.keyboard.press('/');
  await page.keyboard.type('텍스트');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  // A label typed into a new shape: longer than one line holds.
  const label = 'A label long enough to wrap onto several lines inside this small box';
  await page.keyboard.press('r');
  await page.mouse.move(800, 300);
  await page.mouse.down();
  await page.mouse.move(920, 360, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await page.waitForSelector('textarea.excalidraw-wysiwyg');
  await page.keyboard.type(label);
  await page.keyboard.press('Escape');

  const texts = (s) => [...s.values()].filter((e) => e.type === 'text');
  const s = await saved((m) => {
    const t = texts(m);
    return t.some((e) => e.text === typed) && t.some((e) => e.text === '텍스트') && t.some((e) => e.originalText === label && m.has(e.containerId));
  });
  const fresh = [...s.values()].find((e) => e.type === 'text' && e.text === typed);
  assert.ok(fresh, 'the typed text is saved');
  assert.equal(fresh.fontSize, 13);
  assert.equal(fresh.fontFamily, 9);
  const want = await cleanWidth(typed, 13);
  assert.ok(Math.abs(fresh.width - want) < 1, `width ${fresh.width}, measured at 13px ${want}`);
  assert.ok(Math.abs(fresh.height - 13 * fresh.lineHeight) < 0.5, `one 13px line, height ${fresh.height}`);

  const menu = [...s.values()].find((e) => e.type === 'text' && e.text === '텍스트');
  assert.ok(menu, 'the insert-menu text is saved');
  assert.equal(menu.fontSize, 13);
  // Its line height is the clean one, so TEXT_OFFSET.y is half of its one line. (Its width depends on which
  // font draws Hangul on the machine, so the x offset is only an estimate and not checked here.)
  assert.equal(menu.lineHeight, CLEAN_LINE_HEIGHT);
  assert.ok(Math.abs(TEXT_OFFSET.y - menu.height / 2) <= 0.5, `offset y ${TEXT_OFFSET.y}, half height ${menu.height / 2}`);

  const bound = [...s.values()].find((e) => e.type === 'text' && e.originalText === label);
  assert.ok(bound, 'the label is saved');
  assert.equal(bound.fontSize, 13);
  const box = s.get(bound.containerId);
  assert.ok(box, 'in its shape');
  const lines = bound.text.split('\n');
  assert.ok(lines.length > 1, `the label wraps: ${JSON.stringify(bound.text)}`);
  // Excalidraw keeps 5px between a shape's edge and its label.
  for (const l of lines) {
    const w = await cleanWidth(l, 13);
    assert.ok(w <= box.width - 10 + 1, `line ${JSON.stringify(l)} is ${w} wide in a ${box.width} box`);
  }
  assert.ok(Math.abs(bound.height - lines.length * 13 * bound.lineHeight) < 0.5, `${lines.length} lines of 13px, height ${bound.height}`);
  assert.ok(box.height >= bound.height + 10 - 1, `the shape (${box.height}) holds the label (${bound.height})`);
  assert.ok(Math.abs(bound.y + bound.height / 2 - (box.y + box.height / 2)) < 1, 'the label sits in the middle');

  const old = s.get('old');
  assert.equal(old.fontSize, 20, 'the saved text keeps its size');
  assert.equal(old.version, 5, 'and its version');
  assert.deepEqual(errors, []);
});

test('the size buttons hold the 13px step: it is on for new text and can be picked again', SKIP, async (t) => {
  const { page, saved, errors } = await open(t, 'steps', [text('old', 100, 100, 'Saved at thirty-six', 9, { fontSize: 36, height: 45 })]);
  const button = (name) => page.locator(`label:has([data-testid="fontSize-${name}"])`);
  const checked = () => page.$$eval('input[data-testid^="fontSize-"]', (els) => els.filter((e) => e.checked).map((e) => e.dataset.testid));
  /** Type `str` with the text tool at a point, after picking a size button (when given). */
  const type = async (str, x, y, size) => {
    await page.keyboard.press('t');
    await button('small').waitFor();
    if (size) await button(size).click();
    await page.mouse.click(x, y);
    await page.waitForSelector('textarea.excalidraw-wysiwyg');
    await page.keyboard.type(str);
    await page.keyboard.press('Escape');
  };

  await page.mouse.click(500, 600); // keys go to the canvas
  await page.keyboard.press('t');
  await button('small').waitFor();
  assert.deepEqual(await checked(), ['fontSize-small'], 'the default step is on for new text');
  assert.equal(await button('small').getAttribute('title'), '작게');
  // DRAW_E2E_SHOTS=<dir>: keep light and dark pictures of the style panel there.
  if (process.env.DRAW_E2E_SHOTS) {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForFunction((s) => document.documentElement.dataset.theme === s, scheme);
      await page.mouse.move(700, 450); // off the panel: no button is drawn hovered
      await page.locator('.App-menu__left').screenshot({ path: join(process.env.DRAW_E2E_SHOTS, `size-steps-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await page.keyboard.press('Escape');

  await type('First', 500, 500);
  await type('Bigger', 500, 600, 'large');
  assert.deepEqual(await checked(), ['fontSize-large']);
  await page.keyboard.press('Escape');
  await type('Back again', 500, 700, 'small'); // no reload in between
  assert.deepEqual(await checked(), ['fontSize-small']);
  await page.keyboard.press('Escape');


  const byText = (m, str) => [...m.values()].find((e) => e.type === 'text' && e.text === str);
  const s = await saved((m) => ['First', 'Bigger', 'Back again'].every((x) => byText(m, x)));
  assert.equal(byText(s, 'First')?.fontSize, 13);
  assert.equal(byText(s, 'Bigger')?.fontSize, 20);
  assert.equal(byText(s, 'Back again')?.fontSize, 13);
  const old = s.get('old');
  assert.equal(old.fontSize, 36, 'the saved text keeps its size, though 36 is no longer a step');
  assert.equal(old.version, 5, 'and its version');
  assert.deepEqual(errors, []);
});
