import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RefitQueue } from '../../web/src/canvas/refitQueue.ts';
import type { FitEl } from '../../web/src/canvas/refit.ts';

type El = FitEl & { version: number };
const text = (id: string, width = 3): El => ({ id, type: 'text', x: 0, y: 0, width, height: 25, version: 5 });
/** A stand-in for Excalidraw's measuring in the clean font: every text becomes 80 wide. */
const measure = (els: El[]) => els.map((e) => (e.type === 'text' ? { ...e, width: 80 } : e));

/** A queue whose font loads when the test says so. */
function queue() {
  let loaded = false;
  const q = new RefitQueue(() => loaded);
  return { q, load: () => (loaded = true) };
}

test('texts measured after the clean font loaded do not wait', () => {
  const { q, load } = queue();
  load();
  q.wait(['a']);
  assert.equal(q.size, 0);
});

test('texts wait until the font loads, then are measured once', () => {
  const { q, load } = queue();
  q.wait(['a']);
  assert.deepEqual(q.waiting(), ['a']);
  assert.equal(q.take([text('a')], measure), null, 'font not loaded: nothing happens');
  assert.deepEqual(q.waiting(), ['a'], 'and the text still waits');
  load();
  const out = q.take([text('a'), text('b')], measure)!;
  assert.equal(out.changed, true);
  assert.equal(out.elements[0].width, 80);
  assert.equal(out.elements[1].width, 3, 'a text that was not waiting is left alone');
  assert.equal(q.size, 0);
  assert.equal(q.take([text('a')], measure), null, 'nothing left to do');
});

test('the font loading before the texts are in the scene does not lose them (#305)', () => {
  // Opening a file: the texts are measured before the font loads, the font loads (loadingdone) and the
  // canvas runs the queue while its scene is still empty; the texts enter the scene afterwards.
  const { q, load } = queue();
  q.wait(['a', 'b']);
  load();
  assert.equal(q.take(null, measure), null, 'no canvas yet');
  assert.equal(q.take([], measure), null, 'an empty scene');
  assert.deepEqual(q.waiting().sort(), ['a', 'b'], 'the texts still wait');
  // The scene gets its texts (the next onChange): they are measured then.
  const out = q.take([text('a')], measure)!;
  assert.equal(out.elements[0].width, 80);
  assert.deepEqual(q.waiting(), ['b'], 'a text not in the scene yet keeps waiting');
  q.take([text('a', 80), text('b')], measure);
  assert.equal(q.size, 0);
});

test('a measured text keeps its version: the new size is saved with the next edit', () => {
  const { q, load } = queue();
  q.wait(['a']);
  load();
  const out = q.take([text('a')], measure)!;
  assert.equal(out.elements[0].width, 80);
  assert.equal((out.elements[0] as El).version, 5);
});

test('a deleted text stops waiting', () => {
  const { q, load } = queue();
  q.wait(['a']);
  load();
  const out = q.take([{ ...text('a'), isDeleted: true }], measure)!;
  assert.equal(out.changed, false);
  assert.equal(q.size, 0);
});

test('clear drops every waiting text', () => {
  const { q } = queue();
  q.wait(['a', 'b']);
  q.clear();
  assert.equal(q.size, 0);
});

test('a pasted text that waited is measured as a new version; an opened one keeps its version', () => {
  const { q, load } = queue();
  q.wait(['open']);
  q.wait(['paste'], true);
  load();
  const bumped = (e: El, patch: Partial<FitEl>): El => ({ ...e, ...patch, version: e.version + 1 });
  const out = q.take([text('open'), text('paste')], measure, bumped)!;
  const [open, paste] = out.elements as El[];
  assert.equal(open.width, 80);
  assert.equal(open.version, 5, 'opening writes nothing');
  assert.equal(paste.width, 80);
  assert.equal(paste.version, 6, 'the paste is saved with its new size');
});

test('a text queued as opened and then pasted is bumped', () => {
  const { q, load } = queue();
  q.wait(['a'], true);
  q.wait(['a']);
  q.wait(['b']);
  q.wait(['b'], true);
  load();
  const bumped = (e: El, patch: Partial<FitEl>): El => ({ ...e, ...patch, version: e.version + 1 });
  const out = q.take([text('a'), text('b')], measure, bumped)!;
  assert.deepEqual((out.elements as El[]).map((e) => e.version), [6, 6]);
});
