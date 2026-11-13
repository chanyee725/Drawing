// Post-processing of an ELK graph layout (docs/research/eraser/09-examples-style.md §1.3, §1.2, §1.8 steps 4-5):
// snap the centres of nodes in one layer, give sibling groups in a row one height and stacked sibling
// groups one width, and keep every edge attached and orthogonal while boxes move.

import type { Point } from './scene.ts';

export type Rect = { x: number; y: number; w: number; h: number };

/** Layer centres closer than this snap to their mean (spec §1.3: ELK differs by 2-10 px). */
export const SNAP_TOLERANCE = 12;
/** First and last edge segments keep at least this length when an end moves. */
const MIN_STUB = 8;

export interface AlignTree {
  /** Children of every group in source order; `undefined` is the root. */
  readonly kids: ReadonlyMap<string | undefined, readonly string[]>;
  readonly parent: ReadonlyMap<string, string | undefined>;
  /** Padding a group keeps around its children (top includes the title line). */
  pad(groupId: string): { top: number; side: number; bottom: number };
  /** Source order of every node and group. */
  readonly order: ReadonlyMap<string, number>;
}

export interface AlignEdge {
  from: string;
  to: string;
  /** Absolute route; rewritten in place. */
  points: Point[];
}

const isGroup = (t: AlignTree, id: string): boolean => t.kids.has(id);
const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.min(a1, b1) - Math.max(a0, b0);
const intersects = (a: Rect, b: Rect): boolean =>
  overlap(a.x, a.x + a.w, b.x, b.x + b.w) > 0.5 && overlap(a.y, a.y + a.h, b.y, b.y + b.h) > 0.5;

/** Whether the axis-aligned segment p-q passes through the inside of `r`. */
function segmentHits(r: Rect, p: Point, q: Point): boolean {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return x1 > r.x + 0.5 && x0 < r.x + r.w - 0.5 && y1 > r.y + 0.5 && y0 < r.y + r.h - 0.5;
}

/**
 * ELK's hierarchical routes come back with sub-pixel jogs (a bend 0.3 px off the line before it), which
 * draw as short slanted pieces. Snap every coordinate within 1 px of the previous point onto it.
 */
export function orthogonalize(points: Point[]): Point[] {
  const out = points.map((p) => ({ ...p }));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!;
    const b = out[i]!;
    if (Math.abs(b.x - a.x) < 1) b.x = a.x;
    if (Math.abs(b.y - a.y) < 1) b.y = a.y;
  }
  return out;
}

/** Drop repeated points and middle points of straight runs. */
function tidy(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const q = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - q.x) < 0.01 && Math.abs(last.y - q.y) < 0.01) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((Math.abs(prev.x - last.x) < 0.01 && Math.abs(last.x - q.x) < 0.01) || (Math.abs(prev.y - last.y) < 0.01 && Math.abs(last.y - q.y) < 0.01))) out.pop();
    out.push(q);
  }
  return out;
}

/**
 * Move the first (`end` false) or last point of an orthogonal route by (dx, dy) and bend the route so it
 * stays orthogonal: the neighbouring bend follows across the segment, a straight two-point route becomes
 * a Z with its jog half-way.
 */
export function moveEnd(points: Point[], end: boolean, dx: number, dy: number): Point[] {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return points;
  let pts = tidy(points).map((p) => ({ ...p }));
  if (pts.length < 2) return pts;
  if (end) pts.reverse();
  const [p, q] = pts as [Point, Point];
  const vertical = Math.abs(p.x - q.x) < 1;
  const across = vertical ? dx : dy;
  if (pts.length === 2 && Math.abs(across) >= 0.01) {
    if (vertical) {
      const my = (p.y + q.y) / 2;
      pts = [p, { x: p.x, y: my }, { x: q.x, y: my }, q];
    } else {
      const mx = (p.x + q.x) / 2;
      pts = [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q];
    }
  }
  const first = pts[0]!;
  const next = pts[1]!;
  first.x += dx;
  first.y += dy;
  if (vertical) next.x += dx;
  else next.y += dy;
  if (end) pts.reverse();
  return tidy(pts);
}

/** Length of the first segment of a route, and whether it runs vertically. */
function stub(points: Point[], end: boolean): { len: number; vertical: boolean; sign: number } {
  const n = points.length;
  const p = end ? points[n - 1]! : points[0]!;
  const q = end ? points[n - 2]! : points[1]!;
  const vertical = Math.abs(p.x - q.x) < 1;
  const d = vertical ? q.y - p.y : q.x - p.x;
  return { len: Math.abs(d), vertical, sign: Math.sign(d) };
}

