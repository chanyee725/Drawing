// Texts that changed font (cleanStyle.ts) are measured again, and nothing else in the scene is touched.
// Excalidraw does the measuring (`measure`, its restoreElements); this picks the measured size of those texts only
// and grows a shape whose label no longer fits, as Excalidraw does when a label is edited, moving the arrows
// bound to that shape with it.

type Point = readonly [number, number];
type Binding = { elementId: string; fixedPoint?: Point | null } | null;

export type FitEl = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  text?: string;
  containerId?: string | null;
  verticalAlign?: string;
  points?: readonly Point[];
  startBinding?: Binding;
  endBinding?: Binding;
  elbowed?: boolean;
};

/** Space between a shape's edge and its label (Excalidraw's BOUND_TEXT_PADDING). */
const PAD = 5;

/** Height a shape needs to fit a label `h` tall (Excalidraw's computeContainerDimensionForBoundText). */
export function containerHeightFor(h: number, type: string): number {
  const d = Math.ceil(h) + PAD * 2;
  if (type === 'ellipse') return Math.round((d / Math.sqrt(2)) * 2);
  if (type === 'diamond') return 2 * d;
  return d;
}

/** Room for a label inside a shape `height` tall (Excalidraw's getBoundTextMaxHeight). */
function roomFor(type: string, height: number): number {
  if (type === 'ellipse') return Math.round((height / 2) * Math.sqrt(2)) - PAD * 2;
  if (type === 'diamond') return Math.round(height / 2) - PAD * 2;
  return height - PAD * 2;
}

/** Top of a label `th` tall in a shape `height` tall (Excalidraw's computeBoundTextPosition, y only). */
export function labelY(c: Pick<FitEl, 'type' | 'y'>, height: number, th: number, align: string | undefined): number {
  let off = PAD;
  if (c.type === 'ellipse') off += (height / 2) * (1 - Math.sqrt(2) / 2);
  if (c.type === 'diamond') off += height / 4;
  const top = c.y + off;
  if (align === 'top') return top;
  const room = roomFor(c.type, height);
  return align === 'bottom' ? top + room - th : top + room / 2 - th / 2;
}

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);

/**
 * Where an arrow end bound to shape `c` goes when `c` grows from `from` to `to` tall with its top kept
 * (Excalidraw's updateBoundPoint): an elbow arrow keeps its fixed point on the shape; any other arrow keeps its
 * gap, so an end below the shape moves down by the growth, one beside it moves in proportion, one above stays.
 */
function movedEnd(p: Point, c: FitEl, from: number, to: number, fixed?: Point | null): Point {
  if (fixed) return [p[0], p[1] + fixed[1] * (to - from)];
  const rel = (p[1] - c.y) / from;
  if (rel <= 0) return p;
  return [p[0], rel >= 1 ? p[1] + (to - from) : c.y + rel * to];
}

