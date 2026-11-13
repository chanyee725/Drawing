// E39 / #214 / #241: route overlaps over 151 random flowcharts (fixed seed, so the counts are exact).
// Overlap = two axis-aligned segments on the same line sharing more than 1 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { layoutGraph } from '../../shared/render/layout-graph.ts';
import type { Point, SceneEdge } from '../../shared/render/scene.ts';

/** Longest stretch two axis-aligned segments share on one line (0 when they do not run along each other). */
function sharedRun(p: Point, q: Point, r: Point, s: Point): number {
  const span = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
  if (Math.abs(p.x - q.x) < 0.5 && Math.abs(r.x - s.x) < 0.5 && Math.abs(p.x - r.x) < 1) return span(p.y, q.y, r.y, s.y);
  if (Math.abs(p.y - q.y) < 0.5 && Math.abs(r.y - s.y) < 0.5 && Math.abs(p.y - r.y) < 1) return span(p.x, q.x, r.x, s.x);
  return 0;
}

test('routes fuzz: overlapping runs stay within budget', async () => {
  let seed = 241;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (n: number): number => Math.floor(rnd() * n);
  const unrelated: string[] = [];
  let sharedLong = 0;
  for (let g = 0; g < 151; g++) {
    const n = 4 + pick(9);
    const names = Array.from({ length: n }, (_, i) => `N${i}`);
    const lines: string[] = [];
    if (rnd() < 0.5) lines.push(`direction ${['down', 'right', 'up', 'left'][pick(4)]}`);
    lines.push(...names);
    const seen = new Set<string>();
    const m = n - 1 + pick(n);
    for (let k = 0; k < m; k++) {
      const a = names[pick(n)]!;
      const b = names[pick(n)]!;
      if (a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      lines.push(`${a} > ${b}${rnd() < 0.3 ? `: l${k}` : ''}`);
    }
    const { ast } = parse(lines.join('\n'), 'flowchart');
    assert.ok(ast.type === 'flowchart');
    const ends = new Map(ast.edges.map((e) => [e.id, [e.from, e.to]]));
    const edges = (await layoutGraph(ast)).items.filter((i): i is SceneEdge => i.kind === 'edge');
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const ei = ends.get(edges[i]!.id)!;
        const ej = ends.get(edges[j]!.id)!;
        let run = 0;
        const a = edges[i]!.points;
        const b = edges[j]!.points;
        for (let k = 1; k < a.length; k++) for (let l = 1; l < b.length; l++) run = Math.max(run, sharedRun(a[k - 1]!, a[k]!, b[l - 1]!, b[l]!));
        if (ei.some((id) => ej.includes(id))) {
          if (run > 30) sharedLong++;
        } else if (run > 1) unrelated.push(`graph ${g} ${ei.join('>')} / ${ej.join('>')}: ${Math.round(run)} px`);
      }
    }
  }
  // Budget for lines with no shared end that run along each other: 2 before #214, 4 after it (#241).
  // Cause: the planner checks a new route against routes it keeps, not against other routes planned in
  // the same pass, so two port columns can line up (graphs 58 and 115). #214's bus split gives more lines a port
  // of their own, so this happens more often. Not fixed: rejecting such routes sends edges back to their
  // ELK routes (arrows end up 4 px apart), and preferring other levels moves bus members off their bus
  // (new 200 px jog overlaps). Lower the budget when a fix lands; raise it only with a reason.
  assert.ok(unrelated.length <= 4, `unrelated overlaps:\n${unrelated.join('\n')}`);
  // Budget, not a goal: lines that share a box may share a port and its first stretch, and dense graphs
  // keep some ELK routes. 46 before #214, 33 after it. Raise only with a reason.
  assert.ok(sharedLong <= 33, `shared-end runs over 30 px: ${sharedLong}`);
});
