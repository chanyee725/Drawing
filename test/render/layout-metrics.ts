// Readability counts for a laid-out graph scene, shared by the wrap tests and scripts/capture-group-wrap.mjs.

import type { Scene, SceneBox, SceneEdge } from '../../shared/render/index.ts';

type P = { x: number; y: number };
type Seg = [P, P];

const segs = (e: SceneEdge): Seg[] => e.points.slice(1).map((p, i) => [e.points[i]!, p]);
const flat = ([a, b]: Seg): boolean => Math.abs(a.y - b.y) < 0.5;
const upright = ([a, b]: Seg): boolean => Math.abs(a.x - b.x) < 0.5;
const lo = (a: number, b: number): number => Math.min(a, b);
const hi = (a: number, b: number): number => Math.max(a, b);

/** One horizontal and one vertical segment that cross away from their ends. */
function crosses(s: Seg, t: Seg): boolean {
  const [h, v] = flat(s) && upright(t) ? [s, t] : flat(t) && upright(s) ? [t, s] : [undefined, undefined];
  if (!h || !v) return false;
  const x = v[0].x;
  const y = h[0].y;
  return x > lo(h[0].x, h[1].x) + 1 && x < hi(h[0].x, h[1].x) - 1 && y > lo(v[0].y, v[1].y) + 1 && y < hi(v[0].y, v[1].y) - 1;
}

/** Two parallel segments that run on top of each other for more than 2 px. */
function overlaps(s: Seg, t: Seg): boolean {
  if (flat(s) && flat(t) && Math.abs(s[0].y - t[0].y) < 1) return lo(hi(s[0].x, s[1].x), hi(t[0].x, t[1].x)) - hi(lo(s[0].x, s[1].x), lo(t[0].x, t[1].x)) > 2;
  if (upright(s) && upright(t) && Math.abs(s[0].x - t[0].x) < 1) return lo(hi(s[0].y, s[1].y), hi(t[0].y, t[1].y)) - hi(lo(s[0].y, s[1].y), lo(t[0].y, t[1].y)) > 2;
  return false;
}

function hits(b: SceneBox, [p, q]: Seg): boolean {
  return hi(p.x, q.x) > b.x + 1 && lo(p.x, q.x) < b.x + b.w - 1 && hi(p.y, q.y) > b.y + 1 && lo(p.y, q.y) < b.y + b.h - 1;
}

export interface LayoutMetrics {
  width: number;
  height: number;
  /** Width : height. */
  aspect: number;
  edges: number;
  /** Total bends over all connectors. */
  bends: number;
  /** Pairs of connectors that cross. */
  crossings: number;
  /** Pairs of connectors with no node in common that run on top of each other. */
  overlaps: number;
  /** Connectors that pass through a node that is not one of their ends. */
  throughNodes: number;
  /** Connector labels whose plate touches a node. */
  labelsOnNodes: number;
}

export function layoutMetrics(scene: Scene): LayoutMetrics {
  const edges = scene.items.filter((it): it is SceneEdge => it.kind === 'edge');
  const nodes = scene.items.filter((it): it is SceneBox => it.kind === 'box' && it.role === 'node');
  let crossings = 0;
  let over = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!;
      const b = edges[j]!;
      const sa = segs(a);
      const sb = segs(b);
      if (sa.some((s) => sb.some((t) => crosses(s, t)))) crossings++;
      const shared = a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to;
      if (!shared && sa.some((s) => sb.some((t) => overlaps(s, t)))) over++;
    }
  }
  const throughNodes = edges.filter((e) => nodes.some((n) => n.id !== e.from && n.id !== e.to && segs(e).some((s) => hits(n, s)))).length;
  let labelsOnNodes = 0;
  for (const it of scene.items) {
    if (it.kind !== 'text' || !it.plate) continue;
    const w = Math.max(...it.lines.map((l) => l.length)) * it.size * 0.55 + 12;
    const h = it.lines.length * it.lineHeight + 4;
    const r = { x: it.x - w / 2, y: it.y - 2, w, h };
    if (nodes.some((n) => r.x < n.x + n.w && n.x < r.x + r.w && r.y < n.y + n.h && n.y < r.y + r.h)) labelsOnNodes++;
  }
  return {
    width: scene.width,
    height: scene.height,
    aspect: Math.round((scene.width / scene.height) * 100) / 100,
    edges: edges.length,
    bends: edges.reduce((s, e) => s + Math.max(0, e.points.length - 2), 0),
    crossings,
    overlaps: over,
    throughNodes,
    labelsOnNodes,
  };
}
