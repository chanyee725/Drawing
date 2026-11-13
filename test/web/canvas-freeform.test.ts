import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindArrows, frameFor, sceneToFreeform } from '../../web/src/canvas/freeform.ts';
import { CLEAN_APP_STATE, CLEAN_FONT_FAMILY, cleanElements, cleanSkeleton } from '../../web/src/canvas/cleanStyle.ts';
import { shapeSkeleton } from '../../web/src/canvas/insert.ts';
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
  assert.equal(title.fontFamily, 9, 'loose text uses the clean font too');
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

// Nested groups: the inner one has an icon before its title; one note sits outside every box.
const NESTED: Scene = {
  type: 'cloud-architecture',
  width: 600,
  height: 340,
  items: [
    { kind: 'box', id: 'outer', role: 'group', shape: 'rectangle', x: 0, y: 0, w: 600, h: 300, paint: { mode: 'pastel' }, shadow: false },
    { kind: 'text', x: 14, y: 12, lines: ['Cloud'], size: 12, lineHeight: 16, anchor: 'start', weight: 600, font: 'clean', tone: 'normal' },
    { kind: 'box', id: 'inner', role: 'group', shape: 'rectangle', x: 100, y: 60, w: 300, h: 200, paint: { color: 'green', mode: 'pastel' }, shadow: false },
    { kind: 'icon', name: 'server', x: 114, y: 71, size: 17, paint: { color: 'green', mode: 'pastel' } },
    { kind: 'text', x: 139, y: 72, lines: ['VPC'], size: 12, lineHeight: 16, anchor: 'start', weight: 600, font: 'clean', tone: 'normal' },
    { kind: 'box', id: 'n', role: 'node', shape: 'rectangle', x: 150, y: 120, w: 100, h: 40, paint: { mode: 'pastel' }, shadow: true },
    { kind: 'text', x: 200, y: 132, lines: ['API'], size: 14, lineHeight: 18, anchor: 'middle', weight: 400, font: 'clean', tone: 'normal' },
    { kind: 'icon', name: 'server', x: 160, y: 130, size: 16, paint: { mode: 'pastel' }, inside: true },
    { kind: 'text', x: 20, y: 316, lines: ['note'], size: 12, lineHeight: 16, anchor: 'start', weight: 400, font: 'clean', tone: 'muted' },
  ],
};

test('nested groups: each title joins its own (smallest) group, a note outside every box stays loose', () => {
  const sk = sceneToFreeform(NESTED, { x: 0, y: 0, width: 600 }, counter()).skeletons;
  const [outer, inner, node] = sk;
  const text = (s: string) => sk.find((x) => x.type === 'text' && x.text === s)!;
  assert.deepEqual(text('Cloud').groupIds, outer.groupIds);
  assert.deepEqual(text('VPC').groupIds, inner.groupIds);
  assert.notDeepEqual(outer.groupIds, inner.groupIds);
  assert.equal(text('note').groupIds, undefined);
  assert.equal(node.groupIds, undefined);
  assert.equal((node.label as { text: string }).text, 'API');
  assert.equal(sk.filter((x) => x.type === 'text').length, 3, 'the node label is bound, not loose');
  assert.ok(sk.every((x) => x.type !== 'image'), 'no icons');
});

test('a group title takes its left-out icon slot instead of leaving a gap', () => {
  const sk = sceneToFreeform(NESTED, { x: 1000, y: 0, width: 1200 }, counter()).skeletons;
  const text = (s: string) => sk.find((x) => x.type === 'text' && x.text === s)!;
  assert.equal(text('VPC').x, 1000 + 114 * 2, 'starts where the icon was');
  assert.equal(text('Cloud').x, 1000 + 14 * 2, 'a title without an icon stays put');
  assert.equal(text('note').x, 1000 + 20 * 2);
});

test('a real architecture group with an icon converts without an icon gap', async () => {
  const d = parseArchitecture('VPC [icon: server] {\n  Inner [icon: database] {\n    API [icon: server]\n  }\n  Worker\n}\nDB [icon: database]\nAPI > DB\nWorker > DB');
  const scene = await layoutDiagram(d.ast);
  const groups = scene.items.filter((i) => i.kind === 'box' && i.role === 'group');
  assert.equal(groups.length, 2, 'fixture has an inner group');
  const { skeletons } = sceneToFreeform(scene, { x: 0, y: 0, width: scene.width }, counter());
  for (const name of ['VPC', 'Inner']) {
    const g = groups.find((b) => b.kind === 'box' && b.id === name)!;
    const title = skeletons.find((s) => s.type === 'text' && s.text === name)!;
    assert.ok(g.kind === 'box' && Math.abs((title.x as number) - (g.x + 14)) < 0.5, `${name} title at the group's padding, got ${title.x} vs ${g.kind === 'box' && g.x}`);
  }
  assert.deepEqual(skeletons.filter((s) => s.type === 'rectangle' && s.label).map((s) => (s.label as { text: string }).text).sort(), ['API', 'DB', 'Worker']);
});

