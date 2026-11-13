// Cloud architecture and flowchart: ELK layered layout with groups as compound nodes.

import type { GraphChild, GraphDiagram, GraphEdge, GraphGroup, GraphNode } from '../dsl/index.ts';
import { finishScene, fontSize, measureLabel, round, styleFor, textItem } from './common.ts';
import type { ElementStyle, Label } from './common.ts';
import { absolutePositions, edgeOffset, runElk } from './elk.ts';
import type { ElkExtendedEdge, ElkNode } from './elk.ts';
import { PLATE_PAD } from './text.ts';
import { BLOCK_LAYOUT_VERSION } from './block-layout.ts';
import type { BlockLayout } from './block-layout.ts';
import { alignLayout, orthogonalize } from './layout-align.ts';
import { routeEdges, straightPorts } from './layout-routes.ts';
import type { Point, Scene, SceneEdge, SceneHandle, SceneItem, ShapeKind } from './scene.ts';

const SHAPES: readonly ShapeKind[] = [
  'rectangle', 'circle', 'cylinder', 'diamond', 'document', 'ellipse',
  'hexagon', 'oval', 'parallelogram', 'star', 'trapezoid', 'triangle',
];

const ELK_DIRECTION = { down: 'DOWN', up: 'UP', left: 'LEFT', right: 'RIGHT' } as const;
const NODE_TEXT_MAX = 160;
const EDGE_LABEL_SIZE = 12;

// Eraser-like sizes and spacing, from the survey of its public examples
// (docs/research/eraser/09-examples-style.md §1.1, §1.5, §1.6).
/** Box nodes take a fixed width from these buckets instead of hugging their text. */
const WIDTH_BUCKETS = [160, 200, 260] as const;
/** Lines a label may wrap to before the node moves up a width bucket. */
const MAX_LINES = 3;
/** Box height for one line, and the least for two (title + subtitle). More text grows it by NODE_PAD_Y. */
const NODE_MIN_H = 52;
const NODE_TWO_LINE_H = 56;
/** Space a box node keeps around its content: left + right, top + bottom. */
const NODE_PAD_X = 32;
const NODE_PAD_Y = 12;
/** Shapes that get width buckets and one size per group. The rest keep shape-specific sizing. */
const BUCKETED: ReadonlySet<ShapeKind> = new Set(['rectangle', 'cylinder', 'document']);
const SPACING = {
  /** Same-layer neighbours side by side (vertical flow). */
  neighbour: 40,
  /** Same-layer nodes stacked as a list (horizontal flow). */
  list: 12,
  /** Siblings in a parent that holds groups (the root included): big blocks. */
  block: 48,
  /**
   * Between layers. Eraser uses 56, or 76 when the edges carry labels; ELK gives each edge label a layer
   * of its own, so a labelled gap is already 56 + label + 56 and needs no bigger value.
   */
  layer: 56,
} as const;
/**
 * Siblings in one layer keep their source order (spec §1.3), even at the cost of a crossing. Set on the
 * root of every ELK run (`layoutScope`: the diagram and each free group). ELK only honours it at that
 * root (set on a group, elkjs 0.12 throws in its model-order comparator), so `alignLayout` puts siblings
 * inside groups in source order afterwards.
 */
const MODEL_ORDER = {
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
} as const;
/** Group padding around its children; `top` includes the title line. */
const GROUP_PAD = { top: 40, side: 16, bottom: 14 } as const;

type Rect = { x: number; y: number; w: number; h: number };

interface NodeGeom {
  node: GraphNode;
  style: ElementStyle;
  label: Label;
  shape: ShapeKind;
  /** Architecture nodes with an icon draw as a big icon with the label underneath, no box. */
  iconOnly: boolean;
  iconSize: number;
  w: number;
  h: number;
}

interface GroupGeom {
  group: GraphGroup;
  style: ElementStyle;
  label: Label;
  iconSize: number;
  header: number;
  minW: number;
}

function measureNode(d: GraphDiagram, node: GraphNode): NodeGeom {
  const style = styleFor(d, node.attrs, node.span.line);
  const size = fontSize(style);
  const icon = node.attrs.icon;
  const shapeAttr = node.attrs.shape?.toLowerCase();
  const shape = (SHAPES as readonly string[]).includes(shapeAttr ?? '') ? (shapeAttr as ShapeKind) : 'rectangle';
  if (d.type === 'cloud-architecture' && icon && !node.attrs.shape) {
    const label = measureLabel(node.label, size, style.typeface, style.wrap, 120);
    const iconSize = Math.round(size * 3);
    return { node, style, label, shape, iconOnly: true, iconSize, w: Math.ceil(Math.max(iconSize, label.w) + 8), h: Math.ceil(iconSize + 6 + label.h) };
  }
  const iconSize = icon ? Math.round(size * 1.5) : 0;
  const iconW = icon ? iconSize + 8 : 0;
  if (BUCKETED.has(shape)) return measureBucketed(node, style, shape, iconSize);
  const label = measureLabel(node.label, size, style.typeface, style.wrap, NODE_TEXT_MAX);
  const cw = label.w + iconW;
  const ch = Math.max(label.h, iconSize);
  let w = Math.max(cw + 32, 96);
  let h = Math.max(ch + 22, 44);
  switch (shape) {
    case 'diamond':
      w = Math.max(cw * 1.6 + 40, 110);
      h = Math.max(ch * 2 + 30, 70);
      break;
    case 'circle':
      w = h = Math.max(cw + 30, ch + 30, 64);
      break;
    case 'ellipse':
      w = Math.max(cw * 1.35 + 30, 100);
      h = Math.max(ch * 1.6 + 20, 54);
      break;
    case 'oval':
      w += h / 2;
      break;
    case 'hexagon':
    case 'parallelogram':
    case 'trapezoid':
      w += 32;
      break;
    case 'triangle':
      w = Math.max(cw * 2 + 40, 110);
      h = Math.max(ch * 2.2 + 30, 80);
      break;
    case 'star':
      w = h = Math.max(cw * 2 + 30, ch * 3 + 30, 100);
      break;
    default:
      break;
  }
  return { node, style, label, shape, iconOnly: false, iconSize, w: Math.ceil(w), h: Math.ceil(h) };
}

