// Connector routes after alignment (docs/research/eraser/09-examples-style.md §1.7, §1.8 step 6): ports
// dealt out evenly along a side, straight lines first, at most two bends, and a shared bus where one node
// fans out to (or several nodes fan in to) a side.

import type { Point } from './scene.ts';
import type { Rect } from './layout-align.ts';

/** How far from its node a fan's shared bus runs (spec §1.7: 24 px out of the source). */
export const BUS_GAP = 24;
/** Shortest first and last segment of a rerouted edge. */
const MIN_STUB = 8;
/** A route of a bus member that left its bus keeps this far from every box it passes. */
const SPLIT_CLEARANCE = 8;
/** A port stays at least this far from a side's corners (the corner is rounded). */
const CORNER_MARGIN = 12;
/** Parallel horizontal runs that would overlap at one level are staggered this far apart (spec §1.7: 5 px between parallel lines; 6 keeps an even track grid with the 1 px lines). */
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
function segmentHits(r: Rect, p: Point, q: Point, margin = 0): boolean {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return x1 > r.x + 0.5 - margin && x0 < r.x + r.w - 0.5 + margin && y1 > r.y + 0.5 - margin && y0 < r.y + r.h - 0.5 + margin;
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
  // An edge that finds no new route keeps its old one, which may run along a bus or jog planned for the
  // others: plan again without it (its old route now an obstacle) until every planned edge finds a route.
  // A bus member that cannot jog on the bus level would wander down the trunk of its siblings: it leaves
  // the bus and gets a port of its own instead.
  // Every failed pass adds an edge to `kept` or `split` (each edge at most once to each), so the loop ends
  // after at most 2 x edges.length + 1 passes.
  const kept = new Set<RouteEdge>();
  const split = new Set<RouteEdge>();
  for (;;) {
    const r = planRoutes(rects, parent, edges, kept, split);
    if (!r.failed.length && !r.split.length) return;
    for (const e of r.failed) kept.add(e);
    for (const e of r.split) split.add(e);
  }
}

/** Whether two axis-aligned segments run along the same line and share more than a pixel of it. */
function collinear(p: Point, q: Point, r: Point, s: Point): boolean {
  const horiz = (a: Point, b: Point): boolean => Math.abs(a.y - b.y) < 0.5;
  const vert = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 0.5;
  const shared = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
  if (horiz(p, q) && horiz(r, s) && !(vert(p, q) || vert(r, s))) return Math.abs(p.y - r.y) < 1 && shared(p.x, q.x, r.x, s.x) > 1;
  if (vert(p, q) && vert(r, s) && !(horiz(p, q) || horiz(r, s))) return Math.abs(p.x - r.x) < 1 && shared(p.y, q.y, r.y, s.y) > 1;
  return false;
}

/**
 * One planning pass: routes every facing edge not in `kept`, writing the new routes only when all of them
 * found one. Returns the edges that found none and the bus members that could not jog on their bus (they
 * leave it, via `split`, on the next pass); nothing is written then. Edges in `split` never join a bus.
 */
function planRoutes(
  rects: ReadonlyMap<string, Rect>,
  parent: ReadonlyMap<string, string | undefined>,
  edges: readonly RouteEdge[],
  kept: ReadonlySet<RouteEdge>,
  split: ReadonlySet<RouteEdge>,
): { failed: RouteEdge[]; split: RouteEdge[] } {
  const plans: Plan[] = [];
  const fixed: Point[][] = [];
  for (const e of edges) {
    if (e.keep || kept.has(e) || e.from === e.to || e.points.length < 2) {
      if (e.points.length >= 2) fixed.push(e.points);
      continue;
    }
    const a = rects.get(e.from);
    const b = rects.get(e.to);
    if (!a || !b) continue;
    const sa = nearestSide(a, e.points[0]!);
    const sb = nearestSide(b, e.points[e.points.length - 1]!);
    const gap = SIGN[sa] * (sideAt(b, sb) - sideAt(a, sa));
    if (sb !== OPPOSITE[sa] || gap < 2 * MIN_STUB) {
      fixed.push(e.points);
      continue;
    }
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
    if (list.filter((p) => !split.has(p.e)).length < 2 || new Set(list.filter((p) => !split.has(p.e)).map((p) => p.e.to)).size < 2) continue;
    for (const p of list) if (!split.has(p.e)) p.bus = 'out';
  }
  for (const list of by(inKey).values()) {
    if (list.length < 2 || new Set(list.map((p) => p.e.from)).size < 2 || list.some((p) => p.bus || p.gap < busGap)) continue;
    const members = list.filter((p) => !split.has(p.e));
    if (members.length < 2 || new Set(members.map((p) => p.e.from)).size < 2) continue;
    for (const p of members) p.bus = 'in';
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
  const clear = (pts: Point[], skip: ReadonlySet<string>, margin = 0): boolean => {
    for (const [id, box] of rects) {
      if (skip.has(id)) continue;
      for (let k = 1; k < pts.length; k++) if (segmentHits(box, pts[k - 1]!, pts[k]!, margin)) return false;
    }
    // Never run along a route that stays as it is.
    for (const f of fixed) {
      for (let j = 1; j < f.length; j++) {
        for (let k = 1; k < pts.length; k++) if (collinear(pts[k - 1]!, pts[k]!, f[j - 1]!, f[j]!)) return false;
      }
    }
    return true;
  };
  const inside = (r: Rect, s: Side, u: number): boolean => {
    const [u0, len] = span(r, s);
    const m = Math.min(CORNER_MARGIN, len / 4);
    return u >= u0 + m - 0.01 && u <= u0 + len - m + 0.01;
  };

  const routed: Plan[] = [];
  const routes = new Map<Plan, Point[]>();
  const failed: RouteEdge[] = [];
  const left: RouteEdge[] = [];
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
        routes.set(p, pts);
        return;
      }
    }
    if (p0 === p1) {
      failed.push(p.e); // straight but blocked: keep the old route
      return;
    }
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
      // A line that left its bus must not hug a box either (it has no shared trunk to excuse a tight fit).
      if (!clear(pts, skip, split.has(p.e) ? SPLIT_CLEARANCE : 0)) {
        // Blocked on the bus level itself: this member parts from the bus (spec §1.7 keeps the split at BUS_GAP).
        if (p.bus && level === levels[0]) {
          left.push(p.e);
          return;
        }
        continue;
      }
      routes.set(p, pts);
      p.level = level;
      routed.push(p);
      return;
    }
    failed.push(p.e); // every Z cuts through a box: keep the old route
  });
  if (failed.length || left.length) return { failed, split: left };

  for (const [p, pts] of routes) p.e.points.splice(0, p.e.points.length, ...pts);
  // A shifted jog must still miss the boxes, keep its stubs and stay off other lines' runs, or it stays put.
  const valid = (run: readonly Plan[]): boolean => {
    for (const p of run) {
      const pts = p.e.points;
      const skip = new Set([...ancestors(p.e.from), ...ancestors(p.e.to)]);
      if (pts.length !== 4) continue;
      if (Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y) < MIN_STUB - 0.01) return false;
      if (Math.hypot(pts[3]!.x - pts[2]!.x, pts[3]!.y - pts[2]!.y) < MIN_STUB - 0.01) return false;
      for (const [id, box] of rects) {
        if (skip.has(id)) continue;
        for (let k = 1; k < pts.length; k++) if (segmentHits(box, pts[k - 1]!, pts[k]!)) return false;
      }
      const others = [...fixed, ...plans.filter((o) => !run.includes(o)).map((o) => o.e.points)];
      for (const f of others) {
        for (let j = 1; j < f.length; j++) {
          for (let k = 1; k < pts.length; k++) {
            if (collinear(pts[k - 1]!, pts[k]!, f[j - 1]!, f[j]!) && !sharesPort(pts, f, pts[k - 1]!, pts[k]!)) return false;
          }
        }
      }
    }
    return true;
  };
  stagger(routed, valid);
  return { failed: [], split: [] };
}

