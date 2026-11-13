import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindArrows, sceneToFreeform } from '../../web/src/canvas/freeform.ts';
import type { Scene } from '../../shared/render/scene.ts';
import { layoutDiagram } from '../../shared/render/index.ts';
import { parseArchitecture, parseFlowchart } from '../../shared/dsl/index.ts';

const counter = () => {
  let n = 0;
  return () => `e${++n}`;
};

const SCENE: Scene = {
  type: 'flowchart',
  width: 400,
  height: 200,
  items: [
    { kind: 'box', id: 'g', role: 'group', shape: 'rectangle', x: 0, y: 0, w: 400, h: 200, paint: { mode: 'pastel' }, shadow: false },
    { kind: 'text', x: 10, y: 4, lines: ['Group'], size: 12, lineHeight: 16, anchor: 'start', weight: 600, font: 'clean', tone: 'muted' },
    { kind: 'box', id: 'a', role: 'node', shape: 'rectangle', x: 20, y: 50, w: 100, h: 40, paint: { color: 'blue', mode: 'pastel' }, shadow: true },
    { kind: 'text', x: 70, y: 62, lines: ['A'], size: 14, lineHeight: 18, anchor: 'middle', weight: 400, font: 'clean', tone: 'normal', on: { color: 'blue', mode: 'pastel' } },
    { kind: 'box', id: 'b', role: 'node', shape: 'diamond', x: 280, y: 40, w: 80, h: 60, paint: { mode: 'pastel' }, shadow: true },
    { kind: 'text', x: 320, y: 62, lines: ['B?'], size: 14, lineHeight: 18, anchor: 'middle', weight: 400, font: 'clean', tone: 'normal' },
    { kind: 'edge', id: 'a>b', points: [{ x: 120, y: 70 }, { x: 200, y: 70 }, { x: 200, y: 72 }, { x: 280, y: 72 }], route: 'elbow', dashed: true, start: 'none', end: 'arrow' },
    { kind: 'text', x: 200, y: 60, lines: ['yes'], size: 12, lineHeight: 16, anchor: 'middle', weight: 400, font: 'clean', tone: 'normal', plate: true },
    { kind: 'icon', name: 'user', x: 25, y: 55, size: 16, paint: { mode: 'pastel' } },
  ],
};

test('nodes become shapes with bound labels, edges arrows with labels, groups dashed boxes with a title', () => {
  const { skeletons, bindings } = sceneToFreeform(SCENE, { x: 1000, y: 500, width: 800 }, counter());
  const types = skeletons.map((s) => s.type);
  assert.deepEqual(types, ['rectangle', 'rectangle', 'diamond', 'arrow', 'text']);
  const [group, a, b, arrow, title] = skeletons;
  // Placed where the image is, scaled to its width (2x here).
  assert.deepEqual([a.x, a.y, a.width, a.height], [1040, 600, 200, 80]);
  assert.equal(group.strokeStyle, 'dashed');
  assert.deepEqual(a.label, { text: 'A', fontSize: 28, fontFamily: 9, strokeColor: (a.label as { strokeColor: string }).strokeColor });
  assert.equal((b.label as { text: string }).text, 'B?');
  assert.equal(title.text, 'Group');
  // Bent like the drawing, relative to its first point.
  assert.deepEqual(arrow.points, [[0, 0], [160, 0], [160, 4], [320, 4]]);
  assert.equal(arrow.strokeStyle, 'dashed');
  assert.equal(arrow.startArrowhead, null);
  assert.equal(arrow.endArrowhead, 'arrow');
  assert.equal((arrow.label as { text: string }).text, 'yes');
  assert.deepEqual(bindings, [{ arrowId: arrow.id, startId: a.id, endId: b.id }]);
});

test('bindArrows links both ends both ways', () => {
  const els = [{ id: 'n1', type: 'rectangle', boundElements: [{ id: 't', type: 'text' }] }, { id: 'n2', type: 'diamond', boundElements: null }, { id: 'x', type: 'arrow' }];
  const out = bindArrows(els, [{ arrowId: 'x', startId: 'n1', endId: 'n2' }]);
  assert.deepEqual(out[0].boundElements, [{ id: 't', type: 'text' }, { id: 'x', type: 'arrow' }]);
  assert.deepEqual(out[1].boundElements, [{ id: 'x', type: 'arrow' }]);
  assert.equal((out[2].startBinding as { elementId: string }).elementId, 'n1');
  assert.equal((out[2].endBinding as { elementId: string }).elementId, 'n2');
  assert.deepEqual(bindArrows(els, [{ arrowId: 'x', startId: null, endId: 'gone' }])[2].endBinding, null);
});

test('a real flowchart converts every node and edge, each edge bound at both ends', async () => {
  const d = parseFlowchart('Start [shape: oval]\nCheck [shape: diamond]\nDone\nStart > Check\nCheck > Done: yes');
  const scene = await layoutDiagram(d.ast);
  const { skeletons, bindings } = sceneToFreeform(scene, { x: 0, y: 0, width: scene.width }, counter());
  assert.equal(skeletons.filter((s) => s.type === 'ellipse').length, 1);
  assert.equal(skeletons.filter((s) => s.type === 'diamond').length, 1);
  assert.equal(skeletons.filter((s) => s.type === 'arrow').length, 2);
  assert.ok(bindings.every((b) => b.startId && b.endId), JSON.stringify(bindings));
  assert.ok(skeletons.some((s) => (s.label as { text?: string } | undefined)?.text === 'yes'));
});

test('architecture nodes (icon and label, no box) become rectangles from their hit boxes', async () => {
  const d = parseArchitecture('Web [icon: user]\nAPI [icon: server]\nWeb > API: call');
  const scene = await layoutDiagram(d.ast);
  const { skeletons, bindings } = sceneToFreeform(scene, { x: 0, y: 0, width: scene.width }, counter());
  const rects = skeletons.filter((s) => s.type === 'rectangle');
  assert.deepEqual(rects.map((r) => (r.label as { text: string }).text).sort(), ['API', 'Web']);
  assert.equal(skeletons.filter((s) => s.type === 'text').length, 0, 'labels are inside the shapes, not loose');
  assert.ok(bindings.every((b) => b.startId && b.endId), JSON.stringify(bindings));
});

test('a block stretched taller than wide scales each axis on its own', () => {
  // Scene 400x200 drawn into 800x600: x2 across, x3 down.
  const { skeletons } = sceneToFreeform(SCENE, { x: 1000, y: 500, width: 800, height: 600 }, counter());
  const a = skeletons[1];
  assert.deepEqual([a.x, a.y, a.width, a.height], [1040, 650, 200, 120]);
  const arrow = skeletons[3];
  assert.deepEqual(arrow.points, [[0, 0], [160, 0], [160, 6], [320, 6]]);
  // Without a height the width scale applies to both, as before.
  const same = sceneToFreeform(SCENE, { x: 1000, y: 500, width: 800 }, counter()).skeletons[1];
  assert.deepEqual([same.y, same.height], [600, 80]);
});

test('a group title shares groupIds with its dashed rectangle so they move together', () => {
  const [group, a, , , title] = sceneToFreeform(SCENE, { x: 0, y: 0, width: 400 }, counter()).skeletons;
  const ids = group.groupIds as string[];
  assert.equal(ids.length, 1);
  assert.deepEqual(title.groupIds, ids);
  assert.equal(a.groupIds, undefined);
});
