// Orthogonal route around boxes for edges that cross a divider row (#244, spec §2.1): the rows stack in
// source order, so an edge across them can run against the flow (a loop back to an earlier phase) or meet
// the divider's label head on. A shortest path with a bend penalty on a grid built from the boxes' sides.

import type { Point } from './scene.ts';
import type { Rect } from './layout-align.ts';

/** Clearance kept from every box (and from the edge's own ends, past the first stub). */
export const ROUTE_GAP = 12;
/** Cost of one bend, in px of length: two bends around a box beat four through a narrow gap. */
const BEND = 48;

type Dir = 0 | 1 | 2 | 3; // right, down, left, up
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

const inside = (r: Rect, x: number, y: number): boolean => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

/** Off-centre port tracks, for when another line already leaves the middle of a side. */
const PORT_SHIFT = 16;
/** Cost of an off-centre port. */
const SHIFT_COST = 24;

interface Port {
  at: Point;
  out: Point;
  dir: Dir;
  cost: number;
}

/** Side ports of `r` (the middle of each side, or a track beside it): the point ROUTE_GAP out and the outward direction. */
function ports(r: Rect): Port[] {
  const out: Port[] = [];
  const cx = Math.round(r.x + r.w / 2);
  const cy = Math.round(r.y + r.h / 2);
  const shifts = (len: number): number[] => (len >= 4 * PORT_SHIFT ? [0, -PORT_SHIFT, PORT_SHIFT] : [0]);
  for (const s of shifts(r.h)) {
    const cost = ROUTE_GAP + (s ? SHIFT_COST : 0);
    out.push({ at: { x: r.x + r.w, y: cy + s }, out: { x: r.x + r.w + ROUTE_GAP, y: cy + s }, dir: 0, cost });
    out.push({ at: { x: r.x, y: cy + s }, out: { x: r.x - ROUTE_GAP, y: cy + s }, dir: 2, cost });
  }
  for (const s of shifts(r.w)) {
    const cost = ROUTE_GAP + (s ? SHIFT_COST : 0);
    out.push({ at: { x: cx + s, y: r.y + r.h }, out: { x: cx + s, y: r.y + r.h + ROUTE_GAP }, dir: 1, cost });
    out.push({ at: { x: cx + s, y: r.y }, out: { x: cx + s, y: r.y - ROUTE_GAP }, dir: 3, cost });
  }
  return out;
}

/** Whether the axis-aligned move p-q runs along (not across) one of `lines` for more than a pixel. */
function alongLine(lines: readonly Point[][], p: Point, q: Point): boolean {
  const flat = p.y === q.y;
  const lo = flat ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
  const hi = flat ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
  for (const line of lines) {
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1]!;
      const b = line[k]!;
      if (flat ? Math.abs(a.y - b.y) > 0.5 || Math.abs(a.y - p.y) > 1 : Math.abs(a.x - b.x) > 0.5 || Math.abs(a.x - p.x) > 1) continue;
      const l2 = flat ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
      const h2 = flat ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      if (Math.min(hi, h2) - Math.max(lo, l2) > 1) return true;
    }
  }
  return false;
}

/** Sorted distinct values plus the midpoint between each neighbouring pair (centred channels). */
function axis(values: number[]): number[] {
  const v = [...new Set(values.map((n) => Math.round(n * 2) / 2))].sort((p, q) => p - q);
  const out: number[] = [];
  v.forEach((n, i) => {
    out.push(n);
    if (i + 1 < v.length) out.push((n + v[i + 1]!) / 2);
  });
  return out;
}

/**
 * Route from box `a` to box `b`, leaving and entering at a side's middle, never through `blocks` (other
 * nodes, groups, divider labels; kept ROUTE_GAP away), never along a `band` (a divider's line: crossing it
 * is fine, running on it is not), and inside `bounds`. Fewest bends first, then shortest. Undefined when no
 * route exists. It never runs along one of `lines` (the other edges' routes); crossing them is fine.
 * `channels` adds grid lines to route on, where the boxes' sides offer none (an empty gap between rows).
 */