/** Whether routes `a` and `b` meet at an endpoint lying on segment p-q (lines leaving one port share their first stretch). */
function sharesPort(a: readonly Point[], b: readonly Point[], p: Point, q: Point): boolean {
  const ends = [a[0]!, a[a.length - 1]!];
  const onSeg = (c: Point): boolean =>
    c.x >= Math.min(p.x, q.x) - 0.5 && c.x <= Math.max(p.x, q.x) + 0.5 && c.y >= Math.min(p.y, q.y) - 0.5 && c.y <= Math.max(p.y, q.y) + 0.5;
  return ends.some((e) => onSeg(e) && [b[0]!, b[b.length - 1]!].some((f) => Math.abs(f.x - e.x) < 0.5 && Math.abs(f.y - e.y) < 0.5));
}

/**
 * Jogs at one level whose runs overlap would draw on top of each other: deal them out on tracks STAGGER
 * apart, centred on the level. A bus is one run (its edges share it on purpose).
 */
function stagger(routed: Plan[], valid: (run: readonly Plan[]) => boolean): void {
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
        if (!valid(r.plans)) {
          for (const p of r.plans) {
            const k = across(p.sa) ? 'y' : 'x';
            p.e.points[1]![k] -= d;
            p.e.points[2]![k] -= d;
          }
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

/** An edge drawn with `connectorStyle straight`: one diagonal segment between side ports. */
export interface StraightEdge {
  from: string;
  to: string;
}

/**
 * Side ports for straight connectors (spec §1.7: full meshes and the straight style deal ports out at
 * `(i + 1) / (n + 1)` along a side). Each end leaves from the side of its box that faces the other box;
 * the ends sharing one side are ordered by where the other box sits, so neighbouring lines do not cross
 * at the side. Returns one `[start, end]` pair per edge, on the boxes' bounding sides.
 */
export function straightPorts(rects: ReadonlyMap<string, Rect>, edges: readonly StraightEdge[]): [Point, Point][] {
  const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const facing = (r: Rect, o: Rect): Side => {
    const c = centre(r);
    const p = centre(o);
    const dx = (p.x - c.x) / Math.max(1, r.w);
    const dy = (p.y - c.y) / Math.max(1, r.h);
    if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'top' : 'bottom';
    return dx < 0 ? 'left' : 'right';
  };
  const out: [Point, Point][] = edges.map(() => [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  const slots = new Map<string, { edge: number; end: 0 | 1; side: Side; key: number }[]>();
  edges.forEach((e, i) => {
    const a = rects.get(e.from);
    const b = rects.get(e.to);
    if (!a || !b) return;
    for (const [end, r, o, id] of [[0, a, b, e.from], [1, b, a, e.to]] as const) {
      const side = facing(r, o);
      const k = `${id}\u0000${side}`;
      const list = slots.get(k) ?? [];
      list.push({ edge: i, end, side, key: across(side) ? centre(o).x : centre(o).y });
      slots.set(k, list);
    }
  });
  for (const [k, list] of slots) {
    const id = k.slice(0, k.indexOf('\u0000'));
    const r = rects.get(id)!;
    list.sort((p, q) => p.key - q.key || p.edge - q.edge);
    list.forEach((s, i) => {
      const [u0, len] = span(r, s.side);
      out[s.edge]![s.end] = at(s.side, u0 + (len * (i + 1)) / (list.length + 1), sideAt(r, s.side));
    });
  }
  return out;
}