type Side = 'top' | 'bottom' | 'left' | 'right';

function nearestSide(r: Rect, p: Point): Side {
  const d: [Side, number][] = [
    ['top', Math.abs(p.y - r.y)],
    ['bottom', Math.abs(p.y - (r.y + r.h))],
    ['left', Math.abs(p.x - r.x)],
    ['right', Math.abs(p.x - (r.x + r.w))],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0]![0];
}

/**
 * Align a laid-out graph in place. `rects` holds absolute boxes of every node and group; `vertical` is
 * true for `down` / `up` flows (layers are rows) and false for `left` / `right` (layers are columns).
 */
export function alignLayout(tree: AlignTree, rects: Map<string, Rect>, edges: AlignEdge[], vertical: boolean): void {
  const before = new Map<string, Rect>();
  for (const [id, r] of rects) before.set(id, { ...r });
  /** Translation of every box that moved with its subtree (resizing is not a translation). */
  const disp = new Map<string, { dx: number; dy: number }>();

  const shift = (id: string, dx: number, dy: number): void => {
    const r = rects.get(id);
    if (!r) return;
    r.x += dx;
    r.y += dy;
    const d = disp.get(id) ?? { dx: 0, dy: 0 };
    disp.set(id, { dx: d.dx + dx, dy: d.dy + dy });
    for (const k of tree.kids.get(id) ?? []) shift(k, dx, dy);
  };
  const descendants = (id: string, out = new Set<string>()): Set<string> => {
    out.add(id);
    for (const k of tree.kids.get(id) ?? []) descendants(k, out);
    return out;
  };

  /** §1.3: siblings whose centres along the flow differ by at most SNAP_TOLERANCE share the mean centre. */
  const snap = (ids: readonly string[]): void => {
    const items = ids.filter((id) => rects.has(id)).map((id) => {
      const r = rects.get(id)!;
      return { id, c: vertical ? r.y + r.h / 2 : r.x + r.w / 2 };
    });
    items.sort((a, b) => a.c - b.c || ids.indexOf(a.id) - ids.indexOf(b.id));
    const clusters: (typeof items)[] = [];
    for (const it of items) {
      const cur = clusters[clusters.length - 1];
      if (cur && it.c - cur[0]!.c <= SNAP_TOLERANCE) cur.push(it);
      else clusters.push([it]);
    }
    for (const cl of clusters) {
      if (cl.length < 2) continue;
      const target = Math.round(cl.reduce((s, it) => s + it.c, 0) / cl.length);
      const moved = cl.map((it) => {
        const r = rects.get(it.id)!;
        const d = target - it.c;
        return { id: it.id, d, r: vertical ? { ...r, y: r.y + d } : { ...r, x: r.x + d } };
      });
      // A snap must not push a box into a sibling it was clear of.
      const clash = moved.some((m) => ids.some((o) => {
        if (o === m.id) return false;
        const or = moved.find((x) => x.id === o)?.r ?? rects.get(o);
        return or !== undefined && intersects(m.r, or) && !intersects(rects.get(m.id)!, rects.get(o)!);
      }));
      if (clash) continue;
      for (const m of moved) if (Math.abs(m.d) > 0.01) shift(m.id, vertical ? 0 : m.d, vertical ? m.d : 0);
    }
  };

  /** Whether box `r` would run into an edge it was clear of that does not move with `moving`. */
  const hitsEdge = (r: Rect, was: Rect, moving: ReadonlySet<string>): boolean =>
    edges.some((e) => {
      if (moving.has(e.from) || moving.has(e.to)) return false;
      for (let i = 1; i < e.points.length; i++) {
        if (segmentHits(r, e.points[i - 1]!, e.points[i]!) && !segmentHits(was, e.points[i - 1]!, e.points[i]!)) return true;
      }
      return false;
    });

  /**
   * §1.3: siblings in one layer stand in source order. Each layer is re-packed in that order, keeping its
   * span and the gaps between its slots; skipped when a box would land on a sibling or a passing edge.
   */
  const reordered = new Set<string>();
  const reorder = (ids: readonly string[]): void => {
    const at = (id: string): Rect => rects.get(id)!;
    const flowC = (id: string): number => (vertical ? at(id).y + at(id).h / 2 : at(id).x + at(id).w / 2);
    const start = (id: string): number => (vertical ? at(id).x : at(id).y);
    const size = (id: string): number => (vertical ? at(id).w : at(id).h);
    const layers: string[][] = [];
    for (const id of ids.filter((x) => rects.has(x))) {
      const l = layers.find((ls) => Math.abs(flowC(ls[0]!) - flowC(id)) < 0.5);
      if (l) l.push(id);
      else layers.push([id]);
    }
    for (const layer of layers) {
      if (layer.length < 2) continue;
      const placed = [...layer].sort((a, b) => start(a) - start(b));
      const wanted = [...layer].sort((a, b) => (tree.order.get(a) ?? 0) - (tree.order.get(b) ?? 0));
      if (placed.every((id, i) => id === wanted[i])) continue;
      const gaps = placed.slice(1).map((id, i) => start(id) - (start(placed[i]!) + size(placed[i]!)));
      let pos = start(placed[0]!);
      const moves = wanted.map((id, i) => {
        const d = pos - start(id);
        pos += size(id) + (gaps[i] ?? 0);
        return { id, d };
      });
      const moving = new Set<string>();
      for (const id of layer) descendants(id, moving);
      const others = ids.filter((o) => !layer.includes(o));
      const ok = moves.every(({ id, d }) => {
        const was = at(id);
        const r = vertical ? { ...was, x: was.x + d } : { ...was, y: was.y + d };
        return !others.some((o) => rects.has(o) && intersects(r, at(o))) && !hitsEdge(r, was, moving);
      });
      if (!ok) continue;
      for (const { id, d } of moves) {
        if (Math.abs(d) < 0.01) continue;
        shift(id, vertical ? d : 0, vertical ? 0 : d);
        reordered.add(id);
      }
    }
  };

  /** Grow group `id` (never shrink) so its children keep the padding. */
  const refit = (id: string): void => {
    const r = rects.get(id);
    const ks = (tree.kids.get(id) ?? []).map((k) => rects.get(k)).filter((x): x is Rect => x !== undefined);
    if (!r || ks.length === 0) return;
    const p = tree.pad(id);
    const x0 = Math.min(r.x, ...ks.map((k) => k.x - p.side));
    const y0 = Math.min(r.y, ...ks.map((k) => k.y - p.top));
    const x1 = Math.max(r.x + r.w, ...ks.map((k) => k.x + k.w + p.side));
    const y1 = Math.max(r.y + r.h, ...ks.map((k) => k.y + k.h + p.bottom));
    Object.assign(r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };

  /**
   * Whether group `id` may take box `next`: it must not run into a sibling or an edge it was clear of, and
   * the edges on a side that moves must keep a stub of at least MIN_STUB.
   */
  const canResize = (id: string, siblings: readonly string[], next: Rect): boolean => {
    const cur = rects.get(id)!;
    for (const o of siblings) {
      if (o === id) continue;
      const or = rects.get(o);
      if (or && intersects(next, or) && !intersects(cur, or)) return false;
    }
    const inside = descendants(id);
    for (const e of edges) {
      const fromIn = inside.has(e.from);
      const toIn = inside.has(e.to);
      if (fromIn && toIn) continue;
      if (!fromIn && !toIn) {
        for (let i = 1; i < e.points.length; i++) {
          if (segmentHits(next, e.points[i - 1]!, e.points[i]!) && !segmentHits(cur, e.points[i - 1]!, e.points[i]!)) return false;
        }
        continue;
      }
      if ((fromIn && e.from !== id) || (toIn && e.to !== id)) continue; // edge from a child: checked as crossing below
      const end = e.to === id;
      const p = end ? e.points[e.points.length - 1]! : e.points[0]!;
      const side = nearestSide(cur, p);
      const delta = side === 'top' ? next.y - cur.y : side === 'bottom' ? next.y + next.h - (cur.y + cur.h)
        : side === 'left' ? next.x - cur.x : next.x + next.w - (cur.x + cur.w);
      if (Math.abs(delta) < 0.01 || e.points.length < 2) continue;
      const s = stub(e.points, end);
      if (s.len - Math.abs(delta) < MIN_STUB) return false;
    }
    return true;
  };

  /**
   * §1.2: sibling groups in one row take the row's top and bottom; sibling groups stacked in one column
   * take the column's left and right.
   */
  const bands = (ids: readonly string[]): void => {
    const groups = ids.filter((id) => isGroup(tree, id) && rects.has(id));
    if (groups.length < 2) return;
    for (const rows of [true, false]) {
      // Union-find over pairs that share most of one axis and are apart on the other.
      const root = new Map(groups.map((g) => [g, g]));
      const find = (g: string): string => (root.get(g) === g ? g : find(root.get(g)!));
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const a = rects.get(groups[i]!)!;
          const b = rects.get(groups[j]!)!;
          const share = rows ? overlap(a.y, a.y + a.h, b.y, b.y + b.h) / Math.min(a.h, b.h)
            : overlap(a.x, a.x + a.w, b.x, b.x + b.w) / Math.min(a.w, b.w);
          const apart = rows ? overlap(a.x, a.x + a.w, b.x, b.x + b.w) <= 0 : overlap(a.y, a.y + a.h, b.y, b.y + b.h) <= 0;
          if (share >= 0.5 && apart) root.set(find(groups[j]!), find(groups[i]!));
        }
      }
      const sets = new Map<string, string[]>();
      for (const g of groups) sets.set(find(g), [...(sets.get(find(g)) ?? []), g]);
      for (const set of sets.values()) {
        if (set.length < 2) continue;
        const rs = set.map((g) => rects.get(g)!);
        const lo = Math.min(...rs.map((r) => (rows ? r.y : r.x)));
        const hi = Math.max(...rs.map((r) => (rows ? r.y + r.h : r.x + r.w)));
        for (const g of set) {
          const r = rects.get(g)!;
          const next = rows ? { ...r, y: lo, h: hi - lo } : { ...r, x: lo, w: hi - lo };
          if (canResize(g, ids, next)) Object.assign(r, next);
        }
      }
    }
  };

  const visit = (parentId: string | undefined): void => {
    const ids = tree.kids.get(parentId) ?? [];
    for (const id of ids) if (isGroup(tree, id)) visit(id);
    snap(ids);
    reorder(ids);
    bands(ids);
    if (parentId !== undefined) refit(parentId);
  };
  visit(undefined);

  reattach(tree, edges, before, rects, disp);
  const hubs = new Set<string>();
  for (const e of edges) {
    if (reordered.has(e.to)) hubs.add(e.from);
    if (reordered.has(e.from)) hubs.add(e.to);
  }
  for (const hub of hubs) refan(tree, hub, edges, rects, vertical);
}

