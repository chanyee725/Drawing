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
  const long = 'A rather long label that keeps going and going until only the widest bucket holds it in three lines';
  const b = await base(['direction right', 'G1 {', '  A', '}', 'G2 {', `  ${long}`, '}'].join('\n'));
  assert.deepEqual([rect(b, 'A').w, rect(b, 'A').h], [160, 52]);
  const g = b.nodes.get(long)!;
  assert.equal(g.w, 260);
  assert.ok(g.label.lines.length > 1 && g.label.lines.length <= 3, 'wraps within three lines');
});

test('layout: a label wraps up to three lines before the node moves up a bucket', async () => {
  const two = 'Order fulfilment service';
  const three = 'A reasonably long label for three lines total here';
  const b = await base(['direction right', 'G1 {', `  ${two}`, '}', 'G2 {', `  ${three}`, '}'].join('\n'));
  assert.equal(b.nodes.get(two)!.w, 160);
  assert.equal(b.nodes.get(two)!.label.lines.length, 2);
  assert.equal(b.nodes.get(three)!.w, 160);
  assert.equal(b.nodes.get(three)!.label.lines.length, 3);
});

test('layout: box heights 52 for one line, 56 for two, growing with a third', async () => {
  const two = 'Order fulfilment service';
  const three = 'A reasonably long label for three lines total here';
  const b = await base(['direction right', 'G1 {', `  ${two}`, '}', 'G2 {', `  ${three}`, '}', 'G3 {', `  M [textSize: medium]`, '}', 'G4 {', `  ${two} m [textSize: medium]`, '}'].join('\n'));
  assert.equal(rect(b, two).h, 56);
  assert.equal(rect(b, three).h, 66, 'three 13 px lines (54) + 12');
  assert.equal(rect(b, 'M').h, 52);
  assert.equal(rect(b, `${two} m`).h, 56, 'two 16 px lines (44) + 12');
});

test('layout: the root is not one group; root-level boxes share a size only within a layer', async () => {
  const long = 'A rather long label that keeps going and going';
  const b = await base(['direction right', 'A', 'B', 'C', long, `A > ${long}`, 'B > C'].join('\n'));
  assert.deepEqual([rect(b, 'A').w, rect(b, 'A').h], [160, 52], 'first layer keeps its own size');
  assert.deepEqual([rect(b, 'B').w, rect(b, 'B').h], [160, 52]);
  assert.equal(rect(b, long).h, 66);
  assert.deepEqual([rect(b, 'C').w, rect(b, 'C').h], [rect(b, long).w, rect(b, long).h], 'same layer, same size');
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

test('layout: siblings in a parent that holds groups are 48 apart, also in a horizontal flow', async () => {
  // Edges keep the groups out of the free grid (E38), so ELK spaces them.
  const b = await base(['direction right', 'G1 {', '  A', '}', 'G2 {', '  B', '}', 'H {', '  I {', '    C', '  }', '  J {', '    D', '  }', '}', 'X > A', 'X > B', 'X > C', 'X > D'].join('\n'));
  const [g1, g2] = [rect(b, 'G1'), rect(b, 'G2')].sort((p, q) => p.y - q.y);
  assert.equal(g2!.y - (g1!.y + g1!.h), 48);
  const [i, j] = [rect(b, 'I'), rect(b, 'J')].sort((p, q) => p.y - q.y);
  assert.equal(j!.y - (i!.y + i!.h), 48);
});
