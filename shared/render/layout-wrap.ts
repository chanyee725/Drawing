// Experimental (E65, #276, docs/design/flowchart-group-wrap.md): wrap the top-level groups of a laid-out
// graph into rows so a long chain of groups does not end up as one line that only fits the screen at a
// small zoom. Off by default: it only runs when a caller passes `wrapGroups`.
//
// It works on the finished layout (after ELK and alignment): top-level items are moved as rigid blocks, so
// everything inside a group keeps its place, and only the connectors that now join two rows get a new route.

import type { Point } from './scene.ts';
import type { Rect } from './layout-align.ts';
import { ROUTE_GAP, routeAround } from './route-around.ts';

/** Width : height the wrapped block aims for (the same target the free-group grid uses). */
export const WRAP_ASPECT = 1.5;
/** Space between two rows: the connectors that join them run in it. */
export const WRAP_ROW_GAP = 64;
/** Tracks offered in a row gap, as offsets from its middle. */
const TRACKS = [0, -8, 8, -16, 16] as const;

export interface WrapEdge {
  from: string;
  to: string;
  /** Absolute route; replaced when the edge moves or is rerouted. */
  points: Point[];
}

export interface WrapInput {
  /** Rect of every node and group; moved in place. */
  rects: Map<string, Rect>;
  /** Root children in source order. */
  top: readonly string[];
  parent: ReadonlyMap<string, string | undefined>;
  isGroup: (id: string) => boolean;
  /** Where a group's title is drawn, given its rect: routes keep off it. */
  titleOf: (id: string, r: Rect) => Rect | undefined;
  edges: WrapEdge[];
  /** Flow runs top to bottom: rows become columns. */
  vertical: boolean;
}

export interface WrapResult {
  rows: number;
  /** Edges (indexes into `edges`) that join two rows and were rerouted. */
  rerouted: Set<number>;
}

interface Unit {
  ids: string[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  hasGroup: boolean;
}

const flipRect = (r: Rect): void => {
  [r.x, r.y, r.w, r.h] = [r.y, r.x, r.h, r.w];
};
const flipPoint = (p: Point): Point => ({ x: p.y, y: p.x });

/**
 * Rows for `units` (already in flow order) under a width limit: a row takes units until the next one would
 * pass the limit. A row only breaks between two units that both hold a group.
 */
function fill(units: readonly Unit[], limit: number): Unit[][] {
  const rows: Unit[][] = [];
  let row: Unit[] = [];
  for (const u of units) {
    const last = row[row.length - 1];
    if (last && u.hasGroup && last.hasGroup && u.x1 - row[0]!.x0 > limit + 0.5) {
      rows.push(row);
      row = [];
    }
    row.push(u);
  }
  if (row.length) rows.push(row);
  return rows;
}

const rowW = (row: readonly Unit[]): number => row[row.length - 1]!.x1 - row[0]!.x0;
const rowY0 = (row: readonly Unit[]): number => Math.min(...row.map((u) => u.y0));
const rowH = (row: readonly Unit[]): number => Math.max(...row.map((u) => u.y1)) - rowY0(row);

/** The row split whose block comes closest to WRAP_ASPECT; fewer rows win a tie. Exported for tests. */
export function pickRows<U extends { x0: number; x1: number; y0: number; y1: number; hasGroup: boolean }>(units: readonly U[]): U[][] {
  const us = units as unknown as readonly Unit[];
  const limits = new Set<number>();
  for (let i = 0; i < us.length; i++) for (let j = i; j < us.length; j++) limits.add(us[j]!.x1 - us[i]!.x0);
  let best: Unit[][] = [us.slice()];
  let bestScore = Infinity;
  for (const limit of [...limits].sort((a, b) => b - a)) {
    const rows = fill(us, limit);
    const w = Math.max(...rows.map(rowW));
    const h = rows.reduce((s, r) => s + rowH(r), 0) + WRAP_ROW_GAP * (rows.length - 1);
    const score = Math.abs(Math.log(w / h / WRAP_ASPECT));
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && rows.length < best.length)) {
      best = rows;
      bestScore = score;
    }
  }
  return best as unknown as U[][];
}

/**
 * Wrap the top-level items into rows when that brings the picture closer to WRAP_ASPECT. Returns undefined
 * (and changes nothing) when there is nothing to wrap: fewer than two top-level groups, or one row is
 * already the best fit.
 */
export function wrapTopLevel(input: WrapInput): WrapResult | undefined {
  const { rects, parent, edges } = input;
  if (input.top.filter((id) => input.isGroup(id) && rects.has(id)).length < 2) return undefined;
  // Work as if the flow ran left to right; a top-to-bottom flow is mirrored on the diagonal and back.
  const flip = (): void => {
    if (!input.vertical) return;
    for (const r of rects.values()) flipRect(r);
    for (const e of edges) e.points = e.points.map(flipPoint);
  };
  flip();
  const result = wrapRight(input);
  flip();
  return result;
}

