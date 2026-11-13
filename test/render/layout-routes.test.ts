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

test('routes: a label that would cover another moves in 24 px steps along its line towards the end node', async () => {
  const { renderDiagram } = await import('../../shared/render/index.ts');
  // In a 2x2 straight mesh the two crossing lines share a midpoint, so beta and gamma would stack.
  const code = ['direction down', 'connectorStyle straight', 'S1', 'S2', 'L1', 'L2', 'S1 > L1: alpha', 'S1 > L2: beta', 'S2 > L1: gamma', 'S2 > L2: delta'].join('\n');
  const { scene } = await renderDiagram(code, { type: 'flowchart' });
  type T = { kind: 'text'; plate?: boolean; lines: string[]; x: number; y: number };
  type E = { kind: 'edge'; id: string; points: { x: number; y: number }[] };
  const labels = scene.items.filter((i) => i.kind === 'text' && (i as T).plate) as T[];
  const beta = labels.find((l) => l.lines[0] === 'beta')!;
  const gamma = labels.find((l) => l.lines[0] === 'gamma')!;
  assert.ok(Math.hypot(beta.x - gamma.x, beta.y - gamma.y) > 20, 'labels no longer stack');
  // gamma sits on its line (S2 > L1), 24 px past the middle towards L1.
  const es = scene.items.filter((i) => i.kind === 'edge') as E[];
  const mid = (e: E) => ({ x: (e.points[0]!.x + e.points[1]!.x) / 2, y: (e.points[0]!.y + e.points[1]!.y) / 2 });
  // Text y is the top of the label; beta stayed on its middle, which gives the offset to the centre.
  const dy = mid(es[1]!).y - beta.y;
  const g = { x: gamma.x, y: gamma.y + dy };
  const m = mid(es[2]!);
  const end = es[2]!.points[1]!;
  // Steps of 24 px until the plate is clear (one step still touches beta here, so two).
  const moved = Math.hypot(g.x - m.x, g.y - m.y);
  assert.ok(moved >= 23 && Math.abs(moved / 24 - Math.round(moved / 24)) < 0.06, `moved ${moved} px`);
  assert.ok(Math.hypot(g.x - end.x, g.y - end.y) < Math.hypot(m.x - end.x, m.y - end.y), 'towards the end node');
});

test('routes: an edge that keeps its old route is not overlapped by the bus of its fan', async () => {
  const { renderDiagram } = await import('../../shared/render/index.ts');
  // H > D cannot Z around A, so it keeps ELK's route; the H > C bus used to run on top of it (PR #140 review).
  const code = ['H', 'A', 'B', 'C', 'D', 'H > A: one', 'H > B: two', 'H > C: three', 'H > D: four', 'A > D: x'].join('\n');
  const { scene } = await renderDiagram(code, { type: 'flowchart' });
  type E = { kind: 'edge'; id: string; points: { x: number; y: number }[] };
  const es = scene.items.filter((i) => i.kind === 'edge') as E[];
  const segs = (e: E) => e.points.slice(1).map((q, k) => [e.points[k]!, q] as const);
  // The kept route (H > D, the 4th edge) must not share a run with any other line.
  const kept = es[3]!;
  const along = (a0: number, a1: number, b0: number, b1: number) =>
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
  for (const other of es) {
    if (other === kept) continue;
    for (const [p, q] of segs(kept)) {
      for (const [r, s] of segs(other)) {
        const h = p.y === q.y && r.y === s.y && p.y === r.y && along(p.x, q.x, r.x, s.x) > 1;
        // Lines from one side of H share its first few pixels only where they leave the same port.
        const v = p.x === q.x && r.x === s.x && p.x === r.x && along(p.y, q.y, r.y, s.y) > 1;
        assert.ok(!h && !v, `${kept.id} and ${other.id} run together from (${p.x},${p.y}) to (${q.x},${q.y})`);
      }
    }
  }
});