/** Label, width and height of a box node whose text wraps to fit `width`. */
function sizeBox(g: Pick<NodeGeom, 'node' | 'style' | 'shape' | 'iconSize'>, width: number): Pick<NodeGeom, 'label' | 'w' | 'h'> {
  const size = fontSize(g.style);
  const iconW = g.iconSize ? g.iconSize + 8 : 0;
  const label = measureLabel(g.node.label, size, g.style.typeface, g.style.wrap, width - NODE_PAD_X - iconW);
  const w = Math.max(width, Math.ceil(label.w + iconW + NODE_PAD_X));
  const least = label.lines.length >= 2 ? NODE_TWO_LINE_H : NODE_MIN_H;
  let h = Math.max(least, Math.ceil(Math.max(label.h, g.iconSize) + NODE_PAD_Y));
  if (g.shape === 'cylinder') h += 18;
  else if (g.shape === 'document') h += 10;
  return { label, w, h };
}

/**
 * Box nodes (spec §1.1): the smallest width bucket whose wrap stays within MAX_LINES lines; failing that,
 * the widest (a long word or unwrapped line widens it).
 */
function measureBucketed(node: GraphNode, style: ElementStyle, shape: ShapeKind, iconSize: number): NodeGeom {
  const base = { node, style, shape, iconSize };
  let pick: Pick<NodeGeom, 'label' | 'w' | 'h'> | undefined;
  for (const b of WIDTH_BUCKETS) {
    pick = sizeBox(base, b);
    if (pick.w === b && pick.label.lines.length <= MAX_LINES) break;
  }
  return { ...base, ...pick!, iconOnly: false };
}

/**
 * Box nodes of the same shape in the same group get one size: the widest bucket among them, labels
 * re-wrapped to that width, then the tallest height. The root is not one group: there only nodes in the
 * same layer (`rootLayer`) share a size. Root nodes in the root grid (`loose`) share one size; other root
 * nodes without edges keep their own.
 */
function unifySizes(
  nodes: Iterable<NodeGeom>,
  parent: ReadonlyMap<string, string | undefined>,
  rootLayer: ReadonlyMap<string, number>,
  loose: ReadonlySet<string>,
): void {
  const sets = new Map<string, NodeGeom[]>();
  for (const g of nodes) {
    if (g.iconOnly || !BUCKETED.has(g.shape)) continue;
    const p = parent.get(g.node.id);
    const layer = p === undefined ? rootLayer.get(g.node.id) : undefined;
    const at = p !== undefined ? `group:${p}` : loose.has(g.node.id) ? 'loose' : layer !== undefined ? `layer:${layer}` : undefined;
    if (at === undefined) continue; // root node with no edge outside the grid: keeps its own size
    const key = `${at}\u0000${g.shape}`;
    const list = sets.get(key) ?? [];
    list.push(g);
    sets.set(key, list);
  }
  for (const list of sets.values()) {
    const w = Math.max(...list.map((g) => g.w));
    for (const g of list) Object.assign(g, sizeBox(g, w));
    const h = Math.max(...list.map((g) => g.h));
    for (const g of list) g.h = h;
  }
}

/** Definition order of every node and group (pre-order over the source tree). */
function definitionOrder(d: GraphDiagram): Map<string, number> {
  const order = new Map<string, number>();
  const walk = (c: GraphChild): void => {
    order.set(c.id, order.size);
    if (c.kind === 'group') for (const k of c.children) walk(k);
  };
  for (const c of d.children) walk(c);
  return order;
}

/**
 * Whether ELK should lay `e` out from `to` to `from`. Undirected edges (`-`, `--`) do not set the flow
 * (spec §1.3): they point from the end defined first, so `Access - Distribution` under a `Distribution`
 * defined earlier keeps Distribution in the upper layer.
 */
function flipped(e: GraphEdge, order: ReadonlyMap<string, number>): boolean {
  if (e.startArrow || e.endArrow) return false;
  return (order.get(e.to) ?? 0) < (order.get(e.from) ?? 0);
}

/**
 * Layer of every root-level item that has an edge: longest path from the sources over the edges between
 * root-level items (an edge into a group counts for the group), in ELK's direction. Approximates the
 * layers ELK will make, so root-level box nodes can share a size per layer (spec §1.1):
 * - a labelled edge spans two layers (ELK gives the label a layer of its own);
 * - a source sits right before its nearest target, as ELK's network-simplex layering pulls it;
 * - items with no edge get no layer (they keep their own size).
 * Edges that close a cycle are ignored.
 */
function rootLayers(
  d: GraphDiagram,
  parent: ReadonlyMap<string, string | undefined>,
  order: ReadonlyMap<string, number>,
): Map<string, number> {
  const top = (id: string): string | undefined => {
    if (!parent.has(id)) return undefined;
    let cur = id;
    for (let p = parent.get(cur); p !== undefined; p = parent.get(cur)) cur = p;
    return cur;
  };
  const out = new Map<string, { to: string; span: number }[]>();
  const indeg = new Map<string, number>();
  for (const c of d.children) indeg.set(c.id, 0);
  const linked = new Set<string>();
  const seen = new Map<string, { to: string; span: number }>();
  for (const e of d.edges) {
    const flip = flipped(e, order);
    const a = top(flip ? e.to : e.from);
    const b = top(flip ? e.from : e.to);
    if (a === undefined || b === undefined || a === b) continue;
    linked.add(a);
    linked.add(b);
    const span = e.label ? 2 : 1;
    const prev = seen.get(`${a}\u0000${b}`);
    if (prev) {
      prev.span = Math.max(prev.span, span);
      continue;
    }
    const link = { to: b, span };
    seen.set(`${a}\u0000${b}`, link);
    out.set(a, [...(out.get(a) ?? []), link]);
  }
  // Drop back edges (DFS in model order) so the rest is a DAG.
  const state = new Map<string, 1 | 2>();
  const dag = new Map<string, { to: string; span: number }[]>();
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const n of out.get(id) ?? []) {
      if (state.get(n.to) === 1) continue;
      dag.set(id, [...(dag.get(id) ?? []), n]);
      indeg.set(n.to, (indeg.get(n.to) ?? 0) + 1);
      if (!state.has(n.to)) visit(n.to);
    }
    state.set(id, 2);
  };
  for (const c of d.children) if (!state.has(c.id)) visit(c.id);
  const layer = new Map<string, number>();
  const queue = d.children.map((c) => c.id).filter((id) => indeg.get(id) === 0 && linked.has(id));
  const sources = [...queue];
  for (const id of queue) layer.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const n of dag.get(id) ?? []) {
      layer.set(n.to, Math.max(layer.get(n.to) ?? 0, layer.get(id)! + n.span));
      indeg.set(n.to, indeg.get(n.to)! - 1);
      if (indeg.get(n.to) === 0) queue.push(n.to);
    }
  }
  for (const id of sources) {
    const next = (dag.get(id) ?? []).map((n) => (layer.get(n.to) ?? 0) - n.span);
    if (next.length > 0) layer.set(id, Math.max(0, Math.min(...next)));
  }
  return layer;
}