export function routeAround(
  a: Rect,
  b: Rect,
  blocks: readonly Rect[],
  bands: readonly Rect[],
  bounds: Rect,
  lines: readonly Point[][] = [],
  channels: { xs?: readonly number[]; ys?: readonly number[] } = {},
): Point[] | undefined {
  const walls = [...blocks, a, b].map((r) => grow(r, ROUTE_GAP));
  const from = ports(a);
  const to = ports(b);
  const xs = axis([bounds.x, bounds.x + bounds.w, ...walls.flatMap((r) => [r.x, r.x + r.w]), ...from.map((p) => p.out.x), ...to.map((p) => p.out.x), ...(channels.xs ?? [])])
    .filter((x) => x >= bounds.x && x <= bounds.x + bounds.w);
  const inBand = (x: number, y: number): boolean => bands.some((r) => x >= r.x && x <= r.x + r.w && y > r.y && y < r.y + r.h);
  const ys = axis([bounds.y, bounds.y + bounds.h, ...walls.flatMap((r) => [r.y, r.y + r.h]), ...from.map((p) => p.out.y), ...to.map((p) => p.out.y), ...(channels.ys ?? [])])
    .filter((y) => y >= bounds.y && y <= bounds.y + bounds.h);
  const xi = new Map(xs.map((x, i) => [x, i]));
  const yi = new Map(ys.map((y, i) => [y, i]));
  const W = xs.length;
  const free = (x: number, y: number): boolean => !walls.some((r) => inside(r, x, y));
  const key = (i: number, j: number, d: Dir): number => ((j * W + i) << 2) | d;
  const cost = new Map<number, number>();
  const prev = new Map<number, number>();
  // A small binary heap of [cost, state].
  const heap: [number, number][] = [];
  const push = (c: number, s: number): void => {
    heap.push([c, s]);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  const relax = (s: number, c: number, p: number): void => {
    if (c < (cost.get(s) ?? Infinity)) {
      cost.set(s, c);
      prev.set(s, p);
      push(c, s);
    }
  };
  // A start state's predecessor is -1 - (index of its port in `from`).
  from.forEach((p, k) => {
    const i = xi.get(Math.round(p.out.x * 2) / 2);
    const j = yi.get(Math.round(p.out.y * 2) / 2);
    if (i === undefined || j === undefined || !free(p.out.x, p.out.y) || alongLine(lines, p.at, p.out)) return;
    relax(key(i, j, p.dir), p.cost, -1 - k);
  });
  const goals = new Map<number, (typeof to)[number]>();
  for (const p of to) {
    const i = xi.get(Math.round(p.out.x * 2) / 2);
    const j = yi.get(Math.round(p.out.y * 2) / 2);
    if (i !== undefined && j !== undefined && free(p.out.x, p.out.y) && !alongLine(lines, p.at, p.out)) goals.set(j * W + i, p);
  }
  let best: { state: number; cost: number; port: (typeof to)[number] } | undefined;
  while (heap.length) {
    const [c, s] = pop();
    if (c > (cost.get(s) ?? Infinity)) continue;
    if (best && c >= best.cost) break;
    const cell = s >> 2;
    const d = (s & 3) as Dir;
    const i = cell % W;
    const j = Math.floor(cell / W);
    const goal = goals.get(cell);
    if (goal) {
      // Arrive heading into b: opposite to the port's outward direction.
      const total = c + goal.cost + (d === (goal.dir + 2) % 4 ? 0 : BEND);
      if (!best || total < best.cost) best = { state: s, cost: total, port: goal };
    }
    for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
      if (nd === (d + 2) % 4) continue;
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= W || nj >= ys.length) continue;
      const x0 = xs[i]!;
      const y0 = ys[j]!;
      const x1 = xs[ni]!;
      const y1 = ys[nj]!;
      if (!free(x1, y1) || !free((x0 + x1) / 2, (y0 + y1) / 2)) continue;
      if (DY[nd] === 0 && inBand((x0 + x1) / 2, y0)) continue;
      if (alongLine(lines, { x: x0, y: y0 }, { x: x1, y: y1 })) continue;
      relax(key(ni, nj, nd), c + Math.abs(x1 - x0) + Math.abs(y1 - y0) + (nd === d ? 0 : BEND), s);
    }
  }
  if (!best) return undefined;
  const path: Point[] = [best.port.at];
  let s = best.state;
  for (;;) {
    const cell = s >> 2;
    path.push({ x: xs[cell % W]!, y: ys[Math.floor(cell / W)]! });
    const p = prev.get(s)!;
    if (p < 0) {
      path.push(from[-1 - p]!.at);
      break;
    }
    s = p;
  }
  path.reverse();
  // Drop points in the middle of a straight run.
  return path.filter((p, k) => {
    if (k === 0 || k === path.length - 1) return true;
    const q = path[k - 1]!;
    const r = path[k + 1]!;
    return !((q.x === p.x && p.x === r.x) || (q.y === p.y && p.y === r.y));
  });
}
