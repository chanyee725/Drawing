// Turn a graph block's drawing into plain Excalidraw shapes (ticket #38), without DOM or Excalidraw.
// Input is the composed scene (layout applied); output is element skeletons for convertToExcalidrawElements
// plus the arrow bindings to set afterwards. Icons are left out: nodes keep their labels only.
import type { Point, Scene, SceneBox, SceneEdge, SceneText, ShapeKind } from '../../../shared/render/scene.ts';
import { THEMES, resolvePaint, strokeOf } from '../../../shared/render/theme.ts';

/** Where the block image sits on the canvas, and the picture width it was drawn at. */
export type Placement = { x: number; y: number; width: number; height?: number };
export type Skeleton = Record<string, unknown> & { id: string; type: string };
export type ArrowBinding = { arrowId: string; startId: string | null; endId: string | null };
export type Freeform = { skeletons: Skeleton[]; bindings: ArrowBinding[] };

const SHAPE: Partial<Record<ShapeKind, 'ellipse' | 'diamond'>> = { circle: 'ellipse', ellipse: 'ellipse', oval: 'ellipse', diamond: 'diamond' };
const t = THEMES.light;

const inside = (p: Point, b: SceneBox, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
const centreOf = (tx: SceneText): Point => ({ x: tx.x, y: tx.y + (tx.lines.length * tx.lineHeight) / 2 });
const area = (b: SceneBox) => b.w * b.h;

function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
}
const distToEdge = (p: Point, e: SceneEdge) => e.points.slice(1).reduce((m, q, i) => Math.min(m, distToSegment(p, e.points[i], q)), Infinity);

/** The node box an edge end touches (on or just off its border), smallest first. */
function nodeAt(p: Point, nodes: SceneBox[]) {
  return nodes.filter((n) => inside(p, n, 6)).sort((a, b) => area(a) - area(b))[0];
}

/**
 * Skeletons for a graph scene placed like the block image: nodes become shapes with their label bound inside,
 * edges arrows (bent like the drawing) with their label, groups dashed rectangles with a title. Light colours,
 * like the block pictures.
 */