/** Grid cell gaps between free nodes (spec §1.4): across, down. */
const GRID_GAP = { x: 16, y: 12 } as const;
/** Gaps between free sibling groups (spec §1.5): side by side in one row, stacked bands. */
const BAND_GAP = { row: 24, stack: 12 } as const;
/** Width : height the block of free groups aims for when picking its column count. */
const BAND_ASPECT = 1.5;
/** Most cells in one grid row. */
const GRID_MAX_COLS = 5;

/** Columns of a row-first grid of `n` cells: one row up to GRID_MAX_COLS, then about 3:2 wide. */
export function gridColumns(n: number): number {
  return n <= GRID_MAX_COLS ? Math.max(1, n) : Math.min(GRID_MAX_COLS, Math.ceil(Math.sqrt(n * 1.5)));
}

/**
 * Columns for free sibling groups: the count (1 to GRID_MAX_COLS) whose block comes closest to
 * BAND_ASPECT. Wide bands (a capability row) stack in one column; small boxes share rows.
 */
export function bandColumns(items: readonly { w: number; h: number }[]): number {
  let best = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= Math.min(GRID_MAX_COLS, items.length); cols++) {
    const p = packGrid(items.map((it) => ({ ...it, rects: new Map(), edges: new Map() })), cols, BAND_GAP.row, BAND_GAP.stack, false);
    const score = Math.abs(Math.log(p.w / p.h / BAND_ASPECT));
    if (score < bestScore - 1e-9) {
      best = cols;
      bestScore = score;
    }
  }
  return best;
}

/** Laid-out part of a diagram in its own coordinates: rects of everything in it and its edge routes. */
interface Piece {
  w: number;
  h: number;
  rects: Map<string, Rect>;
  edges: Map<string, Point[]>;
}

/** Copy `from` into `into`, moved by (dx, dy). */
function placePiece(into: Piece, from: Piece, dx: number, dy: number): void {
  for (const [id, r] of from.rects) into.rects.set(id, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
  for (const [id, pts] of from.edges) into.edges.set(id, pts.map((p) => ({ x: round(p.x + dx), y: round(p.y + dy) })));
}

/**
 * Row-first grid of `items`: every column as wide as its widest cell, every row as tall as its tallest.
 * `center` centres an item in its cell; otherwise it sits at the cell's top-left.
 */
export function packGrid(items: readonly Piece[], cols: number, gapX: number, gapY: number, center: boolean): Piece {
  const colW: number[] = [];
  const rowH: number[] = [];
  items.forEach((it, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, it.w);
    rowH[r] = Math.max(rowH[r] ?? 0, it.h);
  });
  const xs: number[] = [];
  const ys: number[] = [];
  colW.reduce((x, w, c) => ((xs[c] = x), x + w + gapX), 0);
  rowH.reduce((y, h, r) => ((ys[r] = y), y + h + gapY), 0);
  const out: Piece = {
    w: colW.reduce((a, b) => a + b, 0) + gapX * (colW.length - 1),
    h: rowH.reduce((a, b) => a + b, 0) + gapY * (rowH.length - 1),
    rects: new Map(),
    edges: new Map(),
  };
  items.forEach((it, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const dx = center ? (colW[c]! - it.w) / 2 : 0;
    const dy = center ? (rowH[r]! - it.h) / 2 : 0;
    placePiece(out, it, xs[c]! + dx, ys[r]! + dy);
  });
  return out;
}

/**
 * Put `tail` after the laid-out content of `piece` in the flow direction (right of it, under it, ...), one
 * big-block gap away and lined up with its start, and grow `piece` to hold it.
 */
function attachTail(piece: Piece, tail: Piece, direction: GraphDiagram['direction']): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of piece.rects.values()) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const gap = SPACING.block;
  const at =
    direction === 'right' ? { x: x1 + gap, y: y0 }
    : direction === 'left' ? { x: x0 - gap - tail.w, y: y0 }
    : direction === 'up' ? { x: x0, y: y0 - gap - tail.h }
    : { x: x0, y: y1 + gap };
  placePiece(piece, tail, at.x, at.y);
  piece.w = Math.max(piece.w, at.x + tail.w);
  piece.h = Math.max(piece.h, at.y + tail.h);
}

/**
 * Which children are free: a node no edge touches, or a group no edge crosses (edges inside it are fine,
 * it gets laid out on its own). Free siblings go in a grid instead of ELK's first layer (spec §1.4).
 */
function freeChildren(edges: readonly GraphEdge[], parent: ReadonlyMap<string, string | undefined>): (c: GraphChild) => boolean {
  const touched = new Set<string>();
  const crossed = new Set<string>();
  const chain = (id: string): string[] => {
    const out = [id];
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) out.push(p);
    return out;
  };
  for (const e of edges) {
    touched.add(e.from);
    touched.add(e.to);
    const a = chain(e.from);
    const b = chain(e.to);
    for (const x of a) if (!b.includes(x)) crossed.add(x);
    for (const x of b) if (!a.includes(x)) crossed.add(x);
  }
  return (c) => (c.kind === 'node' ? !touched.has(c.id) : !crossed.has(c.id));
}

function measureGroup(d: GraphDiagram, group: GraphGroup): GroupGeom {
  const style = styleFor(d, group.attrs, group.span.line);
  const size = fontSize(style);
  const label = measureLabel(group.label, size, style.typeface, false, Infinity, true);
  const iconSize = group.attrs.icon ? Math.round(size * 1.4) : 0;
  const header = Math.max(GROUP_PAD.top, Math.max(label.h, iconSize) + 22);
  return { group, style, label, iconSize, header, minW: Math.ceil(label.w + (iconSize ? iconSize + 8 : 0) + 40) };
}

