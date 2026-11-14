// Headless browser check for the clean free-form canvas (E58, #270). Runs on request only:
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
/** A text element saved with a wrong width, as if it had been measured with another font. */
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

/**
 * Server on a free port against a scratch workspace, a file `path` with `elements`, and a headless page on its canvas.
 * `before(page)` runs before the page loads (to hold requests).
 */
async function open(t, path, elements, before) {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-clean-'));
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
  const f = await call('POST', '/api/file', { path, title: '정리' });
  await call('PUT', `/api/file?path=${path}`, { ...f, canvas: { ...f.canvas, elements } });
  const saved = async () => {
    await new Promise((r) => setTimeout(r, 1500)); // autosave is debounced
    const g = await call('GET', `/api/file?path=${path}`);
    return new Map(g.canvas.elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  };

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME, env: { ...process.env, ...withoutCleanFont(ws) } });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await before?.(page);
  await page.goto(`${BASE}/#file=${path}`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(800);
  /** Width of one line of `str` in the clean font, measured once the font has loaded. */
  const cleanWidth = (str) =>
    page.evaluate(async (s) => {
      const font = '20px Liberation Sans';
      await document.fonts.load(font, s);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = font;
      return ctx.measureText(s).width;
    }, str);
  /** An edit somewhere else, so the scene is saved: a rectangle from the `/` menu. */
  const edit = async () => {
    await page.mouse.click(1100, 700);
    await page.keyboard.press('/');
    await page.keyboard.type('네모');
    await page.keyboard.press('Enter');
  };
  return { page, saved, errors, cleanWidth, edit };
}

test('a handwriting text opens in the clean font with its width measured in that font', SKIP, async (t) => {
  const str = 'Handwriting turns clean';
  const { saved, errors, cleanWidth, edit } = await open(t, 'open', [text('hand', 100, 100, str, 5)]);
  await edit();
  const s = await saved();
  const hand = s.get('hand');
  assert.equal(hand.fontFamily, 9);
  const want = await cleanWidth(str);
  assert.ok(Math.abs(hand.width - want) < 1, `width ${hand.width}, measured in the clean font ${want}`);
  assert.deepEqual(errors, []);
});

/**
 * Holds Excalidraw's copy of the clean font until `release()`, so texts must wait for it (RefitQueue). Pass `hold`
 * as `open`'s `before`. `loaded()` tells whether the font is in; `fallbackWidth(str)` measures `str` now, with
 * whatever font the browser falls back to; `loadedAfterRelease()` releases and waits for the font.
 */
function heldFont() {
  let release;
  const held = new Promise((r) => (release = r));
  const hold = (p) =>
    p.route('**/LiberationSans-Regular.woff2', async (route) => {
      await held;
      await route.continue();
    });
  const helpers = (page) => {
    const loaded = () => page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Liberation Sans' && f.status === 'loaded'));
    const fallbackWidth = (str) =>
      page.evaluate((s) => {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = '20px Liberation Sans';
        return ctx.measureText(s).width;
      }, str);
    const loadedAfterRelease = async () => {
      release();
      for (let i = 0; i < 50 && !(await loaded()); i++) await page.waitForTimeout(100);
      return loaded();
    };
    return { loaded, fallbackWidth, loadedAfterRelease };
  };
  return { hold, helpers };
}

// The order where the font loads while the scene is still empty (#305) is covered by the unit test only: Excalidraw
// puts the opened scene in right after initialData resolves, before a font event can run.
test('a text that changed font before the clean font loads is measured once it has', SKIP, async (t) => {
  // Excalidraw's copy of the clean font is held back until the scene is on screen, so the text must not be measured
  // with a fallback font: it waits for the font (RefitQueue).
  const font = heldFont();
  const str = 'Waits for the font';
  const { page, saved, errors, cleanWidth, edit } = await open(t, 'wait', [text('late', 100, 100, str, 5)], font.hold);
  const { loaded, fallbackWidth, loadedAfterRelease } = font.helpers(page);
  assert.equal(await loaded(), false, 'the clean font is still held back');
  const before = await fallbackWidth(str);
  assert.equal(await loadedAfterRelease(), true, 'the clean font loaded once released');
  await page.waitForTimeout(300);
  await edit();
  const late = (await saved()).get('late');
  assert.equal(late.fontFamily, 9);
  const want = await cleanWidth(str);
  assert.ok(Math.abs(want - before) >= 1, `the fallback font measures differently (${before} vs ${want}), or this test proves nothing`);
  assert.ok(Math.abs(late.width - want) < 1, `width ${late.width}, measured in the clean font ${want}`);
  assert.deepEqual(errors, []);
});