/** Coordinates along the flow (`v`) and across it (`u`). */
const axes = (vertical: boolean) => ({
  u: (p: Point): number => (vertical ? p.x : p.y),
  v: (p: Point): number => (vertical ? p.y : p.x),
  pt: (u: number, v: number): Point => (vertical ? { x: u, y: v } : { x: v, y: u }),
});

/**
 * Re-route the fan of edges leaving one side of `hub` towards boxes across a clear gap, after `reorder`
 * moved some of those boxes: ports keep their places but are dealt out in the order of the far ends, and
 * each edge runs side - level - far end (V-H-V in a vertical flow) on a level picked so no two cross.
 * A fan whose gap is too small or whose levels would cut through a box keeps its route.
 */
function refan(tree: AlignTree, hub: string, edges: AlignEdge[], rects: ReadonlyMap<string, Rect>, vertical: boolean): void {
  const r = rects.get(hub);
  if (!r) return;
  const { u, v, pt } = axes(vertical);
  for (const sign of [1, -1]) {
    const side = sign > 0 ? (vertical ? r.y + r.h : r.x + r.w) : vertical ? r.y : r.x;
    const fan: { e: AlignEdge; atEnd: boolean; port: number; far: Point; farSide: number }[] = [];
    for (const e of edges) {
      if (e.from === e.to || e.points.length < 2) continue;
      const atEnd = e.to === hub;
      if (!atEnd && e.from !== hub) continue;
      const near = atEnd ? e.points[e.points.length - 1]! : e.points[0]!;
      const far = atEnd ? e.points[0]! : e.points[e.points.length - 1]!;
      if (Math.abs(v(near) - side) > 0.5) continue;
      const fr = rects.get(atEnd ? e.from : e.to);
      if (!fr) continue;
      const farSide = sign > 0 ? (vertical ? fr.y : fr.x) : vertical ? fr.y + fr.h : fr.x + fr.w;
      if (Math.abs(v(far) - farSide) > 0.5) continue;
      fan.push({ e, atEnd, port: u(near), far, farSide });
    }
    if (fan.length < 2) continue;
    const reach = Math.min(...fan.map((f) => sign * (f.farSide - side)));
    if (reach < 16) continue;
    const ports = fan.map((f) => f.port).sort((a, b) => a - b);
    fan.sort((a, b) => u(a.far) - u(b.far));
    fan.forEach((f, i) => (f.port = ports[i]!));
    const left = fan.filter((f) => u(f.far) < f.port - 0.5);
    const right = fan.filter((f) => u(f.far) > f.port + 0.5).reverse();
    const levels = Math.max(left.length, right.length);
    const level = new Map<AlignEdge, number>();
    for (const list of [left, right]) list.forEach((f, i) => level.set(f.e, side + (sign * reach * (i + 1)) / (levels + 1)));
    const routes = fan.map((f) => {
      const lv = level.get(f.e);
      const pts = lv === undefined
        ? [pt(f.port, side), pt(f.port, v(f.far))]
        : [pt(f.port, side), pt(f.port, lv), pt(u(f.far), lv), f.far];
      return f.atEnd ? pts.reverse() : pts;
    });
    const ends = (f: (typeof fan)[number]): Set<string> => {
      const out = new Set<string>();
      for (const id of [f.e.from, f.e.to]) for (let p: string | undefined = id; p !== undefined; p = tree.parent.get(p)) out.add(p);
      return out;
    };
    const clear = routes.every((pts, i) => {
      const skip = ends(fan[i]!);
      for (const [id, box] of rects) {
        if (skip.has(id)) continue;
        for (let k = 1; k < pts.length; k++) if (segmentHits(box, pts[k - 1]!, pts[k]!)) return false;
      }
      return true;
    });
    if (!clear) continue;
    fan.forEach((f, i) => f.e.points.splice(0, f.e.points.length, ...routes[i]!));
  }
}