/** Clip the segment from the centre of `r` towards `p` at the rectangle border. */
function clipToRect(r: { x: number; y: number; w: number; h: number }, p: Point): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(dx === 0 ? Infinity : r.w / 2 / Math.abs(dx), dy === 0 ? Infinity : r.h / 2 / Math.abs(dy));
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Whether `p` is inside the drawn outline of a shape whose bounding box is `r` (rect-like shapes: the box). */
function insideShape(shape: string, r: Rect, p: Point): boolean {
  const u = (p.x - (r.x + r.w / 2)) / (r.w / 2);
  const v = (p.y - (r.y + r.h / 2)) / (r.h / 2);
  if (shape === 'diamond') return Math.abs(u) + Math.abs(v) <= 1;
  if (shape === 'circle' || shape === 'ellipse') return u * u + v * v <= 1;
  return Math.abs(u) <= 1 && Math.abs(v) <= 1;
}

const CURVED = new Set(['diamond', 'circle', 'ellipse']);

/**
 * Move `p` (on the bounding box) along the ray towards `toward` (a point further out on the edge)
 * reversed, i.e. into the node, until it meets the shape outline.
 */
function snapToShape(shape: string, r: Rect, p: Point, toward: Point): Point {
  if (!CURVED.has(shape)) return p;
  const dx = p.x - toward.x;
  const dy = p.y - toward.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  const reach = Math.hypot(r.w, r.h);
  const at = (t: number): Point => ({ x: p.x + (dx / len) * t, y: p.y + (dy / len) * t });
  const N = 64;
  let hi = -1;
  for (let i = 0; i <= N; i++) {
    if (insideShape(shape, r, at((reach * i) / N))) {
      hi = i;
      break;
    }
  }
  if (hi < 0) return p;
  if (hi === 0) return p;
  let lo = (reach * (hi - 1)) / N;
  let up = (reach * hi) / N;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + up) / 2;
    if (insideShape(shape, r, at(mid))) up = mid;
    else lo = mid;
  }
  return at(up);
}

/** Like clipToRect, but to the drawn outline of diamonds, circles and ellipses. */
function clipToShape(shape: string | undefined, r: Rect, p: Point): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const u = Math.abs(p.x - cx) / (r.w / 2);
  const v = Math.abs(p.y - cy) / (r.h / 2);
  let k = 0;
  if (shape === 'diamond') k = u + v;
  else if (shape === 'circle' || shape === 'ellipse') k = Math.hypot(u, v);
  if (k === 0) return clipToRect(r, p);
  return { x: cx + (p.x - cx) / k, y: cy + (p.y - cy) / k };
}

/** Label centre on the drawn line: the middle of its longest segment (arc: the curve's midpoint). */
function labelAnchor(points: Point[], route: string): Point {
  if (route === 'arc' && points.length === 2) {
    const [p0, p1] = points as [Point, Point];
    return { x: (p0.x + p1.x) / 2 - (p1.y - p0.y) * 0.1, y: (p0.y + p1.y) / 2 + (p1.x - p0.x) * 0.1 };
  }
  let best = 0;
  let at = { x: points[0]!.x, y: points[0]!.y };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best + 0.5) {
      best = len;
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return at;
}

/** How far a label that would overlap moves along its line towards the end node (spec §1.7: 22-26 px). */
export const LABEL_SHIFT = 24;

/** Plate rect of a label centred on `c`, as drawn by sceneToSvg. */
function labelRect(c: Point, label: Label): Rect {
  const w = label.w + PLATE_PAD * 2;
  return { x: c.x - w / 2, y: c.y - label.h / 2 - 2, w, h: label.h + 4 };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Label centre for an edge: the middle of its longest segment, or, when that plate would overlap a label
 * already placed or a node, moved along the line towards the end node in LABEL_SHIFT steps (first clear
 * spot wins; none clear keeps the middle). Records the chosen plate in `placed`.
 */
function placeLabel(points: Point[], route: string, label: Label, placed: Rect[], nodeRects: Rect[]): Point {
  const start = labelAnchor(points, route);
  const clear = (c: Point): boolean => {
    const r = labelRect(c, label);
    return !placed.some((o) => overlaps(r, o)) && !nodeRects.some((o) => overlaps(r, o));
  };
  let best = start;
  if (!clear(start)) {
    // Path from the anchor to the end of the line.
    const last = points[points.length - 1]!;
    let path: Point[] = [start, last];
    if (route !== 'arc') {
      let k = 1;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const t = Math.hypot(b.x - a.x, b.y - a.y);
        if (t > 0 && Math.abs(Math.hypot(start.x - a.x, start.y - a.y) + Math.hypot(b.x - start.x, b.y - start.y) - t) < 0.01) { k = i; break; }
      }
      path = [start, ...points.slice(k)];
    }
    const total = path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1]!.x, p.y - path[i - 1]!.y) : 0), 0);
    const at = (d: number): Point => {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const t = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= t) return t ? { x: a.x + ((b.x - a.x) * d) / t, y: a.y + ((b.y - a.y) * d) / t } : a;
        d -= t;
      }
      return path[path.length - 1]!;
    };
    for (let d = LABEL_SHIFT; d <= total; d += LABEL_SHIFT) {
      const c = at(d);
      if (clear(c)) { best = { x: round(c.x), y: round(c.y) }; break; }
    }
  }
  placed.push(labelRect(best, label));
  return best;
}

/** A laid-out edge before overrides: its ELK route (layout coordinates) and what drawing it needs. */
interface BaseEdge {
  edge: GraphEdge;
  style: ElementStyle;
  label?: Label;
  points: Point[];
  /** Self loops, ancestor links and parallel edges always draw elbow. */
  forcedElbow: boolean;
  /** Position among the drawn edges joining the same two ends, and how many there are. */
  pairIndex: number;
  pairSize: number;
}

/**
 * The slow, cacheable half of a graph layout: measurements and the ELK result in layout coordinates
 * (ELK root space, before `finishScene` moves everything to start at the padding). Read-only for
 * `composeGraph`, so one base serves every drag preview of the same code.
 */