function wrapRight(input: WrapInput): WrapResult | undefined {
  const { rects, parent, edges } = input;
  const tops = input.top.filter((id) => rects.has(id)).sort((a, b) => rects.get(a)!.x - rects.get(b)!.x);
  // Items that share a stretch of the flow axis (one ELK layer) stay together as one unit.
  const units: Unit[] = [];
  for (const id of tops) {
    const r = rects.get(id)!;
    const last = units[units.length - 1];
    if (last && r.x < last.x1 - 0.5) {
      last.ids.push(id);
      last.x1 = Math.max(last.x1, r.x + r.w);
      last.y0 = Math.min(last.y0, r.y);
      last.y1 = Math.max(last.y1, r.y + r.h);
      last.hasGroup ||= input.isGroup(id);
    } else units.push({ ids: [id], x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h, hasGroup: input.isGroup(id) });
  }
  const rows = pickRows(units);
  if (rows.length < 2) return undefined;

  const topOf = (id: string): string => {
    let cur = id;
    for (let p = parent.get(cur); p !== undefined; p = parent.get(cur)) cur = p;
    return cur;
  };
  const x0 = units[0]!.x0;
  const width = Math.max(...rows.map(rowW));
  const rowOf = new Map<string, number>();
  const shift: { dx: number; dy: number }[] = [];
  const gaps: number[] = [];
  let y = Math.min(...units.map((u) => u.y0));
  rows.forEach((row, k) => {
    shift.push({ dx: x0 - row[0]!.x0, dy: y - rowY0(row) });
    for (const u of row) for (const id of u.ids) rowOf.set(id, k);
    y += rowH(row);
    if (k + 1 < rows.length) gaps.push(y + WRAP_ROW_GAP / 2);
    y += WRAP_ROW_GAP;
  });
  for (const [id, r] of rects) {
    const s = shift[rowOf.get(topOf(id))!];
    if (!s) continue;
    r.x += s.dx;
    r.y += s.dy;
  }
  // A lone group that ends a row reaches the block's right edge, so the rows read as one block.
  for (const row of rows) {
    const last = row[row.length - 1]!;
    if (last.ids.length !== 1 || !input.isGroup(last.ids[0]!)) continue;
    const r = rects.get(last.ids[0]!)!;
    r.w = Math.max(r.w, x0 + width - r.x);
  }

  const chain = (id: string): string[] => {
    const out = [id];
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) out.push(p);
    return out;
  };
  const all = [...rects.values()];
  const bx0 = Math.min(...all.map((r) => r.x)) - 2 * ROUTE_GAP;
  const by0 = Math.min(...all.map((r) => r.y)) - 2 * ROUTE_GAP;
  const bounds: Rect = { x: bx0, y: by0, w: Math.max(...all.map((r) => r.x + r.w)) + 2 * ROUTE_GAP - bx0, h: Math.max(...all.map((r) => r.y + r.h)) + 2 * ROUTE_GAP - by0 };
  // Inside a top-level group a new route only runs across the rows, never along them: it leaves its group
  // by the shortest way and does its long run in the gap between rows.
  const bands = tops.filter((id) => input.isGroup(id)).map((id) => rects.get(id)!);
  const channels = { ys: gaps.flatMap((g) => TRACKS.map((t) => g + t)) };

  const rerouted = new Set<number>();
  const crossing: number[] = [];
  edges.forEach((e, i) => {
    const ra = rowOf.get(topOf(e.from));
    const rb = rowOf.get(topOf(e.to));
    if (ra === undefined || rb === undefined) return;
    if (ra === rb) {
      const s = shift[ra]!;
      e.points = e.points.map((p) => ({ x: p.x + s.dx, y: p.y + s.dy }));
    } else crossing.push(i);
  });
  const lines = edges.filter((_, i) => !crossing.includes(i)).map((e) => e.points);
  for (const i of crossing) {
    const e = edges[i]!;
    const a = rects.get(e.from)!;
    const b = rects.get(e.to)!;
    const own = new Set([...chain(e.from), ...chain(e.to)]);
    const blocks: Rect[] = [];
    for (const [id, r] of rects) {
      if (!own.has(id)) blocks.push(r);
      else if (input.isGroup(id) && id !== e.from && id !== e.to) {
        const title = input.titleOf(id, r);
        if (title) blocks.push(title);
      }
    }
    const route =
      routeAround(a, b, blocks, bands, bounds, lines, channels) ??
      routeAround(a, b, blocks, [], bounds, lines, channels) ??
      elbow(a, b);
    e.points = route.map((p) => ({ x: p.x, y: p.y }));
    lines.push(e.points);
    rerouted.add(i);
  }
  return { rows: rows.length, rerouted };
}

/** Last resort when no route around the boxes exists: down from `a`, across in the middle, into `b`. */
function elbow(a: Rect, b: Rect): Point[] {
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  const down = b.y >= a.y + a.h;
  const p0 = { x: ax, y: down ? a.y + a.h : a.y };
  const p1 = { x: bx, y: down ? b.y : b.y + b.h };
  const my = (p0.y + p1.y) / 2;
  return [p0, { x: ax, y: my }, { x: bx, y: my }, p1];
}