test('frameFor: the image keeps its own frame, else the smallest live frame that holds it whole', () => {
  const r = (id: string, type: string, x: number, y: number, width: number, height: number, more = {}) => ({ id, type, x, y, width, height, ...more });
  const img = r('img', 'image', 100, 100, 200, 100);
  const big = r('big', 'frame', 0, 0, 1000, 1000);
  const small = r('small', 'frame', 50, 50, 400, 300);
  const part = r('part', 'frame', 150, 0, 400, 400);
  assert.equal(frameFor(img, [img, big, small, part]), 'small');
  assert.equal(frameFor(img, [img, r('gone', 'frame', 50, 50, 300, 200, { isDeleted: true }), big]), 'big');
  assert.equal(frameFor(img, [img, part, r('rect', 'rectangle', 0, 0, 1000, 1000)]), null, 'partly inside or not a frame');
  assert.equal(frameFor({ ...img, frameId: 'own' }, [img, small, r('own', 'frame', 900, 900, 10, 10)]), 'own');
  // The image's own frame only counts while that frame is live (#83).
  assert.equal(frameFor({ ...img, frameId: 'own' }, [img, small, r('own', 'frame', 900, 900, 10, 10, { isDeleted: true })]), 'small');
  assert.equal(frameFor({ ...img, frameId: 'missing' }, [img, big]), 'big');
});

// Clean lines only (E58).
test('new arrows are elbowed and new shapes are not hand-drawn', () => {
  assert.equal(CLEAN_APP_STATE.currentItemArrowType, 'elbow');
  assert.equal(CLEAN_APP_STATE.currentItemRoughness, 0);
  assert.equal(CLEAN_APP_STATE.currentItemFontFamily, CLEAN_FONT_FAMILY);
});

// New free-form text is as big as node text in diagram blocks (E64).
test('new free-form text starts at 13px, and a skeleton that sets its own size keeps it', () => {
  assert.equal(CLEAN_APP_STATE.currentItemFontSize, 13);
  assert.equal(cleanSkeleton(shapeSkeleton('text', { x: 0, y: 0 })).fontSize, 13);
  assert.equal(cleanSkeleton({ type: 'text', text: 'a', fontSize: 20 }).fontSize, 20);
});

test('insert-menu skeletons get the clean style instead of the hand-drawn defaults', () => {
  for (const kind of ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'frame'] as const) {
    const sk = cleanSkeleton(shapeSkeleton(kind, { x: 0, y: 0 }));
    assert.equal(sk.roughness, 0, kind);
    assert.equal(sk.strokeWidth, 1, kind);
  }
  assert.equal(cleanSkeleton({ type: 'text', text: 'a' }).fontFamily, CLEAN_FONT_FAMILY);
  assert.equal(cleanSkeleton({ type: 'arrow' }).elbowed, true);
  assert.equal(cleanSkeleton({ type: 'line' }).elbowed, undefined);
  assert.deepEqual(cleanSkeleton({ type: 'rectangle' }).roundness, { type: 3 });
  // What the skeleton sets itself wins.
  assert.equal(cleanSkeleton({ type: 'rectangle', strokeWidth: 4 }).strokeWidth, 4);
});

test('hand-drawn shapes from an old file open clean; block images and clean shapes are untouched', () => {
  const rough = { id: 'r', type: 'rectangle', roughness: 1, version: 3 };
  const cartoon = { id: 'd', type: 'diamond', roughness: 2, version: 1 };
  const hand = { id: 't', type: 'text', roughness: 1, fontFamily: 5, version: 2 };
  const virgil = { id: 'v', type: 'text', roughness: 0, fontFamily: 1, version: 2 };
  const code = { id: 'c', type: 'text', roughness: 0, fontFamily: 8, version: 2 };
  const image = { id: 'i', type: 'image', roughness: 1, version: 1 };
  const clean = { id: 'k', type: 'arrow', roughness: 0, version: 1 };
  const out = cleanElements([rough, cartoon, hand, virgil, code, image, clean]);
  assert.equal(out.changed, true);
  assert.deepEqual(out.refit, ['t', 'v'], 'the texts that changed font are measured again');
  assert.deepEqual(out.elements.map((e) => e.roughness), [0, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(out.elements.map((e) => (e as { fontFamily?: number }).fontFamily), [undefined, undefined, CLEAN_FONT_FAMILY, CLEAN_FONT_FAMILY, 8, undefined, undefined]);
  // Versions stay as saved: opening a file alone must not look like an edit (nothing is written).
  assert.deepEqual(out.elements.map((e) => e.version), [3, 1, 2, 2, 2, 1, 1]);
  assert.equal(out.elements[4], code);
  assert.equal(out.elements[5], image);
  assert.equal(out.elements[6], clean);
});

test('a clean scene comes back as the same array, and a live change goes through the given builder', () => {
  const els = [{ id: 'a', type: 'rectangle', roughness: 0 }, { id: 'i', type: 'image', roughness: 1 }];
  const same = cleanElements(els);
  assert.equal(same.elements, els);
  assert.equal(same.changed, false);
  const bumped = cleanElements([{ id: 'p', type: 'ellipse', roughness: 1, version: 1 }], (e, patch) => ({ ...e, ...patch, version: e.version + 1 }));
  assert.deepEqual(bumped.elements, [{ id: 'p', type: 'ellipse', roughness: 0, version: 2 }]);
  assert.deepEqual(bumped.refit, []);
});