export interface GraphBase {
  readonly nodes: ReadonlyMap<string, NodeGeom>;
  readonly groups: ReadonlyMap<string, GroupGeom>;
  /** Parent group of every node and group, `undefined` at the root. */
  readonly parent: ReadonlyMap<string, string | undefined>;
  readonly rects: ReadonlyMap<string, Readonly<Rect>>;
  readonly edges: readonly BaseEdge[];
}

/** Measure the diagram and run ELK. Async and slow; cache the result per AST. */
export async function graphBase(d: GraphDiagram): Promise<GraphBase> {
  const nodes = new Map<string, NodeGeom>();
  const groups = new Map<string, GroupGeom>();
  const parent = new Map<string, string | undefined>();
  const elkId = (id: string): string => `n:${id}`;

  const measure = (child: GraphChild, parentId: string | undefined): void => {
    parent.set(child.id, parentId);
    if (child.kind === 'node') {
      nodes.set(child.id, measureNode(d, child));
      return;
    }
    groups.set(child.id, measureGroup(d, child));
    for (const c of child.children) measure(c, child.id);
  };
  for (const c of d.children) measure(c, undefined);
  const order = definitionOrder(d);
  const edges: GraphEdge[] = d.edges.filter((e) => parent.has(e.from) && parent.has(e.to));
  const free = freeChildren(edges, parent);
  // Free root nodes share one size (they go in the root grid). A lone one forms a set of one, so it keeps
  // its own size anyway.
  const loose = new Set(d.children.filter((c) => c.kind === 'node' && free(c)).map((c) => c.id));
  unifySizes(nodes.values(), parent, rootLayers(d, parent, order), loose);

  // ELK reads spacing per parent, so every group gets its own values (else ELK's 20 px default).
  const vertical = d.direction === 'down' || d.direction === 'up';
  const spacingFor = (kids: readonly GraphChild[]): Record<string, string> => ({
    'elk.spacing.nodeNode': String(
      kids.some((c) => c.kind === 'group') ? SPACING.block : vertical ? SPACING.neighbour : SPACING.list,
    ),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(SPACING.layer),
    'elk.spacing.edgeNode': '24',
    'elk.spacing.edgeEdge': '16',
    'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'elk.spacing.edgeLabel': '4',
  });
  const isAncestor = (a: string, b: string): boolean => {
    for (let p = parent.get(b); p !== undefined; p = parent.get(p)) if (p === a) return true;
    return false;
  };
  const pairCount = new Map<string, number>();
  const pairKey = (e: GraphEdge): string => [e.from, e.to].sort().join('\u0000');
  for (const e of d.edges) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);

  const edgeLabels = new Map<string, Label>();
  for (const e of edges) {
    const style = styleFor(d, e.attrs, e.span.line);
    if (e.label) edgeLabels.set(e.id, measureLabel(e.label, EDGE_LABEL_SIZE, style.typeface, style.wrap, 140));
  }
  const elkEdge = (e: GraphEdge): ElkExtendedEdge => {
    const label = edgeLabels.get(e.id);
    const flip = flipped(e, order);
    return {
      id: `e:${e.id}`,
      sources: [elkId(flip ? e.to : e.from)],
      targets: [elkId(flip ? e.from : e.to)],
      labels: label ? [{ id: `l:${e.id}`, text: e.label!, width: Math.ceil(label.w + PLATE_PAD * 2), height: label.h + 4 }] : [],
    };
  };
  /** Free nodes and groups placed in a grid: alignment leaves them where the grid put them (spec §1.4). */
  const gridded = new Set<string>();
  /** Groups whose children all went in one grid: they keep the grid's fitted size (spec §1.2 exception). */
  const gridGroups = new Set<string>();

  /** Lay out `top` (the diagram's children, or one free group) with ELK; free siblings go in grids. */
  const layoutScope = async (top: readonly GraphChild[]): Promise<Piece> => {
    const present = new Set<string>();
    const grids = new Map<string, Piece>();
    /** Free block of the scope's top level when it also has linked children: placed after ELK, not by it. */
    let tail: Piece | undefined;
    const build = async (kids: readonly GraphChild[], key: string): Promise<ElkNode[]> => {
      const loose = kids.filter((c) => free(c));
      const linked = loose.length >= 2 ? kids.filter((c) => !free(c)) : kids;
      const out: ElkNode[] = [];
      for (const c of linked) out.push(await toElk(c));
      if (loose.length >= 2 && key === '' && linked.length > 0) {
        // ELK's LAST_SEPARATE would give the block a layer of its own, but crashes on some graphs.
        tail = await gridOf(loose);
      } else if (loose.length >= 2) {
        const block = await gridOf(loose);
        const id = `grid:${key}`;
        grids.set(id, block);
        // A group whose children all went in the grid keeps the grid's fitted width (spec §1.2 exception).
        if (linked.length === 0 && key !== '') gridGroups.add(key);
        // Spec §1.4: the unconnected rest of a partly connected parent goes at its end.
        const last = linked.length > 0 ? { layoutOptions: { 'elk.layered.layering.layerConstraint': 'LAST' } } : {};
        out.push({ id, width: block.w, height: block.h, ...last });
      }
      return out;
    };
    const toElk = async (child: GraphChild): Promise<ElkNode> => {
      present.add(child.id);
      if (child.kind === 'node') {
        const g = nodes.get(child.id)!;
        return { id: elkId(child.id), width: g.w, height: g.h };
      }
      const g = groups.get(child.id)!;
      const kids = await build(child.children, child.id);
      return {
        id: elkId(child.id),
        ...(kids.length === 0 ? { width: g.minW, height: g.header + 40 } : {}),
        children: kids,
        layoutOptions: {
          ...spacingFor(child.children),
          'elk.padding': `[top=${g.header},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`,
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': `(${g.minW},${g.header + 40})`,
        },
      };
    };
    const children = await build(top, '');
    const scopeEdges = edges.filter((e) => present.has(e.from) && present.has(e.to));
    const root: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': ELK_DIRECTION[d.direction],
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.edgeRouting': 'ORTHOGONAL',
        ...MODEL_ORDER,
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        ...spacingFor(top),
        'elk.edgeLabels.inline': 'true',
        'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
      },
      children,
      edges: scopeEdges.map(elkEdge),
    };

    const out = await runElk(root);
    const abs = absolutePositions(out);
    const piece: Piece = { w: out.width ?? 0, h: out.height ?? 0, rects: new Map(), edges: new Map() };
    const sizes = new Map<string, { w: number; h: number }>();
    const collect = (n: ElkNode): void => {
      for (const c of n.children ?? []) {
        sizes.set(c.id, { w: c.width ?? 0, h: c.height ?? 0 });
        collect(c);
      }
    };
    collect(out);
    for (const [id, p] of abs) {
      const s = sizes.get(id);
      if (s && id.startsWith('n:')) piece.rects.set(id.slice(2), { x: p.x, y: p.y, w: s.w, h: s.h });
      const grid = grids.get(id);
      if (grid) placePiece(piece, grid, p.x, p.y);
    }
    if (tail) attachTail(piece, tail, d.direction);
    const laid = new Map((out.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge & { container?: string }]));
    for (const e of scopeEdges) {
      const le = laid.get(`e:${e.id}`);
      const section = le?.sections?.[0];
      if (!le || !section) continue;
      const o = edgeOffset(le, abs);
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: round(p.x + o.x), y: round(p.y + o.y) }));
      if (flipped(e, order)) points.reverse();
      piece.edges.set(e.id, orthogonalize(points));
    }
    return piece;
  };

  /** A free group laid out on its own, in its own coordinates (top-left 0,0). */
  const groupPiece = async (g: GraphGroup): Promise<Piece> => {
    const laid = await layoutScope([g]);
    const r = laid.rects.get(g.id)!;
    const piece: Piece = { w: r.w, h: r.h, rects: new Map(), edges: new Map() };
    placePiece(piece, laid, -r.x, -r.y);
    return piece;
  };

  /**
   * Free siblings as one block (spec §1.4): free nodes in a row-first grid, then each free group as a cell
   * of a second grid whose columns keep the block near BAND_ASPECT (wide bands stack, as Eraser's do in
   * either direction).
   */
  const gridOf = async (loose: readonly GraphChild[]): Promise<Piece> => {
    const leaves: Piece[] = [];
    const bands: Piece[] = [];
    for (const c of loose) {
      gridded.add(c.id);
      if (c.kind === 'node') {
        const g = nodes.get(c.id)!;
        leaves.push({ w: g.w, h: g.h, rects: new Map([[c.id, { x: 0, y: 0, w: g.w, h: g.h }]]), edges: new Map() });
      } else bands.push(await groupPiece(c));
    }
    if (leaves.length > 0) bands.unshift(packGrid(leaves, gridColumns(leaves.length), GRID_GAP.x, GRID_GAP.y, true));
    if (bands.length === 1) return bands[0]!;
    return packGrid(bands, bandColumns(bands), BAND_GAP.row, BAND_GAP.stack, false);
  };

  const placed = await layoutScope(d.children);
  const pairSeen = new Map<string, number>();
  const baseEdges: BaseEdge[] = [];
  for (const e of edges) {
    const points = placed.edges.get(e.id);
    if (!points) continue;
    const key = pairKey(e);
    const pairIndex = pairSeen.get(key) ?? 0;
    pairSeen.set(key, pairIndex + 1);
    baseEdges.push({
      edge: e,
      style: styleFor(d, e.attrs, e.span.line),
      label: edgeLabels.get(e.id),
      points,
      forcedElbow: e.from === e.to || isAncestor(e.from, e.to) || isAncestor(e.to, e.from) || (pairCount.get(key) ?? 0) > 1,
      pairIndex,
      pairSize: 0,
    });
  }
  for (const be of baseEdges) be.pairSize = pairSeen.get(pairKey(be.edge)) ?? 1;

  // Spec §1.8 steps 4-5: snap layer centres, match sibling group bands, keep edges attached. Grid cells
  // stay as packed: grid groups keep their fitted width and left edge (spec §1.2 exception, §1.4).
  const rects = placed.rects;
  const kids = new Map<string | undefined, string[]>([[undefined, d.children.map((c) => c.id)]]);
  for (const g of groups.values()) kids.set(g.group.id, g.group.children.map((c) => c.id));
  alignLayout(
    {
      kids,
      parent,
      pad: (id) => ({ top: groups.get(id)!.header, side: GROUP_PAD.side, bottom: GROUP_PAD.bottom }),
      order,
      fixed: gridded,
      fitted: gridGroups,
    },
    rects,
    baseEdges.map((be) => ({ from: be.edge.from, to: be.edge.to, points: be.points })),
    vertical,
  );
  for (const be of baseEdges) be.points = be.points.map((p) => ({ x: round(p.x), y: round(p.y) }));
  // Spec §1.8 step 6: even ports, straight lines first, at most two bends, shared buses.
  routeEdges(rects, parent, baseEdges.map((be) => ({ from: be.edge.from, to: be.edge.to, points: be.points, keep: be.forcedElbow })));

  return { nodes, groups, parent, rects, edges: baseEdges };
}

