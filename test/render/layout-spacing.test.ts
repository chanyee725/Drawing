// E36: Eraser-like node size buckets, group padding and spacing (docs/research/eraser/09-examples-style.md §1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { graphBase } from '../../shared/render/index.ts';
import type { GraphBase } from '../../shared/render/index.ts';

async function base(code: string): Promise<GraphBase> {
  const { ast } = parse(code, 'flowchart');
  assert.ok(ast.type === 'flowchart');
  return graphBase(ast);
}
const rect = (b: GraphBase, id: string) => b.rects.get(id)!;

test('layout: box widths come from the 160 / 200 / 260 buckets, one-line height 52', async () => {
  const b = await base(['direction right', 'G1 {', '  A', '}', 'G2 {', '  Order fulfilment service', '}', 'G3 {', '  A rather long label that keeps going and going until only the widest bucket holds it in three lines', '}'].join('\n'));
  assert.deepEqual([rect(b, 'A').w, rect(b, 'A').h], [160, 52]);
  assert.deepEqual([rect(b, 'Order fulfilment service').w, rect(b, 'Order fulfilment service').h], [200, 52]);
  const long = b.nodes.get('A rather long label that keeps going and going until only the widest bucket holds it in three lines')!;
  assert.equal(long.w, 260);
  assert.ok(long.label.lines.length > 1 && long.label.lines.length <= 3, 'wraps within three lines');
});

test('layout: box nodes that share a parent get one size, other shapes keep theirs', async () => {
  const b = await base(['G {', '  A', '  Order fulfilment service', '  Q [shape: diamond]', '}', 'A > Q'].join('\n'));
  assert.equal(rect(b, 'A').w, rect(b, 'Order fulfilment service').w);
  assert.equal(rect(b, 'A').h, rect(b, 'Order fulfilment service').h);
  assert.notEqual(rect(b, 'Q').w, rect(b, 'A').w);
});

test('layout: group padding 16 / 40 / 16 / 14 and 56 between layers inside a group', async () => {
  const b = await base(['direction down', 'G {', '  A', '  B', '}', 'A > B'].join('\n'));
  const g = rect(b, 'G');
  const a = rect(b, 'A');
  const bb = rect(b, 'B');
  assert.equal(a.x - g.x, 16);
  assert.equal(a.y - g.y, 40);
  assert.equal(g.x + g.w - (a.x + a.w), 16);
  assert.equal(g.y + g.h - (bb.y + bb.h), 14);
  assert.equal(bb.y - (a.y + a.h), 56);
});

test('layout: same-layer neighbours 40 apart in a vertical flow, list items 12 apart in a horizontal one', async () => {
  const down = await base(['direction down', 'R', 'A', 'B', 'R > A', 'R > B'].join('\n'));
  const [l, r] = [rect(down, 'A'), rect(down, 'B')].sort((p, q) => p.x - q.x);
  assert.equal(r!.x - (l!.x + l!.w), 40);
  const right = await base(['direction right', 'R', 'A', 'B', 'R > A', 'R > B'].join('\n'));
  const [t, u] = [rect(right, 'A'), rect(right, 'B')].sort((p, q) => p.y - q.y);
  assert.equal(u!.y - (t!.y + t!.h), 12);
});