/** An arrow with its first or last end moved to `to` (absolute); an elbow arrow keeps right angles. */
function moveEnd(a: FitEl, end: 'start' | 'end', to: Point): Partial<FitEl> {
  const pts = (a.points ?? []).map(([x, y]) => [a.x + x, a.y + y] as [number, number]);
  if (pts.length < 2) return {};
  const i = end === 'start' ? 0 : pts.length - 1;
  const j = end === 'start' ? 1 : pts.length - 2;
  const dy = to[1] - pts[i][1];
  if (!dy) return {};
  const level = Math.abs(pts[j][1] - pts[i][1]) < 0.5;
  if (a.elbowed && level && pts.length === 2) {
    // A straight elbow arrow whose end moves up or down gets a step in the middle.
    const mid = (pts[0][0] + pts[1][0]) / 2;
    pts.splice(1, 0, [mid, pts[0][1]], [mid, pts[1][1]]);
    return moveEnd({ ...a, x: pts[0][0], y: pts[0][1], points: pts.map(([x, y]) => [x - pts[0][0], y - pts[0][1]]) }, end, to);
  }
  pts[i] = [to[0], to[1]];
  // The segment next to a side end runs level: it moves with the end, so the turn before it stays square.
  if (a.elbowed && level) pts[j] = [pts[j][0], pts[j][1] + dy];
  const [x0, y0] = pts[0];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    x: x0,
    y: y0,
    points: pts.map(([x, y]) => [x - x0, y - y0] as Point),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Patches for the arrows bound to shapes that grew (`grown`: shape id → its old height). */
function followGrown<T extends FitEl>(els: readonly T[], byId: Map<string, T>, grown: Map<string, { from: number; to: number }>) {
  const out = new Map<string, Partial<FitEl>>();
  for (const a of els) {
    if (a.isDeleted || !a.points || a.type !== 'arrow') continue;
    let cur: FitEl = a;
    for (const end of ['start', 'end'] as const) {
      const b = end === 'start' ? a.startBinding : a.endBinding;
      const g = b && grown.get(b.elementId);
      const c = b && byId.get(b.elementId);
      if (!b || !g || !c || !cur.points) continue;
      const pts = cur.points;
      const local = pts[end === 'start' ? 0 : pts.length - 1];
      const abs: Point = [cur.x + local[0], cur.y + local[1]];
      const fixed = a.elbowed ? b.fixedPoint : null;
      const moved = moveEnd(cur, end, movedEnd(abs, c, g.from, g.to, fixed));
      if (Object.keys(moved).length) cur = { ...cur, ...moved };
    }
    if (cur !== a) out.set(a.id, { x: cur.x, y: cur.y, width: cur.width, height: cur.height, points: cur.points });
  }
  return out;
}

/**
 * The texts in `ids` measured again. `measure` gets those texts and their shapes and returns them measured.
 * `apply` builds a changed element. Returns the same array when nothing changed size.
 */
export function refitTexts<T extends FitEl>(
  els: readonly T[],
  ids: ReadonlySet<string>,
  measure: (els: T[]) => readonly T[],
  apply: (el: T, patch: Partial<FitEl>) => T = (el, patch) => ({ ...el, ...patch }),
): { elements: readonly T[]; changed: boolean } {
  const byId = new Map(els.map((e) => [e.id, e]));
  const texts = els.filter((e) => ids.has(e.id) && e.type === 'text' && !e.isDeleted);
  if (!texts.length) return { elements: els, changed: false };
  const shapes = texts.flatMap((t) => {
    const c = t.containerId ? byId.get(t.containerId) : undefined;
    return c && !c.isDeleted ? [c] : [];
  });
  // Measured copies: Excalidraw also drops bindings to elements outside this subset in them (arrows, boundElements),
  // so only position, size and wrapped text are read back from them.
  const measured = new Map(measure([...texts, ...shapes]).map((e) => [e.id, e]));
  const patches = new Map<string, Partial<FitEl>>();
  const grown = new Map<string, { from: number; to: number }>();
  for (const t of texts) {
    const m = measured.get(t.id);
    if (!m) continue;
    const next: FitEl = { ...t, x: m.x, y: m.y, width: m.width, height: m.height, text: m.text };
    const c = t.containerId ? byId.get(t.containerId) : undefined;
    if (c && !c.isDeleted && SHAPES.has(c.type)) {
      // A label that no longer fits makes its shape taller (the top stays), and the label keeps its alignment.
      const height = next.height > roomFor(c.type, c.height) ? containerHeightFor(next.height, c.type) : c.height;
      if (height !== c.height) {
        patches.set(c.id, { height });
        grown.set(c.id, { from: c.height, to: height });
      }
      next.y = labelY(c, height, next.height, t.verticalAlign);
    }
    if (next.x !== t.x || next.y !== t.y || next.width !== t.width || next.height !== t.height || next.text !== t.text) {
      patches.set(t.id, { x: next.x, y: next.y, width: next.width, height: next.height, text: next.text });
    }
  }
  for (const [id, p] of followGrown(els, byId, grown)) patches.set(id, p);
  if (!patches.size) return { elements: els, changed: false };
  return { elements: els.map((e) => (patches.has(e.id) ? apply(e, patches.get(e.id)!) : e)), changed: true };
}