/** Spacing between parallel edges' bends and end points when the router redraws them. */
const PARALLEL_GAP = 12;

interface Delta {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

const ZERO: Delta = { dx: 0, dy: 0, dw: 0, dh: 0 };
/** Centre-to-corner arithmetic leaves float noise; anything below this is "not moved". */
const EPS = 1e-6;
const near = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
const isZero = (d: Delta): boolean => near(d.dx, 0) && near(d.dy, 0) && near(d.dw, 0) && near(d.dh, 0);
const sameShift = (a: Delta, b: Delta): boolean =>
  near(a.dw, 0) && near(a.dh, 0) && near(b.dw, 0) && near(b.dh, 0) && near(a.dx, b.dx) && near(a.dy, b.dy);

/**
 * Apply `layout` to copies of the ELK rects: overridden nodes (and empty groups) move their centre,
 * groups with moved descendants refit inner-first. Overrides that do not match the current code
 * (unknown name, group with children, different parent, bad numbers, unknown `v`) are ignored.
 */
function placeRects(d: GraphDiagram, base: GraphBase, layout: BlockLayout | undefined): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, r] of base.rects) rects.set(id, { ...r });
  if (!layout || layout.v !== BLOCK_LAYOUT_VERSION || typeof layout.items !== 'object' || layout.items === null) return rects;

  let any = false;
  for (const id of Object.keys(layout.items)) {
    const it = layout.items[id];
    const r = rects.get(id);
    if (!it || !r || !Number.isFinite(it.cx) || !Number.isFinite(it.cy)) continue;
    const group = base.groups.get(id);
    if (group && group.group.children.length > 0) continue;
    if (it.parent !== (base.parent.get(id) ?? '')) continue;
    r.x = it.cx - r.w / 2;
    r.y = it.cy - r.h / 2;
    any = true;
  }
  if (!any) return rects;

  const deltaOf = (id: string): Delta => {
    const a = base.rects.get(id);
    const b = rects.get(id);
    return a && b ? { dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w, dh: b.h - a.h } : ZERO;
  };
  /** Refit `g` around its children; returns the deltas of its leaves (nodes and empty groups). */
  const fit = (g: GraphGroup): Delta[] => {
    if (g.children.length === 0) return [deltaOf(g.id)];
    const leaves: Delta[] = [];
    for (const c of g.children) leaves.push(...(c.kind === 'group' ? fit(c) : [deltaOf(c.id)]));
    if (leaves.every(isZero)) return leaves;
    const r = rects.get(g.id)!;
    const first = leaves[0]!;
    if (leaves.every((l) => sameShift(l, first))) {
      // Dragged as a whole: keep ELK's box, shifted.
      const b = base.rects.get(g.id)!;
      r.x = b.x + first.dx;
      r.y = b.y + first.dy;
      return leaves;
    }
    const geom = base.groups.get(g.id)!;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of g.children) {
      const cr = rects.get(c.id)!;
      x0 = Math.min(x0, cr.x);
      y0 = Math.min(y0, cr.y);
      x1 = Math.max(x1, cr.x + cr.w);
      y1 = Math.max(y1, cr.y + cr.h);
    }
    r.x = x0 - GROUP_PAD.side;
    r.y = y0 - geom.header;
    r.w = Math.max(x1 - x0 + GROUP_PAD.side * 2, geom.minW);
    r.h = Math.max(y1 - y0 + geom.header + GROUP_PAD.bottom, geom.header + 40);
    return leaves;
  };
  for (const c of d.children) if (c.kind === 'group') fit(c);
  return rects;
}

