// E38: unconnected nodes and groups go in grids (docs/research/eraser/09-examples-style.md §1.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { graphBase } from '../../shared/render/index.ts';
import type { GraphBase } from '../../shared/render/index.ts';
import { gridColumns } from '../../shared/render/layout-graph.ts';

async function base(code: string, type: 'flowchart' | 'cloud-architecture' = 'flowchart'): Promise<GraphBase> {
  const { ast } = parse(code, type);
  assert.ok(ast.type === type);
  return graphBase(ast);
}
const rect = (b: GraphBase, id: string) => b.rects.get(id)!;
const right = (r: { x: number; w: number }) => r.x + r.w;
const bottom = (r: { y: number; h: number }) => r.y + r.h;

function assertNoOverlap(b: GraphBase, ids: string[]): void {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const p = rect(b, ids[i]!);
      const q = rect(b, ids[j]!);
      const apart = right(p) <= q.x || right(q) <= p.x || bottom(p) <= q.y || bottom(q) <= p.y;
      assert.ok(apart, `${ids[i]} and ${ids[j]} overlap`);
    }
  }
}

test('grid: one row up to five cells, then about 3:2 wide, never more than five columns', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9, 12, 30].map(gridColumns), [1, 2, 3, 4, 5, 3, 4, 4, 5, 5]);
});

test('grid: unconnected nodes in a group fill rows first, 16 across and 12 down', async () => {
  const b = await base(['direction down', 'G {', '  A', '  B', '  C', '  D', '  E', '  F', '}'].join('\n'));
  const [a, bb, c, d] = ['A', 'B', 'C', 'D'].map((id) => rect(b, id));
  assert.equal(a!.y, bb!.y, 'A and B share the first row');
  assert.equal(bb!.y, c!.y);
  assert.equal(bb!.x - right(a!), 16);
  assert.equal(d!.x, a!.x, 'D starts the second row');
  assert.equal(d!.y - bottom(a!), 12);
  const g = rect(b, 'G');
  assert.equal(a!.x - g.x, 16, 'group side padding still applies');
});

test('grid: unconnected sibling groups stack as bands 12 apart, in either direction', async () => {
  const row = (name: string) => [`${name} {`, ...[1, 2, 3, 4, 5].map((i) => `  ${name}${i}`), '}'];
  for (const dir of ['right', 'down']) {
    const b = await base([`direction ${dir}`, ...row('P'), ...row('Q'), ...row('R')].join('\n'));
    const [p, q, r] = ['P', 'Q', 'R'].map((id) => rect(b, id));
    assert.equal(p!.x, q!.x, `${dir}: bands line up on the left`);
    assert.equal(q!.y - bottom(p!), 12, `${dir}: 12 between bands`);
    assert.equal(r!.y - bottom(q!), 12);
    assert.equal(rect(b, 'P1').y, rect(b, 'P5').y, `${dir}: each band is one row`);
  }
});

test('grid: small unconnected groups share rows instead of making a tall bar', async () => {
  const groups = ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((g) => [`${g}g {`, `  ${g}1`, '}']);
  const b = await base(['direction down', ...groups].join('\n'));
  const ys = new Set(['Ag', 'Bg', 'Cg', 'Dg', 'Eg', 'Fg'].map((id) => rect(b, id).y));
  assert.ok(ys.size < 6, 'more than one group per row');
  assertNoOverlap(b, ['Ag', 'Bg', 'Cg', 'Dg', 'Eg', 'Fg']);
});