export function sceneToFreeform(scene: Scene, at: Placement, newId: () => string): Freeform {
  // The block picture may be stretched unevenly (Shift-drag), so each axis has its own scale; text and strokes use the smaller.
  const kx = scene.width > 0 ? at.width / scene.width : 1;
  const ky = scene.height > 0 && at.height ? at.height / scene.height : kx;
  const k = Math.min(kx, ky);
  const X = (x: number) => at.x + x * kx;
  const Y = (y: number) => at.y + y * ky;
  const drawn = scene.items.filter((i): i is SceneBox => i.kind === 'box');
  // Architecture nodes are an icon and a label with no box: their hit box stands in for the shape.
  const boxed = new Set(drawn.filter((b) => b.role === 'node').map((b) => b.id));
  const bare = (scene.handles ?? [])
    .filter((h) => h.kind === 'node' && !boxed.has(h.id))
    .map((h): SceneBox => ({ kind: 'box', id: h.id, role: 'node', shape: 'rectangle', x: h.x, y: h.y, w: h.w, h: h.h, paint: { mode: 'outline' }, shadow: false }));
  const boxes = [...drawn, ...bare];
  const nodes = boxes.filter((b) => b.role === 'node');
  const edges = scene.items.filter((i): i is SceneEdge => i.kind === 'edge');
  const texts = scene.items.filter((i): i is SceneText => i.kind === 'text');

  // Each text goes to the smallest node it sits in, else to the nearest edge (a label plate), else stays free.
  const nodeLabel = new Map<SceneBox, SceneText[]>();
  const edgeLabel = new Map<SceneEdge, SceneText[]>();
  const free: SceneText[] = [];
  for (const tx of texts) {
    const c = centreOf(tx);
    const node = nodes.filter((n) => inside(c, n)).sort((a, b) => area(a) - area(b))[0];
    if (node) {
      nodeLabel.set(node, [...(nodeLabel.get(node) ?? []), tx]);
      continue;
    }
    const edge = tx.plate ? edges.slice().sort((a, b) => distToEdge(c, a) - distToEdge(c, b))[0] : undefined;
    if (edge) edgeLabel.set(edge, [...(edgeLabel.get(edge) ?? []), tx]);
    else free.push(tx);
  }

  const skeletons: Skeleton[] = [];
  const bindings: ArrowBinding[] = [];
  const ids = new Map<SceneBox, string>();
  const groupBoxes = boxes.filter((b) => b.role === 'group' || b.role === 'frame');
  const groupOf = new Map<SceneBox, string>();
  const textOf = (txs: SceneText[] | undefined) => (txs ?? []).map((x) => x.lines.join('\n')).join('\n');
  const sizeOf = (txs: SceneText[] | undefined) => Math.round((txs?.[0]?.size ?? 14) * k);

  for (const b of boxes) {
    const id = newId();
    ids.set(b, id);
    const group = b.role === 'group' || b.role === 'frame';
    if (group) groupOf.set(b, `${id}-g`);
    const p = resolvePaint(b.paint, 'light', group);
    const label = b.role === 'node' ? textOf(nodeLabel.get(b)) : '';
    skeletons.push({
      id,
      type: b.role === 'node' ? (SHAPE[b.shape] ?? 'rectangle') : 'rectangle',
      x: X(b.x),
      y: Y(b.y),
      width: b.w * kx,
      height: b.h * ky,
      strokeColor: p.stroke,
      backgroundColor: p.fill === 'none' ? 'transparent' : p.fill,
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: group || b.dashed ? 'dashed' : 'solid',
      roughness: 0,
      roundness: SHAPE[b.shape] ? null : { type: 3 },
      ...(group ? { groupIds: [groupOf.get(b)!] } : {}),
      ...(label ? { label: { text: label, fontSize: sizeOf(nodeLabel.get(b)), strokeColor: p.text } } : {}),
    });
  }

  for (const e of edges) {
    if (e.points.length < 2) continue;
    const id = newId();
    const [o] = e.points;
    const color = e.color ? strokeOf(e.color, 'light') : t.edge;
    const label = textOf(edgeLabel.get(e));
    skeletons.push({
      id,
      type: 'arrow',
      x: X(o.x),
      y: Y(o.y),
      points: e.points.map((q) => [(q.x - o.x) * kx, (q.y - o.y) * ky]),
      strokeColor: color,
      strokeWidth: 1,
      strokeStyle: e.dashed ? 'dashed' : 'solid',
      roughness: 0,
      roundness: e.route === 'arc' ? { type: 2 } : null,
      startArrowhead: e.start === 'none' ? null : 'arrow',
      endArrowhead: e.end === 'none' ? null : 'arrow',
      ...(label ? { label: { text: label, fontSize: sizeOf(edgeLabel.get(e)), strokeColor: color } } : {}),
    });
    const s = nodeAt(o, nodes);
    const d = nodeAt(e.points[e.points.length - 1], nodes);
    bindings.push({ arrowId: id, startId: s ? ids.get(s)! : null, endId: d ? ids.get(d)! : null });
  }

  for (const tx of free) {
    const size = Math.round(tx.size * k);
    const w = Math.max(...tx.lines.map((l) => l.length)) * size * 0.6;
    const left = tx.anchor === 'middle' ? tx.x - w / 2 / kx : tx.anchor === 'end' ? tx.x - w / kx : tx.x;
    // A title that sits in a group box moves with it.
    const owner = groupBoxes.filter((g) => inside({ x: tx.x, y: tx.y }, g)).sort((a, b) => area(a) - area(b))[0];
    skeletons.push({
      id: newId(),
      type: 'text',
      ...(owner ? { groupIds: [groupOf.get(owner)!] } : {}),
      x: X(left),
      y: Y(tx.y),
      text: tx.lines.join('\n'),
      fontSize: size,
      strokeColor: tx.color ? strokeOf(tx.color, 'light') : tx.tone === 'muted' ? t.muted : t.text,
      textAlign: tx.anchor === 'middle' ? 'center' : tx.anchor === 'end' ? 'right' : 'left',
    });
  }
  return { skeletons, bindings };
}

type El = { id: string; type: string; boundElements?: readonly { id: string; type: string }[] | null; [k: string]: unknown };

/** Bind arrows to the shapes they touch (both sides know each other), after convertToExcalidrawElements. */
export function bindArrows<T extends El>(elements: readonly T[], bindings: readonly ArrowBinding[]): T[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const extra = new Map<string, { id: string; type: 'arrow' }[]>();
  const patch = new Map<string, Partial<T>>();
  const ref = (id: string | null, arrowId: string) => {
    if (!id || !byId.has(id)) return null;
    extra.set(id, [...(extra.get(id) ?? []), { id: arrowId, type: 'arrow' }]);
    return { elementId: id, focus: 0, gap: 4 };
  };
  for (const b of bindings) {
    if (!byId.has(b.arrowId)) continue;
    patch.set(b.arrowId, { startBinding: ref(b.startId, b.arrowId), endBinding: ref(b.endId, b.arrowId) } as unknown as Partial<T>);
  }
  return elements.map((e) => {
    const p = patch.get(e.id);
    const add = extra.get(e.id);
    if (!p && !add) return e;
    return { ...e, ...p, ...(add ? { boundElements: [...(e.boundElements ?? []), ...add] } : {}) };
  });
}