/** Drop repeated points and middle points of straight runs. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const q = { x: round(p.x), y: round(p.y) };
    const last = out[out.length - 1];
    if (last && last.x === q.x && last.y === q.y) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((prev.x === last.x && last.x === q.x) || (prev.y === last.y && last.y === q.y))) out.pop();
    out.push(q);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Orthogonal route for an edge whose ends moved (no obstacle avoidance). Leaves `a` from the side facing
 * `b`: east/west with H-V-H when the centres differ more horizontally, else north/south with V-H-V.
 * `offset` spreads parallel edges apart.
 */
function routeElbow(a: Rect, b: Rect, offset: number): Point[] {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = dx >= 0 ? 1 : -1;
    const p0 = { x: ac.x + (s * a.w) / 2, y: ac.y + clamp(offset, -a.h / 2 + 4, a.h / 2 - 4) };
    const p1 = { x: bc.x - (s * b.w) / 2, y: bc.y + clamp(offset, -b.h / 2 + 4, b.h / 2 - 4) };
    const mx = (p0.x + p1.x) / 2 + offset;
    return simplify([p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1]);
  }
  const s = dy >= 0 ? 1 : -1;
  const p0 = { x: ac.x + clamp(offset, -a.w / 2 + 4, a.w / 2 - 4), y: ac.y + (s * a.h) / 2 };
  const p1 = { x: bc.x + clamp(offset, -b.w / 2 + 4, b.w / 2 - 4), y: bc.y - (s * b.h) / 2 };
  const my = (p0.y + p1.y) / 2 + offset;
  return simplify([p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1]);
}

/**
 * Route from a group to a node inside it (`outer` contains `inner`): down from just under the header
 * to the node's top (V-H-V), or, when the node sits right under the header, across from the nearer wall.
 */
function routeIntoGroup(outer: Rect, header: number, inner: Rect, offset: number): Point[] {
  const ic = { x: inner.x + inner.w / 2 + clamp(offset, -inner.w / 2 + 4, inner.w / 2 - 4), y: inner.y + inner.h / 2 };
  const top = outer.y + header;
  if (inner.y - top >= 16) {
    const p0 = { x: outer.x + outer.w / 2 + offset, y: top };
    const my = (top + inner.y) / 2;
    return simplify([p0, { x: p0.x, y: my }, { x: ic.x, y: my }, { x: ic.x, y: inner.y }]);
  }
  const y = inner.y + inner.h / 2 + clamp(offset, -inner.h / 2 + 4, inner.h / 2 - 4);
  const left = ic.x < outer.x + outer.w / 2;
  return simplify([{ x: left ? outer.x : outer.x + outer.w, y }, { x: left ? inner.x : inner.x + inner.w, y }]);
}

