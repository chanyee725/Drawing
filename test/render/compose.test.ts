import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '../../shared/dsl/index.ts';
import type { GraphDiagram } from '../../shared/dsl/index.ts';
import { composeGraph, graphBase, renderDiagram, sceneToSvg } from '../../shared/render/index.ts';
import type { BlockLayout, GraphBase, Point, Scene, SceneEdge, SceneHandle } from '../../shared/render/index.ts';

function snapshot(name: string, svg: string): void {
  const file = fileURLToPath(new URL(`./__snapshots__/${name}.svg`, import.meta.url));
  const update = process.env.UPDATE_SNAPSHOTS === '1';
  if (!update && !existsSync(file) && process.env.CI) assert.fail(`snapshot ${name} is missing (run with UPDATE_SNAPSHOTS=1 and commit it)`);
  if (update || !existsSync(file)) writeFileSync(file, svg + '\n');
  assert.equal(svg + '\n', readFileSync(file, 'utf8'), `snapshot ${name} changed (UPDATE_SNAPSHOTS=1 to accept)`);
}

async function setup(code: string, type: 'cloud-architecture' | 'flowchart' = 'cloud-architecture'): Promise<{ d: GraphDiagram; base: GraphBase }> {
  const { ast, diagnostics } = parse(code, type);
  assert.deepEqual(diagnostics.filter((x) => x.severity === 'error'), []);
  assert.ok(ast.type === 'cloud-architecture' || ast.type === 'flowchart');
  return { d: ast, base: await graphBase(ast) };
}

const layoutOf = (items: BlockLayout['items']): BlockLayout => ({ v: 1, items });
const handle = (s: Scene, id: string): SceneHandle => s.handles!.find((h) => h.id === id)!;
const edges = (s: Scene): SceneEdge[] => s.items.filter((i): i is SceneEdge => i.kind === 'edge');
const centre = (r: { x: number; y: number; w: number; h: number }): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
/** Layout-coordinate centre of an element from its ELK box. */
const baseCentre = (base: GraphBase, id: string): Point => centre(base.rects.get(id)!);
const edgeBetween = (d: GraphDiagram, s: Scene, from: string, to: string, nth = 0): SceneEdge => {
  const ids = d.edges.filter((e) => e.from === from && e.to === to).map((e) => e.id);
  return edges(s).find((e) => e.id === ids[nth])!;
};
const orthogonal = (pts: Point[]): boolean => pts.every((p, i) => i === 0 || p.x === pts[i - 1]!.x || p.y === pts[i - 1]!.y);
const onBorder = (p: Point, r: SceneHandle): boolean =>
  p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1 &&
  (Math.abs(p.x - r.x) < 1.5 || Math.abs(p.x - r.x - r.w) < 1.5 || Math.abs(p.y - r.y) < 1.5 || Math.abs(p.y - r.y - r.h) < 1.5);

const ARCH = ['U [icon: user]', 'VPC {', '  API', '  Worker', '  DB [shape: cylinder]', '}', 'Empty {', '}', 'U > API: calls', 'API > DB', 'Worker > DB', 'API > Worker'].join('\n');

test('compose: no layout gives the same SVG as renderDiagram, and reports origin and handles', async () => {
  const { d, base } = await setup(ARCH);
  const scene = composeGraph(d, base);
  const { svg } = await renderDiagram(ARCH, { type: 'cloud-architecture' });
  assert.equal(sceneToSvg(scene), svg);
  assert.ok(scene.origin);
  for (const id of ['U', 'VPC', 'API', 'Worker', 'DB', 'Empty']) {
    const h = handle(scene, id);
    assert.ok(h, id);
    assert.equal(h.moved, false);
    const r = base.rects.get(id)!;
    assert.ok(Math.abs(h.x - (r.x + scene.origin.x)) < 0.02 && Math.abs(h.y - (r.y + scene.origin.y)) < 0.02, `${id} handle in scene coordinates`);
  }
  // Nodes with an icon draw as box cards by default (E40).
  assert.ok(scene.items.some((i) => i.kind === 'box' && i.id === 'U'));
  assert.equal(handle(scene, 'API').parent, 'VPC');
  assert.equal(handle(scene, 'U').parent, '');
  // Groups paint before nodes.
  assert.ok(scene.handles!.findIndex((h) => h.id === 'VPC') < scene.handles!.findIndex((h) => h.id === 'API'));
});

