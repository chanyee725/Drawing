// Connector routes after alignment (docs/research/eraser/09-examples-style.md §1.7, §1.8 step 6): ports
// dealt out evenly along a side, straight lines first, at most two bends, and a shared bus where one node
// fans out to (or several nodes fan in to) a side.

import type { Point } from './scene.ts';
import type { Rect } from './layout-align.ts';

/** How far from its node a fan's shared bus runs (spec §1.7: 24 px out of the source). */
export const BUS_GAP = 24;
/** Shortest first and last segment of a rerouted edge. */
const MIN_STUB = 8;
/** A port stays at least this far from a side's corners (the corner is rounded). */
const CORNER_MARGIN = 12;
/** Parallel horizontal runs that would overlap at one level are staggered this far apart (spec §1.7: ~5 px). */
export const STAGGER = 6;

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface RouteEdge {
  from: string;
  to: string;
  /** Absolute route from `from` to `to`; rewritten in place. */
  points: Point[];
  /** Self loops, links into an ancestor and parallel edges: their route is left alone. */
  keep: boolean;
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
/** Outward direction of a side along its normal. */
const SIGN: Record<Side, number> = { top: -1, bottom: 1, left: -1, right: 1 };
const across = (s: Side): boolean => s === 'top' || s === 'bottom';

/** Coordinate of side `s` along its normal. */
const sideAt = (r: Rect, s: Side): number => (s === 'top' ? r.y : s === 'bottom' ? r.y + r.h : s === 'left' ? r.x : r.x + r.w);
/** Start and length of side `s` along the side. */
const span = (r: Rect, s: Side): [number, number] => (across(s) ? [r.x, r.w] : [r.y, r.h]);
/** Point at `u` along side `s` and `v` along its normal. */
const at = (s: Side, u: number, v: number): Point => (across(s) ? { x: u, y: v } : { x: v, y: u });
const centreU = (r: Rect, s: Side): number => (across(s) ? r.x + r.w / 2 : r.y + r.h / 2);

export function nearestSide(r: Rect, p: Point): Side {
  const d: [Side, number][] = [
    ['top', Math.abs(p.y - r.y)],
    ['bottom', Math.abs(p.y - (r.y + r.h))],
    ['left', Math.abs(p.x - r.x)],
    ['right', Math.abs(p.x - (r.x + r.w))],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0]![0];
}

/** Whether the axis-aligned segment p-q passes through the inside of `r`. */
function segmentHits(r: Rect, p: Point, q: Point): boolean {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return x1 > r.x + 0.5 && x0 < r.x + r.w - 0.5 && y1 > r.y + 0.5 && y0 < r.y + r.h - 0.5;
}

/** Drop repeated points and middle points of straight runs. */
function tidy(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

/** Number of bends in a route. */
export function bends(points: readonly Point[]): number {
  return Math.max(0, tidy(points.map((p) => ({ ...p }))).length - 2);
}

interface Plan {
  e: RouteEdge;
  a: Rect;
  b: Rect;
  sa: Side;
  sb: Side;
  /** Gap between the two facing sides. */
  gap: number;
  bus?: 'out' | 'in';
  p0?: number;
  p1?: number;
  /** Level of the jog (along the normal), when the route has one. */
  level?: number;
}

/**
 * Reroute every edge whose ends face each other across a clear gap (the bottom of one box and the top of
 * a box below it, in a downward flow) as a straight line or a Z, from evenly spaced ports. Edges that do
 * not face, or whose new route would cut through a box, keep their route. `parent` maps every box to its
 * group (`undefined` at the root): an edge may cross the groups that hold its ends.
 */
export function routeEdges(
  rects: ReadonlyMap<string, Rect>,
  parent: ReadonlyMap<string, string | undefined>,
  edges: readonly RouteEdge[],
): void {
  const plans: Plan[] = [];
  for (const e of edges) {
    if (e.keep || e.from === e.to || e.points.length < 2) continue;
    const a = rects.get(e.from);
    const b = rects.get(e.to);
    if (!a || !b) continue;
    const sa = nearestSide(a, e.points[0]!);
    const sb = nearestSide(b, e.points[e.points.length - 1]!);
    if (sb !== OPPOSITE[sa]) continue;
    const gap = SIGN[sa] * (sideAt(b, sb) - sideAt(a, sa));
    if (gap < 2 * MIN_STUB) continue;
    plans.push({ e, a, b, sa, sb, gap });
  }

  // Buses (spec §1.7): a side that sends edges to two or more boxes shares one port and a trunk that splits
  // BUS_GAP out; else a side that takes edges from two or more boxes (and from no fan) merges them BUS_GAP
  // before it.
  const by = (key: (p: Plan) => string): Map<string, Plan[]> => {
    const m = new Map<string, Plan[]>();
    for (const p of plans) m.set(key(p), [...(m.get(key(p)) ?? []), p]);
    return m;
  };
  const outKey = (p: Plan): string => `${p.e.from}\u0000${p.sa}`;
  const inKey = (p: Plan): string => `${p.e.to}\u0000${p.sb}`;
  const busGap = BUS_GAP + MIN_STUB;
  for (const list of by(outKey).values()) {
    if (list.length < 2 || new Set(list.map((p) => p.e.to)).size < 2 || list.some((p) => p.gap < busGap)) continue;
    for (const p of list) p.bus = 'out';
  }
  for (const list of by(inKey).values()) {
    if (list.length < 2 || new Set(list.map((p) => p.e.from)).size < 2 || list.some((p) => p.bus || p.gap < busGap)) continue;
    for (const p of list) p.bus = 'in';
  }

  // Ports (spec §1.7): the slots on one side of a box sit at (i + 0.5) / n, in the order of their far ends
  // so they do not cross. A bus takes one slot.
  type Slot = { key: string; far: number; plans: { p: Plan; end: 0 | 1 }[] };
  const sides = new Map<string, Map<string, Slot>>();
  const addSlot = (box: string, side: Side, key: string, far: number, p: Plan, end: 0 | 1): void => {
    const sk = `${box}\u0000${side}`;
    const slots = sides.get(sk) ?? new Map<string, Slot>();
    sides.set(sk, slots);
    const s = slots.get(key) ?? { key, far: 0, plans: [] };
    s.plans.push({ p, end });
    s.far += far;
    slots.set(key, s);
  };
  for (const p of plans) {
    addSlot(p.e.from, p.sa, p.bus === 'out' ? 'bus' : p.e.to + '\u0000' + plans.indexOf(p), centreU(p.b, p.sb), p, 0);
    addSlot(p.e.to, p.sb, p.bus === 'in' ? 'bus' : p.e.from + '\u0000' + plans.indexOf(p), centreU(p.a, p.sa), p, 1);
  }
  /** Ends alone on their side (and not a bus hub): free to slide along it for a straight line. */
  const free = new Set<string>();
  for (const [sk, slots] of sides) {
    const box = sk.split('\u0000')[0]!;
    const side = sk.split('\u0000')[1] as Side;
    const r = rects.get(box)!;
    const [u0, len] = span(r, side);
    const list = [...slots.values()].map((s) => ({ ...s, far: s.far / s.plans.length }));
    list.sort((x, y) => x.far - y.far || x.key.localeCompare(y.key));
    list.forEach((s, i) => {
      const u = Math.round(u0 + ((i + 0.5) / list.length) * len);
      for (const { p, end } of s.plans) {
        if (end === 0) p.p0 = u;
        else p.p1 = u;
        if (list.length === 1 && s.key !== 'bus') free.add(`${plans.indexOf(p)}:${end}`);
      }
    });
  }

  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) out.add(p);
    return out;
  };
  const clear = (pts: Point[], skip: ReadonlySet<string>): boolean => {
    for (const [id, box] of rects) {
      if (skip.has(id)) continue;
      for (let k = 1; k < pts.length; k++) if (segmentHits(box, pts[k - 1]!, pts[k]!)) return false;
    }
    return true;
  };
  const inside = (r: Rect, s: Side, u: number): boolean => {
    const [u0, len] = span(r, s);
    const m = Math.min(CORNER_MARGIN, len / 4);
    return u >= u0 + m - 0.01 && u <= u0 + len - m + 0.01;
  };

  const routed: Plan[] = [];
  plans.forEach((p, i) => {
    const skip = new Set([...ancestors(p.e.from), ...ancestors(p.e.to)]);
    const v0 = sideAt(p.a, p.sa);
    const v1 = sideAt(p.b, p.sb);
    const p0 = p.p0!;
    const p1 = p.p1!;
    const freeA = free.has(`${i}:0`);
    const freeB = free.has(`${i}:1`);
    // Straight first (spec §1.7): line the free end up with the other, or both inside their overlap.
    let straight: number | undefined;
    if (p0 === p1) straight = p0;
    else if (freeB && inside(p.b, p.sb, p0)) straight = p0;
    else if (freeA && inside(p.a, p.sa, p1)) straight = p1;
    else if (freeA && freeB) {
      const [a0, al] = span(p.a, p.sa);
      const [b0, bl] = span(p.b, p.sb);
      const lo = Math.max(a0 + Math.min(CORNER_MARGIN, al / 4), b0 + Math.min(CORNER_MARGIN, bl / 4));
      const hi = Math.min(a0 + al - Math.min(CORNER_MARGIN, al / 4), b0 + bl - Math.min(CORNER_MARGIN, bl / 4));
      if (lo <= hi) straight = Math.round(Math.min(hi, Math.max(lo, (centreU(p.a, p.sa) + centreU(p.b, p.sb)) / 2)));
    }
    if (straight !== undefined) {
      const pts = [at(p.sa, straight, v0), at(p.sa, straight, v1)];
      if (clear(pts, skip)) {
        p.e.points.splice(0, p.e.points.length, ...pts);
        return;
      }
    }
    if (p0 === p1) return; // straight but blocked: keep the old route
    // At most two bends: a Z whose jog sits on the bus, else half-way across the gap.
    const s = SIGN[p.sa];
    const mid = Math.round((v0 + v1) / 2);
    const levels = [
      ...(p.bus === 'out' ? [v0 + s * BUS_GAP] : p.bus === 'in' ? [v1 - s * BUS_GAP] : []),
      mid,
      v0 + s * BUS_GAP,
      v1 - s * BUS_GAP,
    ].filter((l, k, all) => all.indexOf(l) === k && s * (l - v0) >= MIN_STUB && s * (v1 - l) >= MIN_STUB);
    for (const level of levels) {
      const pts = [at(p.sa, p0, v0), at(p.sa, p0, level), at(p.sa, p1, level), at(p.sa, p1, v1)];
      if (!clear(pts, skip)) continue;
      p.e.points.splice(0, p.e.points.length, ...pts);
      p.level = level;
      routed.push(p);
      return;
    }
    // Every Z cuts through a box: keep the old route.
  });

  stagger(routed);
}

