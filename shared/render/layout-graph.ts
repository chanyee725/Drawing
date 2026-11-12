// Cloud architecture and flowchart: ELK layered layout with groups as compound nodes.

import type { GraphChild, GraphDiagram, GraphEdge, GraphGroup, GraphNode } from '../dsl/index.ts';
import { finishScene, fontSize, measureLabel, round, styleFor, textItem } from './common.ts';
import type { ElementStyle, Label } from './common.ts';
import { absolutePositions, edgeOffset, runElk } from './elk.ts';
import type { ElkExtendedEdge, ElkNode } from './elk.ts';
import type { Point, Scene, SceneEdge, SceneItem, ShapeKind } from './scene.ts';

const SHAPES: readonly ShapeKind[] = [
  'rectangle', 'circle', 'cylinder', 'diamond', 'document', 'ellipse',
  'hexagon', 'oval', 'parallelogram', 'star', 'trapezoid', 'triangle',
];

const ELK_DIRECTION = { down: 'DOWN', up: 'UP', left: 'LEFT', right: 'RIGHT' } as const;
const NODE_TEXT_MAX = 160;
const EDGE_LABEL_SIZE = 12;

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
  const label = measureLabel(node.label, size, style.typeface, style.wrap, NODE_TEXT_MAX);
  const iconSize = icon ? Math.round(size * 1.5) : 0;
  const cw = label.w + (icon ? iconSize + 8 : 0);
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
    case 'cylinder':
      h += 18;
      break;
    case 'document':
      h += 10;
      break;
    default:
      break;
  }
  return { node, style, label, shape, iconOnly: false, iconSize, w: Math.ceil(w), h: Math.ceil(h) };
}

function measureGroup(d: GraphDiagram, group: GraphGroup): GroupGeom {
  const style = styleFor(d, group.attrs, group.span.line);
  const size = fontSize(style);
  const label = measureLabel(group.label, size, style.typeface, false, Infinity, true);
  const iconSize = group.attrs.icon ? Math.round(size * 1.4) : 0;
  const header = Math.max(label.h, iconSize) + 22;
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

type Rect = { x: number; y: number; w: number; h: number };

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

export async function layoutGraph(d: GraphDiagram): Promise<Scene> {
  const nodes = new Map<string, NodeGeom>();
  const groups = new Map<string, GroupGeom>();
  const parent = new Map<string, string | undefined>();
  const elkId = (id: string): string => `n:${id}`;

  const toElk = (child: GraphChild, parentId: string | undefined): ElkNode => {
    parent.set(child.id, parentId);
    if (child.kind === 'node') {
      const g = measureNode(d, child);
      nodes.set(child.id, g);
      return { id: elkId(child.id), width: g.w, height: g.h };
    }
    const g = measureGroup(d, child);
    groups.set(child.id, g);
    const kids = child.children.map((c) => toElk(c, child.id));
    return {
      id: elkId(child.id),
      ...(kids.length === 0 ? { width: g.minW, height: g.header + 40 } : {}),
      children: kids,
      layoutOptions: {
        'elk.padding': `[top=${g.header},left=20,bottom=20,right=20]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${g.minW},${g.header + 40})`,
      },
    };
  };
  const children = d.children.map((c) => toElk(c, undefined));

  const isAncestor = (a: string, b: string): boolean => {
    for (let p = parent.get(b); p !== undefined; p = parent.get(p)) if (p === a) return true;
    return false;
  };
  const pairCount = new Map<string, number>();
  const pairKey = (e: GraphEdge): string => [e.from, e.to].sort().join('\u0000');
  for (const e of d.edges) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);

  const edges: GraphEdge[] = d.edges.filter((e) => parent.has(e.from) && parent.has(e.to));
  const edgeLabels = new Map<string, Label>();
  const elkEdges: ElkExtendedEdge[] = edges.map((e) => {
    const style = styleFor(d, e.attrs, e.span.line);
    const label = e.label ? measureLabel(e.label, EDGE_LABEL_SIZE, style.typeface, style.wrap, 140) : undefined;
    if (label) edgeLabels.set(e.id, label);
    return {
      id: `e:${e.id}`,
      sources: [elkId(e.from)],
      targets: [elkId(e.to)],
      labels: label ? [{ id: `l:${e.id}`, text: e.label!, width: Math.ceil(label.w + 8), height: label.h + 4 }] : [],
    };
  });

  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ELK_DIRECTION[d.direction],
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
      'elk.spacing.edgeLabel': '4',
      'elk.edgeLabels.inline': 'true',
      'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
    },
    children,
    edges: elkEdges,
  };

  const out = await runElk(root);
  const abs = absolutePositions(out);
  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
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
    if (s && id.startsWith('n:')) rects.set(id.slice(2), { x: p.x, y: p.y, w: s.w, h: s.h });
  }

  const groupItems: SceneItem[] = [];
  const nodeItems: SceneItem[] = [];
  const edgeItems: SceneItem[] = [];
  const labelItems: SceneItem[] = [];

  // Groups, outer first so inner boxes paint on top.
  const drawGroups = (list: GraphChild[]): void => {
    for (const c of list) {
      if (c.kind !== 'group') continue;
      const g = groups.get(c.id)!;
      const r = rects.get(c.id)!;
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

  const laid = new Map((out.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge & { container?: string }]));
  for (const e of edges) {
    const le = laid.get(`e:${e.id}`);
    const section = le?.sections?.[0];
    if (!le || !section) continue;
    const style = styleFor(d, e.attrs, e.span.line);
    const o = edgeOffset(le, abs);
    let points: Point[] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: round(p.x + o.x), y: round(p.y + o.y) }));
    const forcedElbow = e.from === e.to || isAncestor(e.from, e.to) || isAncestor(e.to, e.from) || (pairCount.get(pairKey(e)) ?? 0) > 1;
    const route = forcedElbow ? 'elbow' : style.connectorStyle;
    if (route !== 'elbow') {
      const a = rects.get(e.from)!;
      const b = rects.get(e.to)!;
      const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
      const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const p0 = clipToShape(nodes.get(e.from)?.shape, a, bc);
      const p1 = clipToShape(nodes.get(e.to)?.shape, b, ac);
      points = [p0, p1].map((p) => ({ x: round(p.x), y: round(p.y) }));
    }
    if (route === 'elbow' && points.length >= 2) {
      const a = rects.get(e.from);
      const b = rects.get(e.to);
      const sa = nodes.get(e.from)?.shape;
      const sb = nodes.get(e.to)?.shape;
      if (a && sa && e.from !== e.to) points[0] = snapToShape(sa, a, points[0]!, points[1]!);
      if (b && sb && e.from !== e.to) points[points.length - 1] = snapToShape(sb, b, points[points.length - 1]!, points[points.length - 2]!);
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
    edgeItems.push(edge);
    const label = edgeLabels.get(e.id);
    if (label) {
      const { x: cx, y: cy } = labelAnchor(points, route);
      labelItems.push(textItem(label.lines, cx, cy - label.h / 2, { size: label.size, font: style.typeface, plate: true, color: style.paint.color, tone: 'muted' }));
    }
  }

  return finishScene(d.type, d, [...groupItems, ...edgeItems, ...nodeItems, ...labelItems]);
}