test('compose: overrides that do not match the code are ignored', async () => {
  const { d, base } = await setup(ARCH);
  const plain = sceneToSvg(composeGraph(d, base));
  const c = baseCentre(base, 'API');
  const ignored: BlockLayout[] = [
    layoutOf({ Nope: { cx: 0, cy: 0, parent: '' } }),
    layoutOf({ API: { cx: c.x + 300, cy: c.y, parent: '' } }), // parent changed in code
    layoutOf({ VPC: { cx: 0, cy: 0, parent: '' } }), // group with children: computed from its children
    layoutOf({ API: { cx: Number.NaN, cy: 0, parent: 'VPC' } }),
    { v: 2, items: { API: { cx: c.x + 300, cy: c.y, parent: 'VPC' } } },
    layoutOf({}),
  ];
  for (const layout of ignored) assert.equal(sceneToSvg(composeGraph(d, base, layout)), plain, JSON.stringify(layout));
});

test('compose: a moved node is centred on its override and its group refits around it', async () => {
  const { d, base } = await setup(ARCH);
  const c = baseCentre(base, 'Worker');
  const target = { x: c.x + 400, y: c.y + 250 };
  const scene = composeGraph(d, base, layoutOf({ Worker: { cx: target.x, cy: target.y, parent: 'VPC' } }));
  const o = scene.origin!;
  const w = handle(scene, 'Worker');
  assert.equal(w.moved, true);
  assert.ok(Math.abs(w.x + w.w / 2 - (target.x + o.x)) < 0.02 && Math.abs(w.y + w.h / 2 - (target.y + o.y)) < 0.02);
  const vpc = handle(scene, 'VPC');
  assert.equal(vpc.moved, true);
  for (const id of ['API', 'Worker', 'DB']) {
    const h = handle(scene, id);
    // Group padding: 16 left and right, 14 at the bottom.
    assert.ok(h.x >= vpc.x + 15.9 && h.y > vpc.y && h.x + h.w <= vpc.x + vpc.w - 15.9 && h.y + h.h <= vpc.y + vpc.h - 13.9, `${id} inside VPC with padding`);
  }
  // Untouched elements keep their place relative to the layout origin.
  const api = handle(scene, 'API');
  const r = base.rects.get('API')!;
  assert.ok(Math.abs(api.x - (r.x + o.x)) < 0.02 && api.moved === false);
  assert.equal(handle(scene, 'Empty').moved, false);
});

test('compose: moving a whole group shifts its box and inner edges unchanged in shape', async () => {
  const { d, base } = await setup(ARCH);
  const shift = { x: 0, y: 300 };
  const items: BlockLayout['items'] = {};
  for (const id of ['API', 'Worker', 'DB']) {
    const c = baseCentre(base, id);
    items[id] = { cx: c.x + shift.x, cy: c.y + shift.y, parent: 'VPC' };
  }
  const before = composeGraph(d, base);
  const after = composeGraph(d, base, layoutOf(items));
  const ob = before.origin!;
  const oa = after.origin!;
  const rel = (p: Point, o: Point): Point => ({ x: p.x - o.x, y: p.y - o.y });
  const vb = handle(before, 'VPC');
  const va = handle(after, 'VPC');
  assert.equal(va.w, vb.w);
  assert.equal(va.h, vb.h);
  assert.ok(Math.abs(rel(va, oa).y - rel(vb, ob).y - shift.y) < 0.02);
  for (const [from, to] of [['API', 'DB'], ['Worker', 'DB'], ['API', 'Worker']] as const) {
    const pb = edgeBetween(d, before, from, to).points.map((p) => rel(p, ob));
    const pa = edgeBetween(d, after, from, to).points.map((p) => rel(p, oa));
    assert.equal(pa.length, pb.length, `${from}>${to} keeps its bends`);
    pa.forEach((p, i) => assert.ok(Math.abs(p.x - pb[i]!.x - shift.x) < 0.05 && Math.abs(p.y - pb[i]!.y - shift.y) < 0.05, `${from}>${to} shifted`));
  }
});

test('compose: an elbow edge with a moved end is rerouted orthogonally with at most 3 bends', async () => {
  const code = ['A', 'B', 'C', 'A > B: x', 'B > C', 'A > C'].join('\n');
  const { d, base } = await setup(code, 'flowchart');
  for (const [dx, dy] of [[300, 0], [-200, 40], [30, 260], [0, -300], [-250, -250]] as const) {
    const c = baseCentre(base, 'B');
    const scene = composeGraph(d, base, layoutOf({ B: { cx: c.x + dx, cy: c.y + dy, parent: '' } }));
    for (const [from, to] of [['A', 'B'], ['B', 'C']] as const) {
      const e = edgeBetween(d, scene, from, to);
      assert.ok(orthogonal(e.points), `${from}>${to} (${dx},${dy}) is orthogonal: ${JSON.stringify(e.points)}`);
      assert.ok(e.points.length - 2 <= 3, `${from}>${to} has ${e.points.length - 2} bends`);
      assert.ok(onBorder(e.points[0]!, handle(scene, from)), `${from}>${to} starts on ${from}`);
      assert.ok(onBorder(e.points[e.points.length - 1]!, handle(scene, to)), `${from}>${to} ends on ${to}`);
    }
    // A > C did not move: same route as without the layout, relative to the origin.
    const plain = composeGraph(d, base);
    const rel = (s: Scene) => edgeBetween(d, s, 'A', 'C').points.map((p) => ({ x: Math.round(p.x - s.origin!.x), y: Math.round(p.y - s.origin!.y) }));
    assert.deepEqual(rel(scene), rel(plain));
  }
});