/**
 * Jogs at one level whose runs overlap would draw on top of each other: deal them out on tracks STAGGER
 * apart, centred on the level. A bus is one run (its edges share it on purpose).
 */
function stagger(routed: Plan[]): void {
  type Run = { lo: number; hi: number; plans: Plan[] };
  const runs = new Map<string, Run>();
  for (const p of routed) {
    const key =
      p.bus === 'out' ? `out\u0000${p.e.from}\u0000${p.sa}\u0000${p.level}`
      : p.bus === 'in' ? `in\u0000${p.e.to}\u0000${p.sb}\u0000${p.level}`
      : `e\u0000${routed.indexOf(p)}`;
    const r = runs.get(key) ?? { lo: Infinity, hi: -Infinity, plans: [] };
    r.lo = Math.min(r.lo, p.p0!, p.p1!);
    r.hi = Math.max(r.hi, p.p0!, p.p1!);
    r.plans.push(p);
    runs.set(key, r);
  }
  const levels = new Map<string, Run[]>();
  for (const r of runs.values()) {
    const p = r.plans[0]!;
    const key = `${across(p.sa) ? 'h' : 'v'}\u0000${p.level}`;
    levels.set(key, [...(levels.get(key) ?? []), r]);
  }
  for (const list of levels.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) => x.lo - y.lo || x.hi - y.hi);
    // Connected stretches of overlapping runs; each gets its own set of tracks.
    let cluster: Run[] = [];
    let reach = -Infinity;
    const flush = (): void => {
      if (cluster.length < 2) return;
      const ends: number[] = [];
      const track = cluster.map((r) => {
        let t = ends.findIndex((end) => end < r.lo - 0.5);
        if (t < 0) t = ends.length;
        ends[t] = r.hi;
        return t;
      });
      if (ends.length < 2) return;
      cluster.forEach((r, i) => {
        const d = Math.round((track[i]! - (ends.length - 1) / 2) * STAGGER);
        if (d === 0) return;
        for (const p of r.plans) {
          const pts = p.e.points;
          const k = across(p.sa) ? 'y' : 'x';
          pts[1]![k] += d;
          pts[2]![k] += d;
        }
      });
    };
    for (const r of list) {
      if (r.lo > reach + 0.5) {
        flush();
        cluster = [];
        reach = -Infinity;
      }
      cluster.push(r);
      reach = Math.max(reach, r.hi);
    }
    flush();
  }
}