test('a text pasted before the clean font loads is measured once it has, and saved without another edit', SKIP, async (t) => {
  const font = heldFont();
  const str = 'Pasted before the font';
  const { page, saved, errors, cleanWidth } = await open(t, 'early-paste', [], font.hold);
  const { loaded, fallbackWidth, loadedAfterRelease } = font.helpers(page);
  await page.mouse.click(600, 400);
  await page.evaluate((data) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', data);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, JSON.stringify({ type: 'excalidraw/clipboard', elements: [text('pasted', 0, 0, str, 1)], files: {} }));
  await page.waitForTimeout(300);
  assert.equal(await loaded(), false, 'the clean font is still held back when the text is pasted');
  const before = await fallbackWidth(str);
  assert.equal(await loadedAfterRelease(), true, 'the clean font loaded once released');
  const pasted = [...(await saved()).values()].find((e) => e.type === 'text' && e.text === str);
  assert.ok(pasted, 'the pasted text is saved');
  assert.equal(pasted.fontFamily, 9);
  const want = await cleanWidth(str);
  assert.ok(Math.abs(want - before) >= 1, `the fallback font measures differently (${before} vs ${want}), or this test proves nothing`);
  assert.ok(Math.abs(pasted.width - want) < 1, `pasted width ${pasted.width}, measured in the clean font ${want}`);
  assert.deepEqual(errors, []);
});

test('opening a handwriting file alone writes nothing', SKIP, async (t) => {
  const { saved, errors } = await open(t, 'quiet', [text('hand', 100, 100, 'Just looking', 5)]);
  const s = await saved(); // past the autosave debounce, no edit
  const hand = s.get('hand');
  assert.equal(hand.version, 5, 'the saved version stays');
  assert.equal(hand.width, 3, 'and so does the saved width');
  assert.equal(hand.fontFamily, 5, 'and the saved font');
  assert.deepEqual(errors, []);
});

test("a labelled rectangle grows to fit its label in the clean font, and its arrow follows", SKIP, async (t) => {
  // A label saved one line tall in a box only 30 high: in the clean font at a narrow width it wraps to more lines.
  const str = 'A label long enough to wrap in this box';
  const box = { ...base('box', 'rectangle', 100, 100, 120, 30), boundElements: [{ id: 'label', type: 'text' }, { id: 'down', type: 'arrow' }] };
  const label = text('label', 105, 105, str, 5, { width: 110, height: 20, containerId: 'box', textAlign: 'center', verticalAlign: 'middle', autoResize: true, index: 'a1' });
  // An arrow from below into the bottom edge (gap 4).
  const down = { ...base('down', 'arrow', 160, 400, 0, 266), index: 'a2', points: [[0, 0], [0, -266]], startBinding: null, endBinding: { elementId: 'box', focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: 'arrow', elbowed: false, lastCommittedPoint: null };
  const { saved, errors, edit } = await open(t, 'boxed', [box, label, down]);
  await edit();
  const s = await saved();
  const b = s.get('box');
  const l = s.get('label');
  const a = s.get('down');
  assert.equal(l.fontFamily, 9);
  assert.ok(l.height > 25, `the label wraps: height ${l.height}`);
  assert.equal(b.y, 100, 'the box keeps its top');
  assert.equal(b.height, Math.ceil(l.height) + 10, 'and grows to fit the label');
  assert.ok(Math.abs(l.y + l.height / 2 - (b.y + b.height / 2)) < 1, `the label is centred: ${l.y} + ${l.height} in ${b.y} + ${b.height}`);
  const tip = a.y + a.points.at(-1)[1];
  assert.ok(Math.abs(tip - (b.y + b.height + 4)) < 1, `the arrow ends at the new bottom edge: ${tip}`);
  assert.equal(a.y, 400, 'and starts where it did');
  assert.deepEqual(errors, []);
});

test('pasting one handwriting text measures that text only', SKIP, async (t) => {
  // `other` is clean already, with a width from another machine: a paste must not touch it.
  const { page, saved, errors, cleanWidth } = await open(t, 'paste', [text('other', 100, 300, 'Leave me alone', 9)]);
  const str = 'Pasted by hand';
  const clip = JSON.stringify({ type: 'excalidraw/clipboard', elements: [text('pasted', 0, 0, str, 1)], files: {} });
  await page.mouse.click(600, 400);
  await page.evaluate((data) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', data);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, clip);
  const s = await saved();
  const pasted = [...s.values()].find((e) => e.type === 'text' && e.text === str);
  assert.ok(pasted, 'the pasted text is saved');
  assert.equal(pasted.fontFamily, 9);
  const want = await cleanWidth(str);
  assert.ok(Math.abs(pasted.width - want) < 1, `pasted width ${pasted.width}, measured in the clean font ${want}`);
  const other = s.get('other');
  assert.equal(other.width, 3, 'the other text keeps its saved width');
  assert.equal(other.version, 5, 'and its version');
  assert.deepEqual(errors, []);
});

test('the style panel offers no sloppiness or handwriting fonts', SKIP, async (t) => {
  const { page, errors } = await open(t, 'panel', [text('t', 300, 300, 'Pick a font', 9)]);
  // Select the text: the style panel shows its font and stroke options.
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(600);
  await page.locator('.excalidraw').focus();
  await page.keyboard.press('Control+a');
  await page.locator('.excalidraw [data-testid="font-family-normal"]').waitFor({ timeout: 5000 });
  // The selectors in index.css rely on these Excalidraw internals: they must still exist, and be hidden.
  assert.equal(await page.locator('.excalidraw [data-testid="font-family-normal"]').count() > 0, true, 'the panel shows the font buttons');
  const hand = page.locator('.excalidraw [data-testid="font-family-hand-drawn"]');
  assert.equal(await hand.count(), 1, 'Excalidraw still has the handwriting font button');
  assert.equal(await hand.isVisible(), false, 'and it is hidden');
  // Sloppiness only shows for shapes: draw a rectangle too.
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(850, 400, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const sloppy = page.locator('.excalidraw fieldset:has(input[name="sloppiness"])');
  assert.equal(await sloppy.count(), 1, 'Excalidraw still has the sloppiness options');
  assert.equal(await sloppy.isVisible(), false, 'and they are hidden');
  // Font list (a popover inside .excalidraw): Virgil (1) and Excalifont (5) are hidden.
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(400);
  await page.locator('.excalidraw [data-testid="font-family-show-fonts"]').click();
  const list = page.locator('.dropdown-menu.fonts');
  await list.waitFor({ timeout: 5000 });
  // Excalidraw lists Excalifont always: it must still be there, and hidden.
  const excalifont = list.locator('.dropdown-menu-item[value="5"]');
  assert.equal(await excalifont.count(), 1, 'Excalidraw still lists Excalifont');
  assert.equal(await excalifont.isVisible(), false, 'and it is hidden');
  // Virgil is deprecated: Excalidraw lists it only while the scene uses it (or with showDeprecatedFonts), and the
  // canvas turns every Virgil text clean. So it is not in the list at all; the index.css rule is a safeguard.
  assert.equal(await list.locator('.dropdown-menu-item[value="1"]').count(), 0, 'Virgil is not listed');
  // Liberation Sans (9) is never listed (Excalidraw marks it server-side); the other clean fonts are.
  assert.equal(await list.locator('.dropdown-menu-item[value="6"]').isVisible(), true, 'Nunito is listed');
  assert.deepEqual(errors, []);
});
