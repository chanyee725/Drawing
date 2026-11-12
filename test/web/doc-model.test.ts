import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockItems, blocksAfterHistory, newBlockGeometry, docShapeProblem, embeddedBlockIds, filterSlash, migrateDocument, SLASH_ITEMS } from '../../web/src/doc/model.ts';

const blocks = [{ id: 'a', type: 'architecture' }, { id: 'b', type: 'sequence' }];

const EMPTY = { type: 'doc', content: [] };

test('an old file (version 1) with an empty document gets one embed per block', () => {
  assert.deepEqual(embeddedBlockIds(migrateDocument({ version: 1, document: EMPTY, blocks })), ['a', 'b']);
  assert.deepEqual(embeddedBlockIds(migrateDocument({ document: EMPTY, blocks })), ['a', 'b']);
});

test('embeds are filled in only once: a file saved by the document editor keeps its empty document', () => {
  assert.equal(migrateDocument({ version: 2, document: EMPTY, blocks }), EMPTY);
});

test('a written, block-less or broken document is never filled in', () => {
  const saved = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] };
  assert.equal(migrateDocument({ version: 1, document: saved, blocks }), saved);
  assert.equal(migrateDocument({ version: 1, document: EMPTY, blocks: [] }), EMPTY);
  const broken = { type: 'page', content: [] };
  assert.equal(migrateDocument({ version: 1, document: broken, blocks }), broken);
});

test('a document whose outer shape is wrong is reported', () => {
  assert.equal(docShapeProblem(EMPTY), null);
  assert.equal(docShapeProblem({ type: 'doc' }), null);
  assert.ok(docShapeProblem(null));
  assert.ok(docShapeProblem([]));
  assert.ok(docShapeProblem({ type: 'page', content: [] }));
  assert.ok(docShapeProblem({ type: 'doc', content: 'x' }));
});

test('embeds are found inside lists and tables, in order', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'diagram', attrs: { blockId: 'x' } },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'diagram', attrs: { blockId: 'y' } }] }] },
      { type: 'diagram', attrs: { blockId: null } },
    ],
  };
  assert.deepEqual(embeddedBlockIds(doc), ['x', 'y']);
  assert.deepEqual(embeddedBlockIds('nope'), []);
});

test('the / menu filters by Korean title or English keyword', () => {
  assert.equal(filterSlash(SLASH_ITEMS, '').length, SLASH_ITEMS.length);
  assert.deepEqual(filterSlash(SLASH_ITEMS, 'H2').map((i) => i.id), ['h2']);
  assert.deepEqual(filterSlash(SLASH_ITEMS, '체크').map((i) => i.id), ['task']);
  assert.ok(filterSlash(SLASH_ITEMS, '제목').length === 3);
  assert.deepEqual(filterSlash(SLASH_ITEMS, 'zzz'), []);
});

test('canvas diagrams become / menu entries that embed that block', () => {
  const items = blockItems(blocks, (t) => (t === 'sequence' ? '시퀀스' : t));
  assert.deepEqual(items.map((i) => [i.title, i.blockId]), [['다이어그램 넣기: architecture 1', 'a'], ['다이어그램 넣기: 시퀀스 2', 'b']]);
  assert.deepEqual(filterSlash(items, 'sequence').map((i) => i.blockId), ['b']);
});

test('links keep web and mail addresses, add https to bare hosts, refuse other schemes', async () => {
  const { normalizeLink } = await import('../../web/src/doc/model.ts');
  assert.equal(normalizeLink(' https://a.b/c '), 'https://a.b/c');
  assert.equal(normalizeLink('mailto:x@y.z'), 'mailto:x@y.z');
  assert.equal(normalizeLink('a.b/c'), 'https://a.b/c');
  assert.equal(normalizeLink('localhost:4330/x'), 'https://localhost:4330/x');
  assert.equal(normalizeLink('javascript:alert(1)'), null);
  assert.equal(normalizeLink('data:text/html,x'), null);
  assert.equal(normalizeLink(''), null);
  assert.equal(normalizeLink('a b'), null);
});

test('undo removes a block the document created with its embed; redo brings it back', () => {
  const nb = { id: 'n', type: 'architecture', code: 'x', x: 0, y: 0, w: 0, h: 0 };
  const old = { id: 'o', type: 'architecture', code: 'y', x: 0, y: 0, w: 10, h: 10 };
  const created = new Map([['n', nb]]);
  // The canvas placed it meanwhile; undo keeps that latest state.
  const placed = { ...nb, x: 5, w: 100, h: 50 };
  const afterUndo = blocksAfterHistory(['o', 'n'], ['o'], created, [old, placed]);
  assert.deepEqual(afterUndo, [old]);
  assert.deepEqual(blocksAfterHistory(['o'], ['o', 'n'], created, afterUndo!, true), [old, placed]);
  // Redo of an embed deleted by hand: the block stayed on the canvas then, and stays now.
  assert.equal(blocksAfterHistory(['o', 'n'], ['o'], created, [old, placed], true), null);
  // Blocks the document did not create stay when their embed goes; nothing to do returns null.
  assert.equal(blocksAfterHistory(['o', 'n'], ['n'], created, [old, placed]), null);
  // Another embed of the same block keeps it.
  assert.equal(blocksAfterHistory(['n', 'n'], ['n'], created, [placed]), null);
});

test('a diagram made in the document is placed clear of placed blocks and drawings', () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const placed = [{ x: 0, y: 0, w: 400, h: 200 }, { x: 0, y: 0, w: 0, h: 0 }];
  const canvas = { elements: [{ x: 500, y: 0, width: 300, height: 300 }, { x: 0, y: 0, width: 9999, height: 9999, isDeleted: true }, { bad: 1 }] };
  const g = newBlockGeometry({ width: 320, height: 160 }, placed, canvas);
  assert.equal(g.w, 320);
  assert.equal(g.h, 160);
  assert.ok(!overlap(g, placed[0]));
  assert.ok(!overlap(g, { x: 500, y: 0, w: 300, h: 300 }));
  // No size yet: left for the canvas to place.
  assert.deepEqual(newBlockGeometry(null, placed, canvas), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(newBlockGeometry({ width: 10, height: 10 }, [], null), { x: 0, y: 0, w: 10, h: 10 });
});
