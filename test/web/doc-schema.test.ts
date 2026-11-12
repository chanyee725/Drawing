import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { docExtensions } from '../../web/src/doc/extensions.ts';
import { embeddedBlockIds, initialDocument } from '../../web/src/doc/model.ts';

const schema = getSchema(docExtensions());
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: 'paragraph', content: c });
const cell = (type: string, t: string) => ({ type, content: [p(text(t))] });

// What the editor saves for a document with every supported kind of block.
const SAMPLE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('설계')] },
    { type: 'heading', attrs: { level: 3 }, content: [text('작은 제목')] },
    p(text('주소 '), text('example', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('하나'))] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p(text('첫째'))] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('끝'))] }] },
    { type: 'codeBlock', attrs: { language: null }, content: [text('const a = 1;')] },
    { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'h')] }, { type: 'tableRow', content: [cell('tableCell', 'c')] }] },
    { type: 'diagram', attrs: { blockId: 'b_1' } },
  ],
};

test('a document with headings, lists, a checklist, code, a table, a link and a diagram fits the schema', () => {
  const node = PMNode.fromJSON(schema, SAMPLE);
  node.check();
  // Round trip: what the editor writes back equals what was saved.
  const back = node.toJSON();
  assert.deepEqual(embeddedBlockIds(back), ['b_1']);
  assert.equal(back.content[0].attrs.level, 1);
  assert.equal(back.content[6].type, 'codeBlock');
  assert.equal(back.content[8].attrs.blockId, 'b_1');
});

test('the migrated document of an old file fits the schema', () => {
  PMNode.fromJSON(schema, initialDocument({ type: 'doc', content: [] }, [{ id: 'a' }, { id: 'b' }])).check();
});

test('unknown node types are rejected', () => {
  assert.throws(() => PMNode.fromJSON(schema, { type: 'doc', content: [{ type: 'nope' }] }));
});
