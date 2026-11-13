// E37: alignment, order and band post-processing (docs/research/eraser/09-examples-style.md §1.2, §1.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { graphBase } from '../../shared/render/index.ts';
import type { GraphBase } from '../../shared/render/index.ts';
import { moveEnd, orthogonalize } from '../../shared/render/layout-align.ts';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from '../../shared/render/elk.ts';

const FORCE = 'elk.layered.crossingMinimization.forceNodeModelOrder';

async function base(code: string): Promise<GraphBase> {
  const { ast } = parse(code, 'flowchart');
  assert.ok(ast.type === 'flowchart');
  return graphBase(ast);
}
const rect = (b: GraphBase, id: string) => b.rects.get(id)!;
const cx = (b: GraphBase, id: string) => rect(b, id).x + rect(b, id).w / 2;
const cy = (b: GraphBase, id: string) => rect(b, id).y + rect(b, id).h / 2;

function assertOrthogonal(b: GraphBase): void {
  for (const be of b.edges) {
    const p = be.points;
    for (let i = 1; i < p.length; i++) {
      assert.ok(p[i]!.x === p[i - 1]!.x || p[i]!.y === p[i - 1]!.y, `${be.edge.from} -> ${be.edge.to}: ${JSON.stringify(p)}`);
    }
  }
}

test('align: an undirected edge points from the end defined first', async () => {
  const b = await base(['Distribution', 'Access', 'Access - Distribution'].join('\n'));
  assert.ok(rect(b, 'Distribution').y < rect(b, 'Access').y, 'defined first sits in the upper layer');
  const e = b.edges[0]!;
  assert.equal(e.edge.from, 'Access');
  const first = e.points[0]!;
  assert.ok(Math.abs(first.y - rect(b, 'Access').y) < 1, 'route still starts at the `from` end');
  const directed = await base(['Distribution', 'Access', 'Access > Distribution'].join('\n'));
  assert.ok(rect(directed, 'Access').y < rect(directed, 'Distribution').y, 'an arrow still sets the flow');
});

test('align: siblings in one layer stand in source order, inside groups too', async () => {
  const b = await base(['G {', '  D', '  A1', '  A2', '  A3', '  A4', '}', 'A1 - D', 'A2 - D', 'A3 - D', 'A4 - D'].join('\n'));
  const xs = ['A1', 'A2', 'A3', 'A4'].map((id) => rect(b, id).x);
  assert.deepEqual([...xs].sort((a, c) => a - c), xs);
  assertOrthogonal(b);
  const root = await base(['D', 'S3', 'S1', 'S2', 'D > S1', 'D > S2', 'D > S3'].join('\n'));
  const order = ['S3', 'S1', 'S2'].map((id) => rect(root, id).x);
  assert.deepEqual([...order].sort((a, c) => a - c), order, 'root follows definition order, not edge order');
});

test('align: nodes in one layer share a centre along the flow', async () => {
  const b = await base(['A', 'B', 'C [shape: diamond]', 'E [shape: circle]', 'A > B', 'A > C', 'A > E'].join('\n'));
  assert.notEqual(rect(b, 'B').h, rect(b, 'C').h);
  assert.equal(cy(b, 'B'), cy(b, 'C'));
  assert.equal(cy(b, 'B'), cy(b, 'E'));
  assertOrthogonal(b);
});

test('align: sibling groups in one row take one top and height', async () => {
  const b = await base(['R', 'G1 {', '  P', '  Q', '}', 'G2 {', '  Y', '  Z', '  Z2', '}', 'P > Q', 'Y > Z', 'Z > Z2', 'R > P', 'R > Y'].join('\n'));
  assert.equal(rect(b, 'G1').y, rect(b, 'G2').y);
  assert.equal(rect(b, 'G1').h, rect(b, 'G2').h);
  assertOrthogonal(b);
});

test('align: a group under half its row height keeps its own size', async () => {
  const b = await base(['R', 'G1 {', '  P', '}', 'G2 {', '  Y', '  Z', '  Z2', '}', 'Y > Z', 'Z > Z2', 'R > P', 'R > Y'].join('\n'));
  assert.ok(rect(b, 'G1').h < rect(b, 'G2').h / 2);
});

