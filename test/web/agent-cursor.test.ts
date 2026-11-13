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

test('the session colour rides on the cursor; only #rrggbb is taken, and a later event without one keeps it (#249)', () => {
  let m = applyCursor(new Map(), ev(0, 0, { color: '#0f766e' }), 0, false);
  assert.equal(m.get('s1')!.color, '#0f766e');
  m = applyCursor(m, ev(10, 0), 10, false);
  assert.equal(m.get('s1')!.color, '#0f766e');
  m = applyCursor(m, ev(undefined, undefined), 20, false);
  assert.equal(m.get('s1')!.color, '#0f766e');
  for (const bad of ['red', '#fff', 'url(x)', '#0f766e; x: y', 7]) {
    assert.equal(applyCursor(new Map(), ev(0, 0, { color: bad }), 0, false).get('s1')!.color, '', String(bad));
  }
});

test('the glide clock starts at the first frame the cursor is drawn, and a stalled frame does not use it up', async () => {
  const { shownCursor, lastDrawn, MAX_FRAME_MS } = await import('../../web/src/canvas/agentCursor.ts');
  let m = applyCursor(new Map(), ev(0, 0), 0, false);
  m = applyCursor(m, ev(0, 300), 1000, false);
  const c = m.get('s1')!;
  const clocks = new Map();
  // The canvas remounts: no frame for 500 ms, then hidden while it loads. The first visible frame is at 1600,
  // long after the event's own 220 ms: it still draws the start, not the target.
  assert.ok(1600 - 1000 > MOVE_MS);
  assert.deepEqual(positionAt(shownCursor(clocks, c, 1600), 1600, false), { x: 0, y: 0 });
  assert.equal(moving(shownCursor(clocks, c, 1600), 1600, false), true);
  // Normal frames after that glide through the middle.
  const mid = positionAt(shownCursor(clocks, c, 1616), 1616, false);
  assert.ok(mid.y > 0 && mid.y < 300, `mid-glide: ${mid.y}`);
  // A 400 ms stall counts as one MAX_FRAME_MS step: still in the middle.
  const after = positionAt(shownCursor(clocks, c, 2016), 2016, false);
  assert.ok(after.y > mid.y && after.y < 300, `slowed, not skipped: ${after.y}`);
  // A new place glides on from where it was last drawn, not from the event clock's end.
  assert.ok(Math.abs(positionAt(lastDrawn(clocks, c, 2020), 2020, false).y - after.y) < 1e-9);
  // Enough frames finish it.
  let t = 2016;
  let k = shownCursor(clocks, c, t);
  while (moving(k, t, false)) k = shownCursor(clocks, c, (t += 16));
  assert.deepEqual(positionAt(k, t, false), { x: 0, y: 300 });
  assert.ok(t - 2016 <= MOVE_MS - 16 - MAX_FRAME_MS + 16, `the rest of the glide in normal frames: ${t - 2016}`);
});

test('a glide first drawn long after it started (file not open then) is not replayed', async () => {
  const { shownCursor, STALE_GLIDE_MS } = await import('../../web/src/canvas/agentCursor.ts');
  let m = applyCursor(new Map(), ev(0, 0), 0, false);
  m = applyCursor(m, ev(0, 300), 1000, false);
  const t = 1000 + STALE_GLIDE_MS + 1;
  const k = shownCursor(new Map(), m.get('s1')!, t);
  assert.deepEqual(positionAt(k, t, false), { x: 0, y: 300 });
  assert.equal(moving(k, t, false), false);
});

test('an event without a place after a landed glide does not restart the glide (#254)', async () => {
  const { applyCursorDrawn, shownCursor } = await import('../../web/src/canvas/agentCursor.ts');
  const clocks = new Map();
  let m = applyCursorDrawn(new Map(), clocks, ev(0, 0), 0, false);
  m = applyCursorDrawn(m, clocks, ev(0, 300), 1000, false);
  // Frames draw the glide until it lands at (0,300).
  let t = 1000;
  let k = shownCursor(clocks, m.get('s1')!, t);
  while (moving(k, t, false)) k = shownCursor(clocks, m.get('s1')!, (t += 16));
  assert.deepEqual(positionAt(k, t, false), { x: 0, y: 300 });
  // "Still editing", no place: the cursor stays, and the next frame does not jump back to the glide's start.
  const before = m.get('s1')!;
  m = applyCursorDrawn(m, clocks, ev(), t + 10, false);
  assert.equal(m.get('s1')!.moveAt, before.moveAt);
  assert.equal(m.get('s1')!.editAt, t + 10);
  const next = shownCursor(clocks, m.get('s1')!, t + 16);
  assert.deepEqual(positionAt(next, t + 16, false), { x: 0, y: 300 });
  // A new place still glides on from where it was drawn.
  m = applyCursorDrawn(m, clocks, ev(0, 600), t + 20, false);
  assert.deepEqual(m.get('s1')!.from, { x: 0, y: 300 });
});
