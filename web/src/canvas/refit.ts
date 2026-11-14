// Texts that changed font (cleanStyle.ts) are measured again, and nothing else in the scene is touched.
// Excalidraw does the measuring (`measure`, its restoreElements); this picks the measured size of those texts only
// and grows a shape whose label no longer fits, as Excalidraw does when a label is edited.
//
// Known gaps (#305):
// - Rotated shapes (`angle` is not read): a shape that grows keeps its unrotated `y`, so its centre, which it is
//   rotated around, moves and the shape shifts on screen instead of growing from its visual top edge; the label
//   (`y + height / 2`) follows the shape. Rotated hand-drawn labels are rare in saved files.
// - Arrows bound to a shape that grows are not moved here, and an elbow arrow's `fixedSegments` are left as they
//   are: Excalidraw re-routes bound arrows when the scene updates.

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

/** Room for a label inside a shape (Excalidraw's getBoundTextMaxHeight). */
function roomFor(c: FitEl): number {
  if (c.type === 'ellipse') return Math.round((c.height / 2) * Math.sqrt(2)) - PAD * 2;
  if (c.type === 'diamond') return Math.round(c.height / 2) - PAD * 2;
  return c.height - PAD * 2;
}

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);

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
  const measured = new Map(measure([...texts, ...shapes]).map((e) => [e.id, e]));
  const patches = new Map<string, Partial<FitEl>>();
  for (const t of texts) {
    const m = measured.get(t.id);
    if (!m) continue;
    const next: FitEl = { ...t, x: m.x, y: m.y, width: m.width, height: m.height, text: m.text };
    const c = t.containerId ? byId.get(t.containerId) : undefined;
    if (c && !c.isDeleted && SHAPES.has(c.type)) {
      // A label that no longer fits makes its shape taller (the top stays), and a middle label stays centred.
      const height = next.height > roomFor(c) ? containerHeightFor(next.height, c.type) : c.height;
      if (height !== c.height) patches.set(c.id, { height });
      if (t.verticalAlign === 'middle') next.y = c.y + height / 2 - next.height / 2;
    }
    if (next.x !== t.x || next.y !== t.y || next.width !== t.width || next.height !== t.height || next.text !== t.text) {
      patches.set(t.id, { x: next.x, y: next.y, width: next.width, height: next.height, text: next.text });
    }
  }
  if (!patches.size) return { elements: els, changed: false };
  return { elements: els.map((e) => (patches.has(e.id) ? apply(e, patches.get(e.id)!) : e)), changed: true };
}
