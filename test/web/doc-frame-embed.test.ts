import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { docExtensions } from '../../web/src/doc/extensions.ts';
import { blockPlacements, blocksInFrame, filterSlash, frameItems, frameLabel, frameNode, frameScene, frameSceneSig, framesOf, resolveFrame } from '../../web/src/doc/model.ts';

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

test('framesOf lists live frames; unnamed ones are numbered', () => {
  assert.deepEqual(framesOf(canvas), [{ id: 'f1', name: '개요', named: true }, { id: 'f2', name: '프레임 1', named: false }]);
  assert.deepEqual(framesOf(null), []);
});

test('frameScene keeps frames, their children and bound text only', () => {
  assert.deepEqual(frameScene(canvas.elements).map((e) => e.id), ['f1', 'r1', 't1', 'f2']);
  assert.notEqual(frameSceneSig(frameScene(canvas.elements)), frameSceneSig(frameScene([...canvas.elements.slice(0, 1), { ...canvas.elements[1], version: 3 }])));
});

test('resolveFrame follows a rename and reports a deleted frame', () => {
  const renamed = framesOf({ elements: [{ id: 'f1', type: 'frame', name: '새 이름' }] });
  assert.deepEqual(resolveFrame(renamed, 'f1'), { name: '새 이름', named: true });
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
  assert.deepEqual({ ...node.toJSON().content[0].attrs }, { frameId: 'f1', name: '개요' });
});

test('unnamed frames get distinct numbered labels', () => {
  const frames = framesOf({ elements: [{ id: 'a', type: 'frame' }, { id: 'b', type: 'frame', name: ' ' }, { id: 'c', type: 'frame', name: '개요' }] });
  assert.deepEqual(frames.map(frameLabel), ['프레임 1', '프레임 2', '프레임 개요']);
  assert.equal(frameItems(frames)[1].title, '프레임 넣기: 프레임 2');
  assert.equal(frameItems(frames)[1].frameName, '');
});

test('blocksInFrame keeps blocks whose centre is inside the frame', () => {
  const frame = { x: 100, y: 100, width: 400, height: 300 };
  const blocks = [
    { id: 'in', x: 120, y: 120, w: 100, h: 80 },
    { id: 'out', x: 600, y: 120, w: 100, h: 80 },
    { id: 'edge', x: 450, y: 120, w: 100, h: 80 },
    { id: 'unplaced', x: 150, y: 150, w: 0, h: 0 },
  ];
  assert.deepEqual(blocksInFrame(frame, blocks).map((b) => b.id), ['in', 'edge']);
});

test('unnamed frames are numbered among themselves; a named frame in between does not shift them', () => {
  const els = [
    { id: 'a', type: 'frame', name: '' },
    { id: 'b', type: 'frame', name: '구조도' },
    { id: 'c', type: 'magicframe' },
    { id: 'd', type: 'frame', name: 'x', isDeleted: true },
    { id: 'e', type: 'frame', name: '  ' },
  ];
  assert.deepEqual(framesOf({ elements: els }).map((f) => f.name), ['프레임 1', '구조도', '프레임 2', '프레임 3']);
});

test('blockPlacements offsets blocks by the frame origin and padding, clipped to the frame', () => {
  const frame = { x: 100, y: 50, width: 400, height: 300 };
  const blocks = [
    { id: 'in', x: 120, y: 60, w: 200, h: 100 },
    { id: 'edge', x: 450, y: 300, w: 200, h: 100 }, // centre (550, 350) is outside
    { id: 'out', x: 900, y: 900, w: 50, h: 50 },
    { id: 'half', x: 400, y: 100, w: 200, h: 100 }, // centre (500, 150) is on the edge, kept; sticks out and is clipped
  ];
  const { clip, images } = blockPlacements(frame, blocks, 8);
  assert.deepEqual(clip, { x: 8, y: 8, width: 400, height: 300 });
  assert.deepEqual(images, [
    { id: 'in', x: 28, y: 18, width: 200, height: 100 },
    { id: 'half', x: 308, y: 58, width: 200, height: 100 },
  ]);
  assert.deepEqual(blockPlacements(frame, [], 8).images, []);
});

test('a frame the canvas named "프레임" is numbered like an unnamed one, never "프레임 프레임"', () => {
  const frames = framesOf({ elements: [{ id: 'a', type: 'frame', name: '프레임' }, { id: 'b', type: 'frame', name: '개요' }, { id: 'c', type: 'frame' }] });
  assert.deepEqual(frames.map(frameLabel), ['프레임 1', '프레임 개요', '프레임 2']);
  assert.equal(frameLabel({ name: '프레임 개요', named: true }), '프레임 개요'); // a saved name that already says it
});
