import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Scene } from '../../shared/render/index.ts';
import { placeRuns, samePlaced, type PlaceEl, type PlaceView } from '../../web/src/canvas/runPlace.ts';
import { clearRuns, runStepsFor, setRunSteps, setStill } from '../../web/src/run/runStore.ts';
import * as store from '../../web/src/run/runStore.ts';
import { FIXTURE_STEPS } from '../../web/src/run/fixture.ts';

const scene = { width: 200, height: 100 } as unknown as Scene;
const pics: Record<string, { width: number; scene?: Scene }> = { f1: { width: 200, scene }, f2: { width: 400, scene }, ph: { width: 200 } };
const pictureOf = (id: string) => pics[id];
const view: PlaceView = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 };
const wrap = { left: 0, top: 0 };
const runs = new Set(['b1', 'b2']);
const img = (id: string, blockId: string, over: Partial<PlaceEl> = {}): PlaceEl => ({ id, type: 'image', x: 10, y: 20, width: 200, height: 100, opacity: 100, angle: 0, fileId: 'f1', customData: { blockId }, ...over });

test('placeRuns: one board per run block, at the picture position', () => {
  const out = placeRuns([img('e1', 'b1'), img('e2', 'other')], view, wrap, runs, pictureOf, null);
  assert.deepEqual(out, [{ blockId: 'b1', scene, left: 10, top: 20, scale: 1 }]);
});

test('placeRuns: hidden (layout edit), transparent, rotated, deleted and non-image elements are skipped', () => {
  assert.deepEqual(placeRuns([img('e1', 'b1')], view, wrap, runs, pictureOf, 'b1'), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { opacity: 0 })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { angle: 0.3 })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { isDeleted: true })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { type: 'rectangle' })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { width: 0 })], view, wrap, runs, pictureOf, null), []);
});

test('placeRuns: a placeholder picture (no scene) or an unknown file is skipped', () => {
  assert.deepEqual(placeRuns([img('e1', 'b1', { fileId: 'ph' })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { fileId: 'nope' })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { fileId: null })], view, wrap, runs, pictureOf, null), []);
});

test('placeRuns: copies of one block draw once, on the first drawable copy', () => {
  const out = placeRuns([img('e1', 'b1', { opacity: 0 }), img('e2', 'b1', { x: 50 }), img('e3', 'b1', { x: 90 })], view, wrap, runs, pictureOf, null);
  assert.deepEqual(out.map((p) => [p.blockId, p.left]), [['b1', 50]]);
});

test('placeRuns: scroll, zoom, canvas offset and the wrapper position move and scale the board', () => {
  const st: PlaceView = { scrollX: 5, scrollY: -10, zoom: { value: 2 }, offsetLeft: 100, offsetTop: 40 };
  // Image drawn at half its picture's width: scale 0.5 × zoom 2.
  const [p] = placeRuns([img('e1', 'b2', { fileId: 'f2' })], st, { left: 60, top: 30 }, runs, pictureOf, null);
  assert.deepEqual(p, { blockId: 'b2', scene, left: (10 + 5) * 2 + 40, top: (20 - 10) * 2 + 10, scale: 1 });
});

test('samePlaced compares every field', () => {
  const a = placeRuns([img('e1', 'b1')], view, wrap, runs, pictureOf, null);
  assert.ok(samePlaced(a, placeRuns([img('e1', 'b1')], view, wrap, runs, pictureOf, null)));
  assert.ok(!samePlaced(a, placeRuns([img('e1', 'b1', { x: 11 })], view, wrap, runs, pictureOf, null)));
  assert.ok(!samePlaced(a, []));
});

test('runStore: setRunSteps sets and null removes; clearRuns empties', () => {
  clearRuns();
  setRunSteps('b1', FIXTURE_STEPS);
  assert.equal(runStepsFor('b1'), FIXTURE_STEPS);
  setRunSteps('b1', null);
  assert.equal(runStepsFor('b1'), undefined);
  setRunSteps('b1', FIXTURE_STEPS);
  setRunSteps('b2', FIXTURE_STEPS);
  clearRuns();
  assert.equal(runStepsFor('b1'), undefined);
  assert.equal(runStepsFor('b2'), undefined);
});

test('runStore: setStill with the same value does not notify', () => {
  setStill(false);
  let calls = 0;
  const unsub = store.subscribeForTests(() => calls++);
  setStill(false);
  assert.equal(calls, 0);
  setStill(true);
  assert.equal(calls, 1);
  setStill(true);
  assert.equal(calls, 1);
  setStill(false);
  unsub();
});
