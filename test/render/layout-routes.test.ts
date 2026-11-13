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