test('align: stacked bands take one width and share their columns', async () => {
  // Two edges, so neither group has two free children (those would go in an E38 grid, not one row).
  // E sits under B, the second column, not under its source C.
  const b = await base(['G1 {', '  A', '  B', '  C', '}', 'G2 {', '  D', '  E', '}', 'A > D', 'C > E'].join('\n'));
  assert.ok(rect(b, 'G1').y + rect(b, 'G1').h <= rect(b, 'G2').y, 'stacked');
  assert.equal(rect(b, 'G1').x, rect(b, 'G2').x);
  assert.equal(rect(b, 'G1').w, rect(b, 'G2').w);
  assert.equal(cx(b, 'A'), cx(b, 'D'));
  assert.equal(cx(b, 'B'), cx(b, 'E'));
  for (const id of ['A', 'B', 'C']) {
    const r = rect(b, id);
    const g = rect(b, 'G1');
    assert.ok(r.x >= g.x + 16 && r.x + r.w <= g.x + g.w - 16, `${id} keeps the side padding`);
  }
  assertOrthogonal(b);
});

test('align: root nodes without edges keep their own size', async () => {
  const long = 'A rather long label that keeps going and going';
  const b = await base(['A', 'B', long, 'A > B'].join('\n'));
  assert.deepEqual([rect(b, 'A').w, rect(b, 'A').h], [160, 52]);
  assert.deepEqual([rect(b, 'B').w, rect(b, 'B').h], [160, 52], 'not matched to the free-standing long note');
});

test('align: moveEnd keeps a route orthogonal; orthogonalize removes sub-pixel jogs', () => {
  const z = moveEnd([{ x: 0, y: 0 }, { x: 0, y: 100 }], false, 30, 0);
  assert.deepEqual(z, [{ x: 30, y: 0 }, { x: 30, y: 50 }, { x: 0, y: 50 }, { x: 0, y: 100 }]);
  const l = moveEnd([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 80, y: 50 }], true, 0, 10);
  assert.deepEqual(l, [{ x: 0, y: 0 }, { x: 0, y: 60 }, { x: 80, y: 60 }]);
  assert.deepEqual(orthogonalize([{ x: 10, y: 0 }, { x: 10.3, y: 40 }, { x: 60, y: 40.4 }]), [{ x: 10, y: 0 }, { x: 10, y: 40 }, { x: 60, y: 40 }]);
});

// E37 x E38: alignment and sizes around grids (spec §1.1, §1.2 exception, §1.3, §1.4).

test('merge: only root nodes placed in the grid share one size; a lone free node keeps its own', async () => {
  const long = 'A free-standing note with a long label that needs the widest bucket to fit';
  const grid = await base(['A > B', long, 'Short note'].join('\n'));
  assert.equal(rect(grid, 'Short note').w, rect(grid, long).w, 'grid cells share one size');
  assert.equal(rect(grid, 'A').w, 160, 'linked nodes are not matched to the grid');
  const lone = await base(['A > B', long].join('\n'));
  assert.equal(rect(lone, 'A').w, 160);
  assert.ok(rect(lone, long).w > 160, 'one free node is not a grid: it keeps its own size');
});