/** Lowest box that holds the edge's route: ELK's container (an end that contains the other, else the common parent). */
function container(tree: AlignTree, a: string, b: string): string | undefined {
  const chain = (id: string): (string | undefined)[] => {
    const out: (string | undefined)[] = [];
    for (let p = tree.parent.get(id); p !== undefined; p = tree.parent.get(p)) out.push(p);
    out.push(undefined);
    return out;
  };
  const ca = chain(a);
  const cb = chain(b);
  if (cb.includes(a)) return a;
  if (ca.includes(b)) return b;
  return ca.find((x) => cb.includes(x));
}

/**
 * Bring every edge along with the boxes: the route moves with its container, and each end moves with the
 * side of its box it touches (across the side) and with the box's translation (along it).
 */
function reattach(
  tree: AlignTree,
  edges: AlignEdge[],
  before: ReadonlyMap<string, Rect>,
  rects: ReadonlyMap<string, Rect>,
  disp: ReadonlyMap<string, { dx: number; dy: number }>,
): void {
  const none = { dx: 0, dy: 0 };
  const endDelta = (id: string, p: Point): { dx: number; dy: number } => {
    const a = before.get(id);
    const b = rects.get(id);
    const t = disp.get(id) ?? none;
    if (!a || !b) return t;
    switch (nearestSide(a, p)) {
      case 'top': return { dx: t.dx, dy: b.y - a.y };
      case 'bottom': return { dx: t.dx, dy: b.y + b.h - (a.y + a.h) };
      case 'left': return { dx: b.x - a.x, dy: t.dy };
      default: return { dx: b.x + b.w - (a.x + a.w), dy: t.dy };
    }
  };
  for (const e of edges) {
    if (e.points.length < 2) continue;
    const c = container(tree, e.from, e.to);
    const base = (c !== undefined && disp.get(c)) || none;
    const da = endDelta(e.from, e.points[0]!);
    const db = endDelta(e.to, e.points[e.points.length - 1]!);
    let pts = e.points.map((p) => ({ x: p.x + base.dx, y: p.y + base.dy }));
    if (e.from === e.to) {
      // Self loop: both ends sit on the same box; move the whole loop with it.
      const t = disp.get(e.from) ?? none;
      pts = e.points.map((p) => ({ x: p.x + t.dx, y: p.y + t.dy }));
    } else {
      pts = moveEnd(pts, false, da.dx - base.dx, da.dy - base.dy);
      pts = moveEnd(pts, true, db.dx - base.dx, db.dy - base.dy);
    }
    e.points.splice(0, e.points.length, ...pts);
  }
}