test('grid: the unconnected rest of a partly connected group sits in one row after the linked part', async () => {
  const b = await base(['direction right', 'G {', '  A', '  B', '  C', '  D', '  E', '}', 'A > B'].join('\n'));
  const [a, bb, c, d, e] = ['A', 'B', 'C', 'D', 'E'].map((id) => rect(b, id));
  assert.ok(c!.x >= right(bb!) - 1e-6 || c!.x >= right(a!), 'C is not in the first layer');
  assert.equal(c!.y, d!.y);
  assert.equal(d!.y, e!.y);
  assert.equal(d!.x - right(c!), 16);
  assertNoOverlap(b, ['A', 'B', 'C', 'D', 'E']);
  const g = rect(b, 'G');
  for (const r of [a, bb, c, d, e]) assert.ok(r!.x >= g.x && right(r!) <= right(g) && bottom(r!) <= bottom(g), 'inside G');
});

test('grid: unconnected root groups go after the linked content in the flow direction', async () => {
  const code = (dir: string) =>
    [`direction ${dir}`, 'U', 'W', 'Hub {', '  S', '  T', '}', 'Cloud {', '  L', '  M', '}', 'SaaS {', '  N', '  O', '}', 'U > W', 'W > S', 'S > T'].join('\n');
  const linked = ['U', 'W', 'Hub'];
  const r = await base(code('right'));
  const edge = Math.max(...linked.map((id) => right(rect(r, id))));
  assert.equal(Math.min(rect(r, 'Cloud').x, rect(r, 'SaaS').x) - edge, 48, 'right: 48 after the rightmost linked item');
  const dn = await base(code('down'));
  const low = Math.max(...linked.map((id) => bottom(rect(dn, id))));
  assert.equal(Math.min(rect(dn, 'Cloud').y, rect(dn, 'SaaS').y) - low, 48, 'down: 48 under the lowest linked item');
  const lf = await base(code('left'));
  const left = Math.min(...linked.map((id) => rect(lf, id).x));
  assert.equal(left - Math.max(right(rect(lf, 'Cloud')), right(rect(lf, 'SaaS'))), 48, 'left: 48 before the leftmost linked item');
});

test('grid: an unconnected group keeps the edges inside it, routed inside its box', async () => {
  const b = await base(['direction right', 'A > B', 'Free {', '  X', '  Y', '}', 'Other {', '  Z', '}', 'X > Y'].join('\n'));
  const e = b.edges.find((be) => be.edge.from === 'X' && be.edge.to === 'Y');
  assert.ok(e, 'X > Y is laid out');
  const g = rect(b, 'Free');
  for (const p of e.points) assert.ok(p.x >= g.x && p.x <= right(g) && p.y >= g.y && p.y <= bottom(g), 'route inside Free');
  assert.ok(right(rect(b, 'X')) <= rect(b, 'Y').x, 'X before Y');
});

test('grid: nested unconnected groups lay out on their own and do not overlap', async () => {
  const b = await base(['direction down', 'Outer {', '  In1 {', '    a', '    b', '  }', '  In2 {', '    c', '  }', '  d', '}', 'Lone {', '  e', '}'].join('\n'));
  assertNoOverlap(b, ['In1', 'In2', 'd']);
  assertNoOverlap(b, ['Outer', 'Lone']);
  const o = rect(b, 'Outer');
  for (const id of ['In1', 'In2', 'd', 'a', 'b', 'c']) {
    const r = rect(b, id);
    assert.ok(r.x >= o.x && right(r) <= right(o) && r.y >= o.y && bottom(r) <= bottom(o), `${id} inside Outer`);
  }
});

test('grid: a root node with no edges does not size the sources it used to share layer 0 with', async () => {
  const long = 'A free-standing note with a long label that needs the widest bucket to fit';
  const b = await base(['direction right', 'A > B', long, 'Short note'].join('\n'));
  assert.equal(rect(b, 'A').w, 160, 'A keeps its own bucket');
  assert.equal(rect(b, 'Short note').w, rect(b, long).w, 'the root grid shares one size');
});

test('grid: a node with only a self loop stays with ELK', async () => {
  const b = await base(['direction down', 'G {', '  A', '  B', '  C', '}', 'A > A'].join('\n'));
  assert.ok(b.edges.some((be) => be.edge.from === 'A' && be.edge.to === 'A'), 'self loop routed');
});
