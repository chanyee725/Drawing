import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SCALE, MIN_SCALE, baseFileId, exportVariants, pictureScale, scaleSvg, variantId } from '../../web/src/canvas/resolution.ts';
import { placeBlocks, type Rect } from '../../web/src/canvas/sync.ts';

test('pictureScale picks the power of two at or above the pixels per unit', () => {
  assert.equal(pictureScale(1, 900, 400), 1);
  assert.equal(pictureScale(1.25, 900, 400), 2);
  assert.equal(pictureScale(2, 900, 400), 2);
  assert.equal(pictureScale(2.01, 900, 400), MAX_SCALE, 'capped at 2x to keep memory down');
  assert.equal(pictureScale(0.6, 900, 400), 1);
  assert.equal(pictureScale(0.3, 900, 400), 0.5);
  // The shown size is never more than 2x below the variant: thin strokes are not skipped.
  for (const f of [0.13, 0.4, 0.75, 1, 1.5, 1.9]) {
    const k = pictureScale(f, 300, 200);
    assert.ok(k >= f && k / f < 2, `factor ${f} → ${k}`);
  }
});

test('pictureScale stays within its limits and the bitmap area cap', () => {
  assert.equal(pictureScale(50, 100, 100), MAX_SCALE);
  assert.equal(pictureScale(0.001, 100, 100), MIN_SCALE);
  assert.equal(pictureScale(Number.NaN, 100, 100), 1);
  assert.equal(pictureScale(0, 100, 100), 1);
  assert.equal(MAX_SCALE, 2);
  // A big picture gets a smaller variant so its bitmap stays under ~4M pixels.
  const k = pictureScale(2, 3000, 2000);
  assert.ok(3000 * 2000 * k * k <= 4_194_304, `k=${k}`);
});

test('variant ids keep the picture id and come back to it', () => {
  assert.equal(variantId('blk_a_1', 1), 'blk_a_1');
  assert.equal(variantId('blk_a_1', 2), 'blk_a_1--k2');
  assert.equal(variantId('blk_a_1', 0.5), 'blk_a_1--k0p5');
  // Usable in a CSS id selector (Excalidraw's SVG export looks images up that way).
  assert.match(variantId('blk_a_1', 0.125), /^[A-Za-z0-9_-]+$/);
  assert.equal(baseFileId('blk_a_1--k2'), 'blk_a_1');
  assert.equal(baseFileId('blk_a_1'), 'blk_a_1');
  // Only a trailing variant suffix is dropped: an id may contain "--k" itself.
  assert.equal(baseFileId('step--kafka'), 'step--kafka');
  assert.equal(baseFileId('step--kafka--k0p5'), 'step--kafka');
});

test('scaleSvg multiplies only the root size, not the drawing', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120.5" height="80" viewBox="0 0 120.5 80" font-family="x"><rect width="10" height="10" stroke-width="2"/></svg>';
  const out = scaleSvg(svg, 2);
  assert.match(out, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="241" height="160" viewBox="0 0 120.5 80"/);
  assert.ok(out.endsWith('<rect width="10" height="10" stroke-width="2"/></svg>'));
  assert.equal(scaleSvg(svg, 1), svg);
});

test('placeBlocks keeps new blocks clear of placed ones at their drawn height', () => {
  // A placed block saved with a stale height of 100, whose picture now makes it 300 tall at its width.
  const placed = { id: 'a', x: 0, y: 0, w: 200, h: 100 };
  const fresh = { id: 'b', x: 0, y: 0, w: 0, h: 0 };
  const fresh2 = { id: 'c', x: 0, y: 0, w: 0, h: 0 };
  // The unplaced blocks come first in the list: placed ones must still be counted before them.
  const out = placeBlocks([fresh, fresh2, placed], [{ width: 150, height: 120 }, { width: 150, height: 120 }, { width: 100, height: 150 }], []);
  const rects: Rect[] = out.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  assert.deepEqual(rects[2], { x: 0, y: 0, w: 200, h: 300 });
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const [p, q] = [rects[i]!, rects[j]!];
      const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      assert.ok(!overlap, `${out[i]!.id} overlaps ${out[j]!.id}: ${JSON.stringify(rects)}`);
    }
});

test('a PNG export uses the picture variant for its own scale, not the zoomed-out view', () => {
  const pic = { fileId: 'blk_a_1', width: 900, height: 400 };
  const pictureOf = (id: string) => (id === pic.fileId ? pic : undefined);
  // Seen zoomed far out: the canvas shows the 1/8 variant.
  const shown = [
    { id: 'i1', type: 'image', fileId: variantId('blk_a_1', 0.125), width: 900, height: 400 },
    { id: 'r1', type: 'rectangle', width: 10, height: 10 },
    { id: 'i2', type: 'image', fileId: 'other', width: 50, height: 50 },
  ];
  const at1 = exportVariants(shown, 1, pictureOf);
  assert.equal(at1.elements[0]!.fileId, 'blk_a_1');
  assert.deepEqual(at1.need, [{ picture: pic, k: 1 }]);
  assert.equal(at1.elements[1], shown[1]);
  assert.equal(at1.elements[2], shown[2]);
  const at2 = exportVariants(shown, 2, pictureOf);
  assert.equal(at2.elements[0]!.fileId, 'blk_a_1--k2');
  assert.deepEqual(at2.need, [{ picture: pic, k: 2 }]);
  // The scene itself is not changed.
  assert.equal(shown[0]!.fileId, 'blk_a_1--k0p125');
  // A block drawn at half its picture size, exported at 2x, needs the 1x picture.
  assert.equal(exportVariants([{ type: 'image', fileId: 'blk_a_1--k4', width: 450, height: 200 }], 2, pictureOf).elements[0]!.fileId, 'blk_a_1');
});
