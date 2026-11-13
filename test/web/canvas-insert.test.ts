import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEAN_FONT_SIZE, CLEAN_LINE_HEIGHT } from '../../web/src/canvas/cleanStyle.ts';
import { INSERT_ITEMS, INSERT_TEXT, TEXT_OFFSET, centeredAt, diagramBlock, filterInsert, shapeSkeleton, SHAPE_SIZE } from '../../web/src/canvas/insert.ts';
import { DIAGRAM_TYPES, TEMPLATES } from '../../web/src/dsl/templates.ts';

test('the menu offers every diagram type first, then shapes, text and frame', () => {
  const ids = INSERT_ITEMS.map((i) => i.id);
  assert.deepEqual(ids.slice(0, DIAGRAM_TYPES.length), DIAGRAM_TYPES.map((t) => `diagram:${t.id}`));
  for (const k of ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'frame']) assert.ok(ids.includes(k), k);
  assert.equal(new Set(ids).size, ids.length);
});

test('typing filters by title or keyword, in Korean or English', () => {
  assert.equal(filterInsert('').length, INSERT_ITEMS.length);
  assert.deepEqual(filterInsert('erd').map((i) => i.id), ['diagram:erd']);
  assert.deepEqual(filterInsert('aws').map((i) => i.id), ['diagram:architecture']);
  assert.deepEqual(filterInsert('네모').map((i) => i.id), ['rectangle']);
  assert.deepEqual(filterInsert('TEXT').map((i) => i.id), ['text']);
  assert.equal(filterInsert('다이어그램').length, DIAGRAM_TYPES.length);
  assert.deepEqual(filterInsert('zzz'), []);
});

test('shapes are centred on the given point', () => {
  assert.deepEqual(centeredAt({ x: 100, y: 50 }, 40, 20), { x: 80, y: 40 });
  const r = shapeSkeleton('rectangle', { x: 0, y: 0 });
  assert.deepEqual(r, { type: 'rectangle', x: -80, y: -40, ...SHAPE_SIZE.rectangle });
  const a = shapeSkeleton('arrow', { x: 0, y: 0 });
  assert.equal(a.type, 'arrow');
  assert.deepEqual(a.points, [[0, 0], [200, 0]]);
  assert.equal(shapeSkeleton('text', { x: 0, y: 0 }).text, '텍스트');
  const f = shapeSkeleton('frame', { x: 0, y: 0 });
  assert.deepEqual(f.children, []);
  assert.equal(f.name, '프레임');
});

test('a diagram block starts from its example, centred on the point at its picture size', () => {
  const b = diagramBlock('b1', 'erd', { x: 500, y: 300 }, { width: 200.4, height: 100 });
  assert.deepEqual(b, { id: 'b1', type: 'erd', code: TEMPLATES.erd, x: 400, y: 250, w: 200, h: 100 });
  // No picture size yet: unplaced, the canvas finds it a spot.
  assert.deepEqual(diagramBlock('b2', 'flowchart', { x: 1, y: 1 }, null), { id: 'b2', type: 'flowchart', code: TEMPLATES.flowchart, x: 0, y: 0, w: 0, h: 0 });
});

test('menu text starts so that one 13px line of it is centred on the point', () => {
  const sk = shapeSkeleton('text', { x: 500, y: 300 });
  assert.equal(sk.text, INSERT_TEXT);
  const h = CLEAN_FONT_SIZE * CLEAN_LINE_HEIGHT;
  assert.ok(Math.abs((sk.y as number) + h / 2 - 300) <= 0.5, `y ${sk.y}, line ${h}`);
  const w = INSERT_TEXT.length * CLEAN_FONT_SIZE; // Hangul is about 1em per syllable
  assert.ok(Math.abs((sk.x as number) + w / 2 - 500) <= 0.5, `x ${sk.x}, width ${w}`);
  assert.deepEqual(TEXT_OFFSET, { x: 20, y: 7 });
});
