// E39: connector routes (docs/research/eraser/09-examples-style.md §1.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneToSvg } from '../../shared/render/index.ts';
import type { Scene } from '../../shared/render/index.ts';
import type { Rect } from '../../shared/render/layout-align.ts';
import type { RouteEdge } from '../../shared/render/layout-routes.ts';

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
  // The two lines cross at their middles, so neither label stays on the crossing: each moves along its own
  // line towards its end node, in 24 px steps (beta one step, gamma two: its first step still touches beta).
  const es = scene.items.filter((i) => i.kind === 'edge') as E[];
  const run = (e: E, label: T) => {
    const [p, q] = e.points as [{ x: number; y: number }, { x: number; y: number }];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    // Distance from the line's middle along the line, read from the label's x (the text x is its centre).
    return { moved: ((label.x - (p.x + q.x) / 2) / (q.x - p.x)) * len, towardsEnd: Math.sign(label.x - (p.x + q.x) / 2) === Math.sign(q.x - p.x) };
  };
  const b = run(es[1]!, beta);
  const g = run(es[2]!, gamma);
  assert.ok(b.towardsEnd && g.towardsEnd, 'towards the end node');
  assert.ok(Math.abs(Math.abs(b.moved) - 24) < 0.5, `beta moved ${b.moved} px`);
  assert.ok(Math.abs(Math.abs(g.moved) - 48) < 0.5, `gamma moved ${g.moved} px`);
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

// #198: unit tests drive routeEdges with hand-made boxes and old routes.

const box = (x: number, y: number, w = 100, h = 40): Rect => ({ x, y, w, h });
const route = (from: string, to: string, ...pts: [number, number][]): RouteEdge => ({ from, to, points: pts.map(([x, y]) => ({ x, y })), keep: false });
const flat = (e: RouteEdge) => e.points.map((p) => [p.x, p.y]);
const noParents = (rects: Map<string, Rect>) => new Map([...rects.keys()].map((k) => [k, undefined]));

test('routes: replanning runs more than once when a kept route blocks another edge, and each kept route stays as it was', async () => {
  const { routeEdges } = await import('../../shared/render/layout-routes.ts');
  // e1 cannot go straight (M1 is in the way), so it keeps a detour that runs down x = 300; that makes e2's
  // straight line at x = 300 a second failure, found only on the second pass.
  const rects = new Map<string, Rect>([['A1', box(0, 0)], ['M1', box(0, 150)], ['B1', box(0, 300)], ['A2', box(250, 0)], ['B2', box(250, 300)]]);
  const e1 = route('A1', 'B1', [50, 40], [50, 60], [300, 60], [300, 280], [50, 280], [50, 300]);
  const e2 = route('A2', 'B2', [300, 40], [300, 300]);
  const before = [flat(e1), flat(e2)];
  routeEdges(rects, noParents(rects), [e1, e2]);
  assert.deepEqual([flat(e1), flat(e2)], before, 'both keep their old routes');
});

test('routes: a kept old route does not take a port slot on the side it enters', async () => {
  const { routeEdges } = await import('../../shared/render/layout-routes.ts');
  const rects = new Map<string, Rect>([['X', box(300, 0)], ['Y', box(0, 200)], ['Z', box(-250, 190)]]);
  // Z enters Y's left side, so it is no facing edge: it must not push X > Y off the middle of Y's top.
  const side = route('Z', 'Y', [-150, 210], [0, 210]);
  const down = route('X', 'Y', [350, 40], [350, 100], [50, 100], [50, 200]);
  routeEdges(rects, noParents(rects), [side, down]);
  assert.equal(down.points[down.points.length - 1]!.x, 50, 'the only port on Y\'s top is its middle');
  assert.deepEqual(flat(side), [[-150, 210], [0, 210]], 'Z > Y untouched');
});

