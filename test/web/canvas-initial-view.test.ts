// E494: the canvas fits every block on a file's first open, and keeps the view the user left it at afterwards.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FIT_MAX_ZOOM, fitView, forgetViews, openingView, rememberView, rememberedView } from '../../web/src/canvas/initialView.ts';

beforeEach(() => forgetViews());

/** Where scene point (x, y) lands on screen in a view (Excalidraw: (p + scroll) * zoom). */
const onScreen = (v: { scrollX: number; scrollY: number; zoom: number }, x: number, y: number) => ({ x: (x + v.scrollX) * v.zoom, y: (y + v.scrollY) * v.zoom });

test('two wide blocks side by side both fit a 1440x900 canvas', () => {
  // Block A at x=0 and block B at x=1000, each 900x420 (the issue repro).
  const v = fitView([0, 0, 1900, 420], 1440, 900)!;
  assert.ok(v.zoom < 1);
  for (const [x, y] of [[0, 0], [1900, 420]] as const) {
    const p = onScreen(v, x, y);
    assert.ok(p.x >= 0 && p.x <= 1440 && p.y >= 0 && p.y <= 900, `(${x},${y}) on screen at ${p.x},${p.y}`);
  }
  // Centred.
  const c = onScreen(v, 950, 210);
  assert.ok(Math.abs(c.x - 720) < 1e-6 && Math.abs(c.y - 450) < 1e-6);
});

test('the fitted zoom is rounded down to a 10% step and leaves a margin', () => {
  const v = fitView([0, 0, 1000, 100], 1000, 1000)!;
  // 1000/1000 * 0.9 = 0.9.
  assert.equal(v.zoom, 0.9);
  const w = fitView([0, 0, 1900, 420], 1440, 900)!;
  assert.equal(w.zoom, 0.6);
});

test('a small drawing is not blown up past 100%', () => {
  const v = fitView([100, 100, 300, 200], 1440, 900)!;
  assert.equal(v.zoom, FIT_MAX_ZOOM);
  const c = onScreen(v, 200, 150);
  assert.ok(Math.abs(c.x - 720) < 1e-6 && Math.abs(c.y - 450) < 1e-6);
});

test('a huge drawing stops at the smallest zoom', () => {
  assert.equal(fitView([0, 0, 1e6, 1e6], 1000, 1000)!.zoom, 0.1);
});

test('nothing to fit: no shapes, a hidden canvas or broken bounds', () => {
  assert.equal(fitView(null, 1440, 900), null);
  assert.equal(fitView([0, 0, 10, 10], 0, 900), null);
  assert.equal(fitView([0, 0, 10, 10], 1440, 0), null);
  assert.equal(fitView([0, 0, Infinity, 10], 1440, 900), null);
  assert.equal(fitView([10, 0, 0, 10], 1440, 900), null);
});

test('a single point (one tiny shape) fits at 100% without dividing by zero', () => {
  const v = fitView([5, 5, 5, 5], 800, 600)!;
  assert.equal(v.zoom, 1);
  assert.deepEqual(onScreen(v, 5, 5), { x: 400, y: 300 });
});

test('first open fits; a view the user moved to is kept on the next open (reload, switching back)', () => {
  const first = openingView('a.dpx.json', [0, 0, 1900, 420], 1440, 900)!;
  assert.equal(first.zoom, 0.6);
  // Excalidraw reports the fitted view back: still not the user's.
  rememberView('a.dpx.json', first);
  assert.equal(rememberedView('a.dpx.json'), null);
  // The user zooms in on block B.
  const mine = { scrollX: -1200, scrollY: -100, zoom: 1.5 };
  rememberView('a.dpx.json', mine);
  assert.deepEqual(openingView('a.dpx.json', [0, 0, 5000, 5000], 1440, 900), mine);
  // Other files are not affected.
  assert.equal(openingView('b.dpx.json', [0, 0, 1900, 420], 1440, 900)!.zoom, 0.6);
});

test('a reload before the user moved the view fits again, so a block an agent added comes into view', () => {
  const first = openingView('a.dpx.json', [0, 0, 900, 420], 1440, 900)!;
  rememberView('a.dpx.json', first);
  const again = openingView('a.dpx.json', [0, 0, 1900, 420], 1440, 900)!;
  assert.equal(again.zoom, 0.6);
});

test('no path: always a fit, nothing remembered', () => {
  rememberView(undefined, { scrollX: 1, scrollY: 2, zoom: 3 });
  assert.equal(rememberedView(undefined), null);
  assert.equal(openingView(undefined, [0, 0, 1900, 420], 1440, 900)!.zoom, 0.6);
});

test('broken views are not remembered', () => {
  rememberView('a.dpx.json', { scrollX: NaN, scrollY: 0, zoom: 1 });
  rememberView('a.dpx.json', { scrollX: 0, scrollY: 0, zoom: 0 });
  assert.equal(rememberedView('a.dpx.json'), null);
});
