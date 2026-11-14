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

test('compose: a dragged elbow edge goes around the nodes its elbow would cut (#255)', async () => {
  const code = ['A > B > C', 'D', 'A > D'].join('\n');
  const { d, base } = await setup(code, 'flowchart');
  const cuts = (r: SceneHandle, p: Point, q: Point): boolean =>
    Math.max(p.x, q.x) > r.x + 0.5 && Math.min(p.x, q.x) < r.x + r.w - 0.5 && Math.max(p.y, q.y) > r.y + 0.5 && Math.min(p.y, q.y) < r.y + r.h - 0.5;
  const c = baseCentre(base, 'C');
  const b = baseCentre(base, 'B');
  // A dropped right of C on its row (its elbow to B runs through C), below B, and just off C's row.
  /** Length two segments share on one line (both horizontal or both vertical, within a pixel). */
  const shared = (p: Point, q: Point, r: Point, t: Point): number => {
    const flat = p.y === q.y && r.y === t.y;
    if (flat ? Math.abs(p.y - r.y) > 1 : !(p.x === q.x && r.x === t.x && Math.abs(p.x - r.x) <= 1)) return 0;
    const [lo, hi, lo2, hi2] = flat ? [p.x, q.x, r.x, t.x] : [p.y, q.y, r.y, t.y];
    return Math.min(Math.max(lo, hi), Math.max(lo2, hi2)) - Math.max(Math.min(lo, hi), Math.min(lo2, hi2));
  };
  for (const at of [{ x: c.x + 260, y: c.y }, { x: b.x, y: b.y + 220 }, { x: c.x + 260, y: c.y + 8 }]) {
    const scene = composeGraph(d, base, layoutOf({ A: { cx: at.x, cy: at.y, parent: '' } }));
    // The rerouted A > B keeps off B > C, whose ends did not move.
    const ab = edgeBetween(d, scene, 'A', 'B').points;
    const bc = edgeBetween(d, scene, 'B', 'C').points;
    for (let k = 1; k < ab.length; k++) {
      for (let m = 1; m < bc.length; m++) assert.ok(shared(ab[k - 1]!, ab[k]!, bc[m - 1]!, bc[m]!) <= 1, `A at ${JSON.stringify(at)}: A>B runs along B>C: ${JSON.stringify([ab, bc])}`);
    }
    for (const e of edges(scene)) {
      assert.ok(orthogonal(e.points), `${e.from}>${e.to} orthogonal`);
      assert.ok(onBorder(e.points[0]!, handle(scene, e.from)), `${e.from}>${e.to} starts on ${e.from}`);
      assert.ok(onBorder(e.points[e.points.length - 1]!, handle(scene, e.to)), `${e.from}>${e.to} ends on ${e.to}`);
      for (const h of scene.handles!) {
        if (h.id === e.from || h.id === e.to) continue;
        for (let k = 1; k < e.points.length; k++) {
          assert.ok(!cuts(h, e.points[k - 1]!, e.points[k]!), `A at ${JSON.stringify(at)}: ${e.from}>${e.to} runs through ${h.id}: ${JSON.stringify(e.points)}`);
        }
      }
    }
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

/**
 * Fixed pure-JS workload (objects, Map, sort, typed arrays), timed right before each compose in the same process.
 * It allocates like compose does (typed-array grids next to small objects), so GC and cache pressure from other
 * processes slow both by about the same factor, and a real slowdown of compose + SVG still moves the ratio (same
 * method as the 100-node layout test in render.test.ts).
 */
function reference(): number {
  let sum = 0;
  for (let r = 0; r < 12; r++) {
    const m = new Map<string, { id: string; x: number; y: number[] }>();
    const a: { id: string; x: number; y: number[] }[] = [];
    for (let i = 0; i < 4000; i++) {
      const o = { id: `n${(i * 7919) % 4000}`, x: (i * 31) % 997, y: [i, i + 1] };
      a.push(o);
      m.set(o.id, o);
    }
    a.sort((p, q) => p.x - q.x || p.y[0]! - q.y[0]!);
    for (const o of a) sum += m.get(o.id)!.y[1]! & 7;
    const grid = new Uint8Array(160 * 120 * 4);
    for (let i = r; i < grid.length; i += 7) grid[i] = i & 255;
    sum += grid[grid.length - 1 - r]!;
  }
  return sum;
}

/**
 * CPU time of `fn` in ms. Unlike wall time it does not count the time this process waits for a core, which is
 * what made the wall-clock ratio jump past the budget when the machine runs several sessions (load 80 on 32 cores).
 */
function cpuMs(fn: () => unknown): number {
  const t0 = process.cpuUsage();
  fn();
  const d = process.cpuUsage(t0);
  return (d.user + d.system) / 1000;
}

// CPU-time ratio of compose + SVG of the diagram below to the reference, at the machine's usual load (~30-50 on 32
// cores): about 0.55 (0.4 before the slower textWidth of #300, see #311); with 40 extra busy loops 0.5-0.65 and once
// 0.81, which the next round measured at 0.53. A 3x slower compose measured 0.83-1.5 in every round and failed.
// A round over budget is measured again (at most 3 rounds): a burst of load can spoil one round, not all three.
const MAX_RATIO = 0.8;
const ROUNDS = 3;

test(`performance: 100-node compose + SVG under ${MAX_RATIO}x a fixed reference workload`, async () => {
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
  const compose = () => sceneToSvg(composeGraph(d, base, layout));
  for (let i = 0; i < 3; i++) {
    compose(); // warm-up (JIT)
    reference();
  }
  const seen: string[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    let comp = Infinity;
    let ref = Infinity;
    for (let i = 0; i < 9; i++) {
      ref = Math.min(ref, cpuMs(reference));
      comp = Math.min(comp, cpuMs(compose));
    }
    const ratio = comp / ref;
    seen.push(`${ratio.toFixed(2)}x (compose ${comp.toFixed(1)} ms, reference ${ref.toFixed(1)} ms)`);
    if (ratio < MAX_RATIO) return;
  }
  assert.fail(`compose + SVG over ${MAX_RATIO}x the reference in all ${ROUNDS} rounds: ${seen.join('; ')}`);
});
