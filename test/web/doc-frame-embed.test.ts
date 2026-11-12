import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { docExtensions } from '../../web/src/doc/extensions.ts';
import { filterSlash, frameItems, frameNode, frameScene, frameSceneSig, framesOf, resolveFrame } from '../../web/src/doc/model.ts';

const canvas = {
  elements: [
    { id: 'f1', type: 'frame', name: '개요', version: 1 },
    { id: 'r1', type: 'rectangle', frameId: 'f1', version: 2 },
    { id: 't1', type: 'text', containerId: 'r1', version: 1 },
    { id: 'r2', type: 'rectangle', frameId: null, version: 1 },
    { id: 'f2', type: 'frame', name: '', version: 1 },
    { id: 'f3', type: 'frame', name: '지움', isDeleted: true },
  ],
};

test('framesOf lists live frames with a default name', () => {
  assert.deepEqual(framesOf(canvas), [{ id: 'f1', name: '개요' }, { id: 'f2', name: '프레임' }]);
  assert.deepEqual(framesOf(null), []);
});

test('frameScene keeps frames, their children and bound text only', () => {
  assert.deepEqual(frameScene(canvas.elements).map((e) => e.id), ['f1', 'r1', 't1', 'f2']);
  assert.notEqual(frameSceneSig(frameScene(canvas.elements)), frameSceneSig(frameScene([...canvas.elements.slice(0, 1), { ...canvas.elements[1], version: 3 }])));
});

test('resolveFrame follows a rename and reports a deleted frame', () => {
  const renamed = framesOf({ elements: [{ id: 'f1', type: 'frame', name: '새 이름' }] });
  assert.deepEqual(resolveFrame(renamed, 'f1'), { name: '새 이름' });
  assert.equal(resolveFrame(renamed, 'gone'), null);
});

test('the / menu offers each frame and finds it by name', () => {
  const items = frameItems(framesOf(canvas));
  assert.equal(items[0].frameId, 'f1');
  assert.deepEqual(filterSlash(items, '개요').map((i) => i.frameId), ['f1']);
});

test('a frame embed fits the schema and round-trips', () => {
  const schema = getSchema(docExtensions());
  const doc = { type: 'doc', content: [frameNode('f1', '개요'), { type: 'paragraph' }] };
  const node = PMNode.fromJSON(schema, doc);
  node.check();
  assert.deepEqual(node.toJSON().content[0].attrs, { frameId: 'f1', name: '개요' });
});
