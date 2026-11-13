// E39: connector routes (docs/research/eraser/09-examples-style.md §1.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneToSvg } from '../../shared/render/index.ts';
import type { Scene } from '../../shared/render/index.ts';

test('routes: a right-angle bend is a radius 6 arc', () => {
  const scene: Scene = {
    width: 200,
    height: 200,
    items: [{ kind: 'edge', id: 'e', points: [{ x: 10, y: 10 }, { x: 10, y: 100 }, { x: 100, y: 100 }], route: 'elbow', dashed: false, start: 'none', end: 'none' }],
  } as Scene;
  const svg = sceneToSvg(scene);
  // Down then right turns counter-clockwise on screen: sweep 0.
  assert.match(svg, /d="M10 10L10 94A6 6 0 0 0 16 100L100 100"/);
  const back = sceneToSvg({ ...scene, items: [{ ...scene.items[0]!, points: [{ x: 100, y: 100 }, { x: 10, y: 100 }, { x: 10, y: 10 }] }] } as Scene);
  assert.match(back, /A6 6 0 0 1 10 94/);
});

test('routes: a fan shares one port and a bus 24 px out, at most two bends', async () => {
  const { parse } = await import('../../shared/dsl/index.ts');
  const { graphBase } = await import('../../shared/render/index.ts');
  const { bends } = await import('../../shared/render/layout-routes.ts');
  const { ast } = parse(['G', 'A', 'B', 'C', 'G > A', 'G > B', 'G > C'].join('\n'), 'flowchart');
  assert.ok(ast.type === 'flowchart');
  const b = await graphBase(ast);
  const g = b.rects.get('G')!;
  const starts = new Set(b.edges.map((e) => `${e.points[0]!.x},${e.points[0]!.y}`));
  assert.equal(starts.size, 1, 'one shared port');
  for (const e of b.edges) {
    assert.ok(bends(e.points) <= 2, JSON.stringify(e.points));
    if (e.points.length > 2) assert.equal(e.points[1]!.y, g.y + g.h + 24, 'jog on the bus');
  }
});

test('routes: straight style joins side ports at (i + 1) / (n + 1) as soft diagonal lines', async () => {
  const { renderDiagram } = await import('../../shared/render/index.ts');
  const code = ['direction down', 'connectorStyle straight', 'S1', 'S2', 'L1', 'L2', 'L3', 'S1 > L1', 'S1 > L2', 'S1 > L3', 'S2 > L1', 'S2 > L2', 'S2 > L3'].join('\n');
  const { scene, svg } = await renderDiagram(code, { type: 'cloud-architecture' });
  type Box = { kind: 'box'; id: string; x: number; y: number; w: number; h: number };
  type Edge = { kind: 'edge'; id: string; points: { x: number; y: number }[]; soft?: boolean; route: string };
  const box = (id: string) => scene.items.find((i) => i.kind === 'box' && (i as Box).id === id) as Box;
  const edges = scene.items.filter((i) => i.kind === 'edge') as Edge[];
  assert.equal(edges.length, 6);
  for (const e of edges) {
    assert.equal(e.points.length, 2, 'one segment');
    assert.equal(e.soft, true, 'soft');
  }
  // S1's three lines leave its bottom side at 1/4, 2/4, 3/4 (not from its centre).
  const s1 = box('S1');
  const xs = edges.map((e) => e.points[0]!).filter((p) => Math.abs(p.y - (s1.y + s1.h)) < 1 && p.x >= s1.x && p.x <= s1.x + s1.w).map((p) => p.x).sort((a, b) => a - b);
  assert.equal(xs.length, 3);
  xs.forEach((x, i) => assert.ok(Math.abs(x - (s1.x + (s1.w * (i + 1)) / 4)) <= 0.5, `port ${i} at ${x}`));
  // Lines into L2 enter its top at 1/3 and 2/3.
  const l2 = box('L2');
  const ins = edges.map((e) => e.points[1]!).filter((p) => Math.abs(p.y - l2.y) < 1 && p.x >= l2.x && p.x <= l2.x + l2.w).map((p) => p.x).sort((a, b) => a - b);
  assert.equal(ins.length, 2);
  ins.forEach((x, i) => assert.ok(Math.abs(x - (l2.x + (l2.w * (i + 1)) / 3)) <= 0.5, `in-port ${i} at ${x}`));
  assert.match(svg, /<g data-edge="[^"]+" opacity="0\.55">/);
});

test('routes: elbow, arc and sequence lines stay solid', async () => {
  const { renderDiagram } = await import('../../shared/render/index.ts');
  const elbow = await renderDiagram('A > B\nA > C', { type: 'flowchart' });
  const arc = await renderDiagram('connectorStyle arc\nA > B', { type: 'flowchart' });
  const seq = await renderDiagram('A > B: hi\nB > A: ok', { type: 'sequence' });
  for (const r of [elbow, arc, seq]) {
    assert.ok(r.scene.items.some((i) => i.kind === 'edge'));
    assert.ok(r.scene.items.every((i) => i.kind !== 'edge' || !(i as { soft?: boolean }).soft));
    assert.doesNotMatch(r.svg, /data-edge="[^"]+" opacity/);
  }
});