test('compose: parallel edges stay apart and group-to-child edges stay inside the group', async () => {
  const code = ['A', 'B', 'A > B: one', 'A > B: two', 'G {', '  N', '}', 'G > N'].join('\n');
  const { d, base } = await setup(code, 'flowchart');
  const b = baseCentre(base, 'B');
  const n = baseCentre(base, 'N');
  const scene = composeGraph(d, base, layoutOf({ B: { cx: b.x + 250, cy: b.y + 120, parent: '' }, N: { cx: n.x + 200, cy: n.y + 150, parent: 'G' } }));
  const one = edgeBetween(d, scene, 'A', 'B', 0).points;
  const two = edgeBetween(d, scene, 'A', 'B', 1).points;
  assert.notDeepEqual(one, two);
  assert.ok(orthogonal(one) && orthogonal(two));
  const g = handle(scene, 'G');
  const gn = edgeBetween(d, scene, 'G', 'N').points;
  assert.ok(orthogonal(gn));
  for (const p of gn) assert.ok(p.x >= g.x - 0.5 && p.x <= g.x + g.w + 0.5 && p.y >= g.y - 0.5 && p.y <= g.y + g.h + 0.5, 'inside G');
  assert.ok(onBorder(gn[gn.length - 1]!, handle(scene, 'N')), 'ends on N');
});

test('compose: an empty group moves like a node', async () => {
  const { d, base } = await setup(ARCH);
  const c = baseCentre(base, 'Empty');
  const scene = composeGraph(d, base, layoutOf({ Empty: { cx: c.x - 500, cy: c.y, parent: '' } }));
  const h = handle(scene, 'Empty');
  assert.equal(h.moved, true);
  assert.ok(Math.abs(h.x + h.w / 2 - (c.x - 500 + scene.origin!.x)) < 0.02);
});

test('compose: base is not mutated, same code + layout gives the same SVG (snapshot)', async () => {
  const { d, base } = await setup(ARCH);
  const plain = sceneToSvg(composeGraph(d, base));
  const api = baseCentre(base, 'API');
  const u = baseCentre(base, 'U');
  const layout = layoutOf({ API: { cx: api.x + 0.5, cy: api.y + 180, parent: 'VPC' }, U: { cx: u.x, cy: u.y - 120, parent: '' } });
  const a = composeGraph(d, base, layout);
  const b = composeGraph(d, base, layout);
  assert.equal(sceneToSvg(a), sceneToSvg(b));
  assert.equal(sceneToSvg(composeGraph(d, base)), plain);
  const viaRender = await renderDiagram(ARCH, { type: 'cloud-architecture', layout });
  assert.equal(viaRender.svg, sceneToSvg(a));
  snapshot('architecture-overrides', sceneToSvg(a));
  snapshot('architecture-overrides.dark', sceneToSvg(a, { theme: 'dark', background: true }));
});

test('compose: sequence and ERD ignore layout', async () => {
  const layout = layoutOf({ A: { cx: 900, cy: 900, parent: '' } });
  for (const [type, code] of [['sequence', 'A > B: hi'], ['erd', 'A {\n  id int\n}']] as const) {
    const plain = await renderDiagram(code, { type });
    const moved = await renderDiagram(code, { type, layout });
    assert.equal(moved.svg, plain.svg);
  }
});

test('performance: 100-node compose + SVG under 16 ms', async () => {
  const lines: string[] = [];
  for (let g = 0; g < 5; g++) {
    lines.push(`G${g} [icon: aws] {`);
    for (let i = 0; i < 20; i++) lines.push(`  N${g}_${i} [icon: server]`);
    lines.push('}');
  }
  for (let g = 0; g < 5; g++) for (let i = 0; i < 19; i++) lines.push(`N${g}_${i} > N${(g + (i % 3 === 0 ? 1 : 0)) % 5}_${i + 1}: e${i}`);
  const { d, base } = await setup(lines.join('\n'));
  const items: BlockLayout['items'] = {};
  for (let i = 0; i < 20; i += 2) {
    const c = baseCentre(base, `N2_${i}`);
    items[`N2_${i}`] = { cx: c.x + 37, cy: c.y - 55, parent: 'G2' };
  }
  const layout = layoutOf(items);
  sceneToSvg(composeGraph(d, base, layout)); // warm-up (JIT)
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    sceneToSvg(composeGraph(d, base, layout));
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[4]! < (process.env.CI ? 48 : 16), `median ${times[4]!.toFixed(1)} ms`);
});