test('routes: a fan-in shares one port and merges 24 px before the side', async () => {
  const { routeEdges, BUS_GAP } = await import('../../shared/render/layout-routes.ts');
  const rects = new Map<string, Rect>([['A', box(0, 0)], ['B', box(250, 0)], ['T', box(100, 200)]]);
  const a = route('A', 'T', [50, 40], [150, 200]);
  const b = route('B', 'T', [300, 40], [150, 200]);
  routeEdges(rects, noParents(rects), [a, b]);
  for (const e of [a, b]) {
    const end = e.points[e.points.length - 1]!;
    assert.deepEqual([end.x, end.y], [150, 200], 'one port on T');
    assert.equal(e.points[2]!.y, 200 - BUS_GAP, 'merges on the bus level');
  }
});

test('routes: a jog that stagger would push into a stub shorter than 8 px stays where it was', async () => {
  const { routeEdges, STAGGER } = await import('../../shared/render/layout-routes.ts');
  const run = (gap: number) => {
    const rects = new Map<string, Rect>([['A1', box(0, 0)], ['B1', box(150, 40 + gap)], ['A2', box(120, 0)], ['B2', box(300, 40 + gap)]]);
    const e1 = route('A1', 'B1', [50, 40], [200, 40 + gap]);
    const e2 = route('A2', 'B2', [170, 40], [350, 40 + gap]);
    routeEdges(rects, noParents(rects), [e1, e2]);
    return [e1, e2];
  };
  // Roomy gap: the two overlapping jogs are dealt out STAGGER apart.
  const [r1, r2] = run(60);
  assert.equal(Math.abs(r1!.points[1]!.y - r2!.points[1]!.y), STAGGER);
  // Gap 16: a stub is 8 px; moving a jog 3 px would leave one stub at 5, so both stay on the middle.
  const [t1, t2] = run(16);
  assert.equal(t1!.points[1]!.y, t2!.points[1]!.y);
  assert.equal(t1!.points[1]!.y, 48);
});

test('routes: a label never sits on a run it shares with another line or on its split point', async () => {
  const { renderDiagram } = await import('../../shared/render/index.ts');
  const code = ['H', 'A', 'B', 'C', 'D', 'H > A: one', 'H > B: two', 'H > C: three', 'H > D: four', 'A > D: x'].join('\n');
  const { scene } = await renderDiagram(code, { type: 'flowchart' });
  type E = { kind: 'edge'; id: string; points: { x: number; y: number }[] };
  type T = { kind: 'text'; plate?: boolean; lines: string[]; x: number; y: number; h?: number };
  const es = scene.items.filter((i) => i.kind === 'edge') as E[];
  const labels = scene.items.filter((i) => i.kind === 'text' && (i as T).plate) as T[];
  const dist = (c: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x + dx * t - c.x, p.y + dy * t - c.y);
  };
  const names = ['one', 'two', 'three', 'four', 'x'];
  names.forEach((name, i) => {
    const l = labels.find((t) => t.lines[0] === name)!;
    const c = { x: l.x, y: l.y + 11 }; // text y is the plate top; labels here are one line (about 22 px tall)
    for (const [j, other] of es.entries()) {
      if (j === i) continue;
      for (let k = 1; k < other.points.length; k++) assert.ok(dist(c, other.points[k - 1]!, other.points[k]!) > 6, `'${name}' sits on ${other.id}`);
    }
  });
});

test('routes: a bus member blocked on the bus level leaves the bus instead of running down its siblings', async () => {
  const { renderDiagram } = await import('../../shared/render/index.ts');
  const code = ['H', 'A', 'B', 'C', 'D', 'H > A: one', 'H > B: two', 'H > C: three', 'H > D: four', 'A > D: x'].join('\n');
  const { scene } = await renderDiagram(code, { type: 'flowchart' });
  type E = { kind: 'edge'; id: string; points: { x: number; y: number }[] };
  const es = scene.items.filter((i) => i.kind === 'edge') as E[];
  const [, b, c] = es as [E, E, E];
  // H > C used to leave H's shared port and run beside H > B for 69 px before jogging.
  assert.notEqual(c.points[0]!.x, b.points[0]!.x, 'H > C has a port of its own');
  const sharedRun = c.points.slice(1).reduce((n, q, k) => (q.x === c.points[k]!.x && q.x === b.points[0]!.x ? n + Math.abs(q.y - c.points[k]!.y) : n), 0);
  assert.ok(sharedRun <= 30, `${sharedRun} px beside H > B`);
});