/** Paint the diagram from `base`, with `layout` overrides applied. Synchronous and fast (drag previews). */
export function composeGraph(d: GraphDiagram, base: GraphBase, layout?: BlockLayout): Scene {
  const { nodes, groups } = base;
  const rects = placeRects(d, base, layout);
  const deltaOf = (id: string): Delta => {
    const a = base.rects.get(id);
    const b = rects.get(id);
    return a && b ? { dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w, dh: b.h - a.h } : ZERO;
  };
  const isAncestor = (a: string, b: string): boolean => {
    for (let p = base.parent.get(b); p !== undefined; p = base.parent.get(p)) if (p === a) return true;
    return false;
  };

  const groupItems: SceneItem[] = [];
  const nodeItems: SceneItem[] = [];
  const edgeItems: SceneItem[] = [];
  const labelItems: SceneItem[] = [];
  const handles: SceneHandle[] = [];
  const handle = (id: string, kind: 'node' | 'group'): void => {
    const r = rects.get(id)!;
    handles.push({ id, kind, parent: base.parent.get(id) ?? '', x: r.x, y: r.y, w: r.w, h: r.h, moved: !isZero(deltaOf(id)) });
  };

  // Groups, outer first so inner boxes paint on top.
  const drawGroups = (list: GraphChild[]): void => {
    for (const c of list) {
      if (c.kind !== 'group') continue;
      const g = groups.get(c.id)!;
      const r = rects.get(c.id)!;
      handle(c.id, 'group');
      groupItems.push({ kind: 'box', id: c.id, role: 'group', shape: 'rectangle', x: r.x, y: r.y, w: r.w, h: r.h, paint: g.style.paint, shadow: false });
      let tx = r.x + 14;
      const midY = r.y + 11 + Math.max(g.label.h, g.iconSize) / 2;
      if (g.iconSize) {
        groupItems.push({ kind: 'icon', name: c.attrs.icon!, x: tx, y: midY - g.iconSize / 2, size: g.iconSize, paint: g.style.paint });
        tx += g.iconSize + 8;
      }
      groupItems.push(textItem(g.label.lines, tx, midY - g.label.h / 2, { size: g.label.size, font: g.style.typeface, anchor: 'start', weight: 600, on: { ...g.style.paint, mode: g.style.paint.mode === 'bold' ? 'pastel' : g.style.paint.mode } }));
      drawGroups(c.children);
    }
  };
  drawGroups(d.children);

  for (const g of nodes.values()) {
    const r = rects.get(g.node.id)!;
    handle(g.node.id, 'node');
    const { style, label } = g;
    if (g.iconOnly) {
      nodeItems.push({ kind: 'icon', name: g.node.attrs.icon!, x: r.x + r.w / 2 - g.iconSize / 2, y: r.y, size: g.iconSize, paint: style.paint });
      nodeItems.push(textItem(label.lines, r.x + r.w / 2, r.y + g.iconSize + 6, { size: label.size, font: style.typeface }));
      continue;
    }
    nodeItems.push({ kind: 'box', id: g.node.id, role: 'node', shape: g.shape, x: r.x, y: r.y, w: r.w, h: r.h, paint: style.paint, shadow: style.styleMode !== 'plain' && style.paint.mode !== 'outline' });
    const cy = g.shape === 'triangle' ? r.y + r.h * 0.64 : g.shape === 'cylinder' ? r.y + r.h / 2 + 5 : r.y + r.h / 2;
    const contentW = label.w + (g.iconSize ? g.iconSize + 8 : 0);
    let x = r.x + r.w / 2 - contentW / 2;
    if (g.iconSize) {
      nodeItems.push({ kind: 'icon', name: g.node.attrs.icon!, x, y: cy - g.iconSize / 2, size: g.iconSize, paint: style.paint, inside: true });
      x += g.iconSize + 8;
    }
    nodeItems.push(textItem(label.lines, g.iconSize ? x : r.x + r.w / 2, cy - label.h / 2, { size: label.size, font: style.typeface, anchor: g.iconSize ? 'start' : 'middle', on: style.paint }));
  }

  // Spec §1.7: straight connectors join side ports dealt out at (i + 1) / (n + 1), as soft diagonal lines.
  const straight = base.edges.filter((be) => !be.forcedElbow && be.style.connectorStyle === 'straight');
  const ports = straightPorts(rects, straight.map((be) => be.edge));
  const portOf = new Map(straight.map((be, i) => [be, ports[i]!]));

  const nodeRects = [...nodes.keys()].map((id) => rects.get(id)!).filter(Boolean);
  const placedLabels: Rect[] = [];

  for (const be of base.edges) {
    const { edge: e, style } = be;
    const route = be.forcedElbow ? 'elbow' : style.connectorStyle;
    const a = rects.get(e.from)!;
    const b = rects.get(e.to)!;
    let points: Point[];
    const port = portOf.get(be);
    if (port) {
      const p0 = clipToShape(nodes.get(e.from)?.shape, a, port[0]);
      const p1 = clipToShape(nodes.get(e.to)?.shape, b, port[1]);
      points = [p0, p1].map((p) => ({ x: round(p.x), y: round(p.y) }));
    } else if (route !== 'elbow') {
      const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
      const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const p0 = clipToShape(nodes.get(e.from)?.shape, a, bc);
      const p1 = clipToShape(nodes.get(e.to)?.shape, b, ac);
      points = [p0, p1].map((p) => ({ x: round(p.x), y: round(p.y) }));
    } else {
      const da = deltaOf(e.from);
      const db = deltaOf(e.to);
      const offset = (be.pairIndex - (be.pairSize - 1) / 2) * PARALLEL_GAP;
      if (isZero(da) && isZero(db)) points = be.points.map((p) => ({ ...p }));
      else if (e.from === e.to || sameShift(da, db)) points = be.points.map((p) => ({ x: round(p.x + da.dx), y: round(p.y + da.dy) }));
      else if (isAncestor(e.from, e.to)) points = routeIntoGroup(a, groups.get(e.from)!.header, b, offset);
      else if (isAncestor(e.to, e.from)) points = routeIntoGroup(b, groups.get(e.to)!.header, a, offset).reverse();
      else points = routeElbow(a, b, offset);
      if (points.length >= 2 && e.from !== e.to) {
        const sa = nodes.get(e.from)?.shape;
        const sb = nodes.get(e.to)?.shape;
        if (sa) points[0] = snapToShape(sa, a, points[0]!, points[1]!);
        if (sb) points[points.length - 1] = snapToShape(sb, b, points[points.length - 1]!, points[points.length - 2]!);
      }
    }
    const edge: SceneEdge = {
      kind: 'edge',
      id: e.id,
      points,
      route,
      dashed: e.lineStyle === 'dashed',
      start: e.startArrow ? 'arrow' : 'none',
      end: e.endArrow ? 'arrow' : 'none',
      color: style.paint.color,
    };
    if (port) edge.soft = true;
    edgeItems.push(edge);
    const label = be.label;
    if (label) {
      const { x: cx, y: cy } = placeLabel(points, route, label, placedLabels, nodeRects);
      labelItems.push(textItem(label.lines, cx, cy - label.h / 2, { size: label.size, font: style.typeface, plate: true, color: style.paint.color, tone: 'muted' }));
    }
  }

  const scene = finishScene(d.type, d, [...groupItems, ...edgeItems, ...nodeItems, ...labelItems]);
  const o = scene.origin ?? { x: 0, y: 0 };
  scene.handles = handles.map((h) => ({ ...h, x: round(h.x + o.x), y: round(h.y + o.y), w: round(h.w), h: round(h.h) }));
  return scene;
}

/** ELK layout with optional overrides: `composeGraph(d, await graphBase(d), layout)`. */
export async function layoutGraph(d: GraphDiagram, layout?: BlockLayout): Promise<Scene> {
  return composeGraph(d, await graphBase(d), layout);
}