test('merge: stacked grid bands keep their fitted widths and left edge, not widened or centred', async () => {
  const band = (name: string, n: number) => [`${name} {`, ...Array.from({ length: n }, (_, i) => `  ${name}${i + 1}`), '}'];
  for (const dir of ['down', 'right']) {
    const b = await base([`direction ${dir}`, ...band('P', 5), ...band('Q', 4), ...band('R', 3)].join('\n'));
    const [p, q, r] = ['P', 'Q', 'R'].map((id) => rect(b, id));
    assert.ok(p!.w > q!.w && q!.w > r!.w, `${dir}: widths follow the child count (${p!.w}, ${q!.w}, ${r!.w})`);
    assert.equal(q!.x, p!.x, `${dir}: left aligned`);
    assert.equal(r!.x, p!.x);
    assert.equal(rect(b, 'Q1').x - q!.x, 16, `${dir}: content starts at the side padding, not centred`);
    assert.equal(rect(b, 'R1').x - r!.x, 16);
  }
  // A group with an edge whose children are all grid cells is not banded with its neighbour either.
  const linked = await base([...band('P', 5), ...band('Q', 3), 'P > Q'].join('\n'));
  const [p, q] = ['P', 'Q'].map((id) => rect(linked, id));
  assert.equal(q!.w, 544, `Q keeps the width fitted to its 3 cells (P is ${p!.w})`);
  assert.ok(q!.w < p!.w);
  assert.equal(rect(linked, 'Q1').x - q!.x, 16, 'cells stay where the grid packed them');
  // A group with both linked children and grid cells: banded, but its cells are not pulled into columns.
  const mixed = await base(['G1 {', '  A', '  B', '  C', '  N1', '  N2', '}', 'G2 {', '  D', '  E', '  N3', '  N4', '}', 'A > D', 'C > E'].join('\n'));
  const boxes = [...mixed.rects].filter(([id]) => !id.startsWith('G'));
  for (const [i, [a, ra]] of boxes.entries()) {
    for (const [c, rc] of boxes.slice(i + 1)) {
      const hit = ra.x < rc.x + rc.w && rc.x < ra.x + ra.w && ra.y < rc.y + rc.h && rc.y < ra.y + ra.h;
      assert.ok(!hit, `${a} and ${c} do not overlap`);
    }
  }
});

test('merge: every ELK run forces model order at its root, never on a group (elkjs 0.12 throws there)', async () => {
  const proto = ELK.prototype as { layout: (g: ElkNode, ...rest: unknown[]) => Promise<ElkNode> };
  const real = proto.layout;
  const runs: ElkNode[] = [];
  proto.layout = function (g, ...rest) {
    runs.push(structuredClone(g));
    return real.call(this, g, ...rest);
  };
  try {
    await base(['A > B', 'Free {', '  X', '  Y', '}', 'Other {', '  Z', '}', 'X > Y', 'N1', 'N2'].join('\n'));
  } finally {
    proto.layout = real;
  }
  assert.ok(runs.length >= 3, `root and each free group run on their own (${runs.length} runs)`);
  const groupsWith = (n: ElkNode): string[] =>
    (n.children ?? []).flatMap((c) => [...(c.children && c.layoutOptions?.[FORCE] !== undefined ? [c.id] : []), ...groupsWith(c)]);
  for (const r of runs) {
    assert.equal(r.layoutOptions?.[FORCE], 'true', 'root forces model order');
    assert.equal(r.layoutOptions?.['elk.layered.considerModelOrder.strategy'], 'NODES_AND_EDGES');
    assert.deepEqual(groupsWith(r), [], 'no group carries the option');
  }
});

test('merge: ELK itself keeps source order in the root run (forceNodeModelOrder, before any post-processing)', async () => {
  const proto = ELK.prototype as { layout: (g: ElkNode, ...rest: unknown[]) => Promise<ElkNode> };
  const real = proto.layout;
  const outs: ElkNode[] = [];
  proto.layout = function (g, ...rest) {
    return real.call(this, g, ...rest).then((o) => (outs.push(structuredClone(o)), o));
  };
  try {
    await base(['D', 'S3', 'S1', 'S2', 'D > S1', 'D > S2', 'D > S3', 'Note 1', 'Note 2'].join('\n'));
  } finally {
    proto.layout = real;
  }
  const kids = outs[0]!.children ?? [];
  const xs = ['S3', 'S1', 'S2'].map((id) => kids.find((k) => k.id === `n:${id}`)!.x!);
  assert.deepEqual([...xs].sort((a, c) => a - c), xs, `raw ELK x: ${JSON.stringify(xs)}`);
});

test('merge: a free group run gets source order back after ELK (alignLayout reorder)', async () => {
  // ELK swaps X and Y here to untangle the edges; ELK does not honour model order inside a group.
  const b = await base(['Free {', '  A', '  B', '  X', '  Y', '}', 'Other {', '  Z', '}', 'A > Y', 'B > X'].join('\n'));
  assert.ok(rect(b, 'X').x < rect(b, 'Y').x, 'X stands before Y, as written');
  assertOrthogonal(b);
});
