import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { layoutDiagram, edgeKey, edgePaths, nodeRects } from '../../shared/render/index.ts';
import type { Scene, SceneEdge } from '../../shared/render/index.ts';

async function scene(code: string): Promise<Scene> {
  const { ast, diagnostics } = parse(code, 'flowchart');
  assert.deepEqual(diagnostics.filter((x) => x.severity === 'error'), []);
  return layoutDiagram(ast);
}

const PIPE = ['plan [label: "Plan"]', 'impl', 'review', 'test', 'merge', 'note [icon: user]', 'plan > impl > review > merge', 'impl > test > merge', 'impl > note'].join('\n');

test('graph edges carry from/to node ids', async () => {
  const s = await scene(PIPE);
  const pairs = s.items.filter((i): i is SceneEdge => i.kind === 'edge').map((e) => [e.from, e.to]);
  assert.deepEqual(pairs.sort(), [['impl', 'note'], ['impl', 'review'], ['impl', 'test'], ['plan', 'impl'], ['review', 'merge'], ['test', 'merge']]);
});

test('nodeRects: one rect per node, icon-only nodes from their handle', async () => {
  const s = await scene(PIPE);
  const r = nodeRects(s);
  assert.deepEqual([...r.keys()].sort(), ['impl', 'merge', 'note', 'plan', 'review', 'test']);
  const box = s.items.find((i) => i.kind === 'box' && i.id === 'impl');
  assert.ok(box && box.kind === 'box');
  assert.deepEqual(r.get('impl'), { x: box.x, y: box.y, w: box.w, h: box.h });
  const h = s.handles!.find((x) => x.id === 'note')!;
  assert.deepEqual(r.get('note'), { x: h.x, y: h.y, w: h.w, h: h.h });
  for (const v of r.values()) assert.ok(v.x >= 0 && v.y >= 0 && v.x + v.w <= s.width && v.y + v.h <= s.height);
});

test('edgePaths: keyed by from/to, stable when lines are reordered', async () => {
  const a = edgePaths(await scene(PIPE));
  const b = edgePaths(await scene(['plan [label: "Plan"]', 'impl', 'review', 'test', 'merge', 'note [icon: user]', 'impl > note', 'impl > test > merge', 'plan > impl > review > merge'].join('\n')));
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  assert.equal(a.get(edgeKey('plan', 'impl'))!.length, 1);
  assert.ok(a.get(edgeKey('plan', 'impl'))![0]!.points.length >= 2);
});

test('edgePaths: filter to step nodes; parallel edges share a key', async () => {
  const s = await scene(['a', 'b', 'c', 'a > b', 'a > b', 'b > c'].join('\n'));
  const all = edgePaths(s);
  assert.equal(all.get(edgeKey('a', 'b'))!.length, 2);
  const only = edgePaths(s, new Set(['a', 'b']));
  assert.deepEqual([...only.keys()], [edgeKey('a', 'b')]);
});

test('edgeKey cannot collide on odd ids', () => {
  assert.notEqual(edgeKey('a>b', 'c'), edgeKey('a', 'b>c'));
});
