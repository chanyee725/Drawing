import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockItems, embeddedBlockIds, filterSlash, initialDocument, SLASH_ITEMS } from '../../web/src/doc/model.ts';

const blocks = [{ id: 'a', type: 'architecture' }, { id: 'b', type: 'sequence' }];

test('an empty document of a file with blocks opens with one embed per block', () => {
  const doc = initialDocument({ type: 'doc', content: [] }, blocks);
  assert.deepEqual(embeddedBlockIds(doc), ['a', 'b']);
});

test('a written document opens as saved, even when it embeds no block', () => {
  const saved = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] };
  assert.equal(initialDocument(saved, blocks), saved);
});

test('a missing or broken document opens empty', () => {
  assert.deepEqual(initialDocument(null, []), { type: 'doc', content: [] });
  assert.deepEqual(initialDocument({ nope: 1 }, []), { type: 'doc', content: [] });
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
