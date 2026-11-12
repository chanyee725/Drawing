import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyScene, blockIdOf, blockImageSkeleton, fileIdFor, findFreeSpot, fitHeight, freeSignature, isUnplaced, rectOf, splitScene, type Rect, type SceneEl } from '../../web/src/canvas/sync.ts';

const block = (id: string, x = 0) => ({ id, type: 'flowchart', code: 'A > B', x, y: 0, w: 200, h: 100 });
const img = (id: string, x: number, extra: Partial<SceneEl> = {}): SceneEl => ({ id: `blk_${id}`, type: 'image', x, y: 0, width: 200, height: 100, customData: { blockId: id }, ...extra });
const rect = (id: string, extra: Partial<SceneEl> = {}): SceneEl => ({ id, type: 'rectangle', x: 1, y: 2, width: 3, height: 4, version: 1, ...extra });

test('splitScene keeps free elements and drops deleted ones', () => {
  const s = splitScene([rect('r1'), rect('r2', { isDeleted: true }), img('a', 10)]);
  assert.deepEqual(s.free.map((e) => e.id), ['r1']);
  assert.deepEqual(s.geometry.get('a'), { x: 10, y: 0, w: 200, h: 100 });
  assert.equal(s.deleted.size, 0);
});

test('applyScene returns the same array when nothing moved', () => {
  const blocks = [block('a'), block('b', 300)];
  const s = splitScene([img('a', 0), img('b', 300)]);
  assert.equal(applyScene(blocks, s), blocks);
});

test('applyScene copies moves and resizes back into blocks', () => {
  const blocks = [block('a'), block('b')];
  const out = applyScene(blocks, splitScene([img('a', 42.123, { width: 400, height: 210 }), img('b', 0)]));
  assert.notEqual(out, blocks);
  assert.deepEqual(out[0], { ...blocks[0], x: 42.12, w: 400, h: 210 });
  assert.equal(out[1], blocks[1]);
});

test('applyScene removes blocks deleted on the canvas', () => {
  const blocks = [block('a'), block('b')];
  const out = applyScene(blocks, splitScene([img('a', 0, { isDeleted: true }), img('b', 0)]));
  assert.deepEqual(out.map((b) => b.id), ['b']);
});

test('a live copy wins over a deleted copy of the same block', () => {
  const s = splitScene([img('a', 0, { isDeleted: true }), img('a', 5)]);
  assert.equal(s.deleted.has('a'), false);
  assert.equal(s.geometry.get('a')?.x, 5);
});

test('blocks with no image on the canvas are left alone', () => {
  const blocks = [block('a')];
  assert.equal(applyScene(blocks, splitScene([])), blocks);
});

test('fileIdFor changes with code, type and theme only', () => {
  const b = block('a');
  assert.equal(fileIdFor(b, 'light'), fileIdFor({ ...b, x: 99 }, 'light'));
  assert.notEqual(fileIdFor(b, 'light'), fileIdFor({ ...b, code: 'A > C' }, 'light'));
  assert.notEqual(fileIdFor(b, 'light'), fileIdFor({ ...b, type: 'architecture' }, 'light'));
  assert.notEqual(fileIdFor(b, 'light'), fileIdFor(b, 'dark'));
});

test('freeSignature ignores everything but ids and versions', () => {
  assert.equal(freeSignature([rect('r1')]), freeSignature([rect('r1', { x: 100 })]));
  assert.notEqual(freeSignature([rect('r1')]), freeSignature([rect('r1', { version: 2 })]));
});

test('blockImageSkeleton links the image to its block', () => {
  const el = blockImageSkeleton(block('a', 7), 'f1', 'e1');
  assert.equal(blockIdOf(el), 'a');
  assert.equal(el.fileId, 'f1');
  assert.equal(el.id, 'e1');
  assert.deepEqual([el.x, el.width, el.height], [7, 200, 100]);
});

test('fitHeight keeps the picture aspect ratio', () => {
  assert.equal(fitHeight(400, 200, 100), 200);
  assert.equal(fitHeight(400, 0, 0), 400);
});

test('isUnplaced flags new blocks and the old 640x400 placeholder only', () => {
  assert.equal(isUnplaced({ x: 0, y: 0, w: 0, h: 0 }), true);
  assert.equal(isUnplaced({ x: 80, y: 80, w: 640, h: 400 }), true);
  assert.equal(isUnplaced({ x: 0, y: 0, w: 200, h: 100 }), false);
  assert.equal(isUnplaced({ x: 0, y: 0, w: 640, h: 401 }), false);
});

test('findFreeSpot starts at the origin on an empty canvas', () => {
  assert.deepEqual(findFreeSpot(100, 50, []), { x: 0, y: 0 });
});

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('findFreeSpot never overlaps what is already there', () => {
  const taken: Rect[] = [];
  const sizes = [
    [300, 600],
    [120, 80],
    [500, 200],
    [90, 1300],
    [200, 200],
    [640, 100],
  ];
  for (const [w, h] of sizes) {
    const p = findFreeSpot(w, h, taken);
    const r = { ...p, w, h };
    for (const t of taken) assert.equal(hit(r, t), false, `${JSON.stringify(r)} overlaps ${JSON.stringify(t)}`);
    taken.push(r);
  }
});

test('findFreeSpot fills a gap next to existing content before going far away', () => {
  const p = findFreeSpot(100, 100, [{ x: 0, y: 0, w: 200, h: 200 }]);
  assert.deepEqual(p, { x: 240, y: 0 });
});

test('rectOf normalizes negative line sizes', () => {
  assert.deepEqual(rectOf({ x: 10, y: 10, width: -5, height: 20 }), { x: 5, y: 10, w: 5, h: 20 });
});
