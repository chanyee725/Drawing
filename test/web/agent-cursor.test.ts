// E56 live agent cursor: position and interpolation model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCursor, easeOut, nextPhaseAt, FADE_AFTER_MS, FADE_MS, MOVE_MS, moving, phaseOf, positionAt, pruneGone, THINK_MS, toScreen, type Cursor } from '../../web/src/canvas/agentCursor.ts';

const ev = (x?: number, y?: number, extra = {}) => ({ sid: 's1', name: 'Remy', role: 'impl', file: 'a.dpx.json', ...(x === undefined ? {} : { x, y }), ...extra });

test('ease-out: starts fast, lands softly, clamps', () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.equal(easeOut(2), 1);
  assert.ok(easeOut(0.5) > 0.5);
  assert.ok(easeOut(0.9) - easeOut(0.8) < easeOut(0.2) - easeOut(0.1));
});

test('first event places the cursor; the next glides there over MOVE_MS', () => {
  let m = applyCursor(new Map(), ev(100, 0), 0, false);
  const c0 = m.get('s1')!;
  assert.deepEqual(positionAt(c0, 0, false), { x: 100, y: 0 });
  m = applyCursor(m, ev(200, 100), 1000, false);
  const c = m.get('s1')!;
  assert.deepEqual(positionAt(c, 1000, false), { x: 100, y: 0 });
  const mid = positionAt(c, 1000 + MOVE_MS / 2, false);
  assert.ok(mid.x > 150 && mid.x < 200, `ease-out is past halfway at half time: ${mid.x}`);
  assert.deepEqual(positionAt(c, 1000 + MOVE_MS, false), { x: 200, y: 100 });
  assert.equal(moving(c, 1000 + 10, false), true);
  assert.equal(moving(c, 1000 + MOVE_MS, false), false);
});

test('reduced motion jumps instead of gliding', () => {
  let m = applyCursor(new Map(), ev(0, 0), 0, true);
  m = applyCursor(m, ev(300, 0), 10, true);
  assert.deepEqual(positionAt(m.get('s1')!, 11, true), { x: 300, y: 0 });
  assert.equal(moving(m.get('s1')!, 11, true), false);
});

test('a new place mid-glide starts from where the cursor is drawn, not where it was heading', () => {
  let m = applyCursor(new Map(), ev(0, 0), 0, false);
  m = applyCursor(m, ev(100, 0), 100, false);
  const drawn = positionAt(m.get('s1')!, 100 + MOVE_MS / 2, false);
  m = applyCursor(m, ev(500, 0), 100 + MOVE_MS / 2, false);
  assert.deepEqual(m.get('s1')!.from, drawn);
});

test('editing → thinking → fading → gone; an edit without a place keeps it alive where it is', () => {
  let m = applyCursor(new Map(), ev(10, 20), 0, false);
  const c = m.get('s1')!;
  assert.equal(phaseOf(c, THINK_MS - 1), 'editing');
  assert.equal(phaseOf(c, THINK_MS), 'thinking');
  assert.equal(phaseOf(c, FADE_AFTER_MS), 'fading');
  assert.equal(phaseOf(c, FADE_AFTER_MS + FADE_MS), 'gone');
  m = applyCursor(m, ev(), FADE_AFTER_MS - 1, false);
  const kept = m.get('s1')!;
  assert.equal(phaseOf(kept, FADE_AFTER_MS + 10), 'editing');
  assert.deepEqual(kept.to, { x: 10, y: 20 });
  assert.equal(pruneGone(m, FADE_AFTER_MS).size, 1);
  assert.equal(nextPhaseAt(c, 0), THINK_MS);
  assert.equal(nextPhaseAt(c, THINK_MS), FADE_AFTER_MS);
  assert.equal(nextPhaseAt(c, FADE_AFTER_MS + FADE_MS), Infinity);
  assert.equal(pruneGone(m, 2 * FADE_AFTER_MS + FADE_MS).size, 0);
});

test('gone removes; a placeless event for an unknown session shows nothing; another file starts in place', () => {
  const empty = new Map<string, Cursor>();
  assert.equal(applyCursor(empty, ev(), 0, false), empty);
  let m = applyCursor(empty, ev(0, 0), 0, false);
  m = applyCursor(m, ev(900, 900, { file: 'b.dpx.json' }), 10, false);
  assert.deepEqual(m.get('s1')!.from, { x: 900, y: 900 });
  assert.equal(applyCursor(m, { sid: 's1', gone: true }, 20, false).size, 0);
  assert.equal(applyCursor(m, { sid: 'other', gone: true }, 20, false), m);
});

test('toScreen follows Excalidraw scroll, zoom and offset', () => {
  const st = { scrollX: 10, scrollY: -20, zoom: { value: 2 }, offsetLeft: 100, offsetTop: 50 };
  assert.deepEqual(toScreen({ x: 0, y: 20 }, st, { left: 100, top: 40 }), { x: 20, y: 10 });
});
