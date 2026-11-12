import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, fitTransform, graphToScreen, screenToGraph, unionRects, zoomAt } from '../web/src/view/diff.ts';
import { applyFileEvent, pickFile, sourcesFor } from '../web/src/data/files.ts';

const cell = (id, extra = {}) => ({ id, parent: '1', value: '', style: '', geo: '0,0,10,10,0,', source: '', target: '', ...extra });

test('diffSnapshots sorts cells into added, removed and changed', () => {
  const prev = new Map([['a', cell('a')], ['b', cell('b')], ['c', cell('c')], ['d', cell('d')]]);
  const next = new Map([
    ['a', cell('a')],
    ['b', cell('b', { geo: '5,0,10,10,0,' })],
    ['c', cell('c', { value: 'hi' })],
    ['e', cell('e')],
  ]);
  assert.deepEqual(diffSnapshots(prev, next), { added: ['e'], removed: ['d'], changed: ['b', 'c'] });
});

test('graph/screen transforms round-trip and zoomAt keeps the anchor point', () => {
  const v = { scale: 2, tx: 10, ty: -5 };
  const r = { x: 3, y: 4, width: 5, height: 6 };
  assert.deepEqual(screenToGraph(graphToScreen(r, v), v), r);
  const z = zoomAt(v, 1.5, 100, 80);
  const before = screenToGraph({ x: 100, y: 80, width: 0, height: 0 }, v);
  const after = screenToGraph({ x: 100, y: 80, width: 0, height: 0 }, z);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(zoomAt(v, 100, 0, 0).scale, 8);
});

test('fitTransform centres the bounds inside the viewport', () => {
  const t = fitTransform({ x: 100, y: 100, width: 200, height: 100 }, 448, 448, 24, 10);
  const s = graphToScreen({ x: 100, y: 100, width: 200, height: 100 }, t);
  assert.ok(Math.abs(s.x - 24) < 1e-9);
  assert.ok(Math.abs(s.x + s.width - 424) < 1e-9);
  assert.ok(Math.abs(s.y + s.height / 2 - 224) < 1e-9);
});

test('unionRects', () => {
  assert.equal(unionRects([]), null);
  assert.deepEqual(unionRects([{ x: 0, y: 0, width: 1, height: 1 }, { x: 5, y: -2, width: 1, height: 1 }]), { x: 0, y: -2, width: 6, height: 3 });
});

test('file events upsert, delete, and selection falls back to the same path', () => {
  const main = { id: 'm', path: 'a.drawio', source: { kind: 'main', label: 'main' }, pages: [] };
  const wt = { id: 'w', path: 'a.drawio', source: { kind: 'worktree', label: 'impl-2' }, pages: [] };
  let list = applyFileEvent([], wt);
  list = applyFileEvent(list, main);
  assert.deepEqual(list.map((f) => f.id), ['m', 'w']);
  assert.deepEqual(sourcesFor(list, 'a.drawio').map((f) => f.id), ['m', 'w']);
  list = applyFileEvent(list, { ...wt, deleted: true });
  assert.deepEqual(list.map((f) => f.id), ['m']);
  assert.equal(pickFile(list, 'w', 'a.drawio')?.id, 'm');
  assert.equal(pickFile([], 'w', 'a.drawio'), null);
});
