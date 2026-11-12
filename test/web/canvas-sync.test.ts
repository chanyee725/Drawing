import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyScene, blockIdOf, blockImageSkeleton, fileIdFor, findCopies, findFreeSpot, fitHeight, freeSignature, isUnplaced, rectOf, splitScene, type Rect, type SceneEl } from '../../web/src/canvas/sync.ts';

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

test('findCopies keeps the known image as owner and reports the others', () => {
  const owners = new Map<string, string>();
  assert.deepEqual(findCopies([img('a', 0), rect('r1')], owners), []);
  assert.equal(owners.get('a'), 'blk_a');
  const copy = img('a', 300, { id: 'copy1' });
  assert.deepEqual(findCopies([copy, img('a', 0), img('b', 0)], owners), [{ id: 'copy1', blockId: 'a' }]);
  assert.equal(owners.get('a'), 'blk_a');
});

test('findCopies ignores deleted images and hands ownership to a live one', () => {
  const owners = new Map([['a', 'blk_a']]);
  assert.deepEqual(findCopies([img('a', 0, { isDeleted: true }), img('a', 5, { id: 'pasted' })], owners), []);
  assert.equal(owners.get('a'), 'pasted');
});

const L1 = { v: 1, basis: { type: 'flowchart', direction: 'right', count: 2 }, items: { A: { cx: 1, cy: 2, parent: '' } } };
const L2 = { v: 1, basis: { type: 'flowchart', direction: 'right', count: 2 }, items: { A: { cx: 9, cy: 2, parent: '' } } };

test('layout is part of the picture identity but not of where the block sits', async () => {
  const { sameDrawing, layoutSig } = await import('../../web/src/canvas/sync.ts');
  const a = { ...block('a'), layout: L1 };
  assert.notEqual(fileIdFor(a, 'light'), fileIdFor({ ...a, layout: L2 }, 'light'));
  assert.notEqual(fileIdFor(a, 'light'), fileIdFor(block('a'), 'light'));
  assert.equal(fileIdFor(a, 'light'), fileIdFor({ ...a, layout: JSON.parse(layoutSig(L1)) }, 'light'));
  assert.equal(sameDrawing([a], [{ ...a, x: 50 }]), true);
  assert.equal(sameDrawing([a], [{ ...a, layout: L2 }]), false);
  assert.equal(sameDrawing([a], [{ ...a, layout: JSON.parse(layoutSig(L1)) }]), true);
});

test('the image carries the layout and applyScene takes it back, only when the image changed', async () => {
  const { layoutsFromImages } = await import('../../web/src/canvas/sync.ts');
  const b = { ...block('a'), layout: L1 };
  assert.deepEqual((blockImageSkeleton(b, 'f', 'e').customData as { layout?: unknown }).layout, L1);
  assert.equal('layout' in blockImageSkeleton(block('a'), 'f', 'e').customData, false);
  const seen = new Map([['a', JSON.stringify(L1)]]);
  // The image still shows the old layout while the block moved on (a code-panel cleanup): the block wins.
  const lagging = splitScene([img('a', 0, { customData: { blockId: 'a', layout: L1 } })]);
  const cleaned = { ...b, layout: undefined };
  const list = [cleaned];
  const none = layoutsFromImages(lagging.layouts, seen);
  assert.equal(none.size, 0);
  assert.equal(applyScene(list, lagging, none), list);
  // The image's layout changed (an edit or its undo): the block follows.
  const moved = splitScene([img('a', 0, { customData: { blockId: 'a', layout: L2 } })]);
  const out = applyScene([b], moved, layoutsFromImages(moved.layouts, seen));
  assert.deepEqual(out[0]!.layout, L2);
  // An image without a layout clears it.
  const bare = splitScene([img('a', 0)]);
  const cleared = applyScene([{ ...b, layout: L2 }], bare, layoutsFromImages(bare.layouts, seen));
  assert.equal('layout' in cleared[0]!, false);
  // A junk customData.layout counts as none.
  assert.equal(splitScene([img('a', 0, { customData: { blockId: 'a', layout: 'x' } })]).layouts.get('a'), undefined);
});

test('shiftForOrigin keeps the layout origin still on screen, scaled like the picture', async () => {
  const { shiftForOrigin } = await import('../../web/src/canvas/sync.ts');
  const el = { x: 100, y: 50, width: 400 };
  // Picture 200 wide shown at 400: scale 2. The origin moved from (10,10) to (30,0): shift (-40, +20).
  assert.deepEqual(shiftForOrigin(el, { width: 200, origin: { x: 10, y: 10 } }, { x: 30, y: 0 }), { x: 60, y: 70 });
  assert.deepEqual(shiftForOrigin(el, { width: 200 }, { x: 30, y: 0 }), { x: 100, y: 50 });
  assert.deepEqual(shiftForOrigin(el, undefined, { x: 30, y: 0 }), { x: 100, y: 50 });
});
