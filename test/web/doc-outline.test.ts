import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { buildHash, fileItems, figureItems, filterWiki, headingItems, headingsNeedingId, outlineOf, parseHash } from '../../web/src/doc/outline.ts';
import { docExtensions, withHeadingIds } from '../../web/src/doc/extensions.ts';
import { documentToMarkdown } from '../../web/src/export/markdown.ts';

const h = (level: number, text: string, id?: string) => ({ type: 'heading', attrs: { level, ...(id ? { id } : {}) }, content: [{ type: 'text', text }] });

test('the outline lists headings in order, with their ids and levels', () => {
  const doc = { type: 'doc', content: [h(1, 'A', 'h_a'), { type: 'paragraph' }, { type: 'blockquote', content: [h(2, 'B')] }, h(3, 'C', 'h_c')] };
  assert.deepEqual(outlineOf(doc), [
    { id: 'h_a', level: 1, text: 'A' },
    { id: null, level: 2, text: 'B' },
    { id: 'h_c', level: 3, text: 'C' },
  ]);
  assert.deepEqual(outlineOf(null), []);
  assert.deepEqual(outlineOf({ type: 'doc' }), []);
});

test('headings without an id, or repeating one, need a new id', () => {
  assert.deepEqual(headingsNeedingId(['a', null, 'a', 'b']), [1, 2]);
  assert.deepEqual(headingsNeedingId([]), []);
});

test('file hash: path and heading round-trip, other hashes are not file links', () => {
  assert.deepEqual(parseHash(buildHash('a b/c&d.dpx.json')), { path: 'a b/c&d.dpx.json', heading: null });
  assert.deepEqual(parseHash(buildHash('x.dpx.json', 'h_1')), { path: 'x.dpx.json', heading: 'h_1' });
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#other'), null);
  assert.equal(parseHash('#file=%E0%A4%A'), null);
});

test('wikilink items cover files, headings with an id, and diagrams; the query filters them', () => {
  const tree = [{ type: 'folder', name: 'd', path: 'd', children: [{ type: 'file', name: 'a.dpx.json', path: 'd/a.dpx.json', title: '설계', revision: 1 }] }] as never;
  const files = fileItems(tree);
  assert.deepEqual(files.map((f) => [f.kind, f.target, f.title]), [['file', 'd/a.dpx.json', '설계']]);
  const heads = headingItems([{ id: 'h_1', level: 1, text: '개요' }, { id: null, level: 2, text: 'x' }]);
  assert.deepEqual(heads.map((f) => f.target), ['h_1']);
  const figs = figureItems([{ id: 'b1', type: 'sequence' }], (t) => t);
  assert.equal(figs[0].target, 'b1');
  const all = [...files, ...heads, ...figs];
  assert.deepEqual(filterWiki(all, '개요').map((i) => i.kind), ['heading']);
  assert.equal(filterWiki(all, '').length, 3);
});

test('headings get unique ids in the editor, and stored ids are kept', () => {
  const schema = getSchema(docExtensions());
  const doc = PMNode.fromJSON(schema, { type: 'doc', content: [h(1, 'A', 'h_a'), h(2, 'B'), h(2, 'C', 'h_a')] });
  const tr = withHeadingIds(EditorState.create({ doc }).tr);
  assert.ok(tr);
  const ids = outlineOf(tr.doc.toJSON()).map((x) => x.id);
  assert.equal(ids[0], 'h_a');
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every(Boolean));
  assert.equal(withHeadingIds(EditorState.create({ doc: tr.doc }).tr), null);
});

test('a wikilink fits the schema and exports as [[label]]', () => {
  const schema = getSchema(docExtensions());
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see ' }, { type: 'wikilink', attrs: { kind: 'file', target: 'a.dpx.json', label: '설계' } }] }] };
  PMNode.fromJSON(schema, doc).check();
  assert.match(documentToMarkdown('T', doc, []), /see \[\[설계\]\]/);
});

