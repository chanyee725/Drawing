// The canvas draws clean, not hand-drawn: Excalidraw's defaults are swapped for the 'architect' look
// (no roughness), a plain sans font that is already bundled, round corners and thin lines.
// Used for new shapes the user draws, shapes from the insert menu, converted diagram blocks (freeform.ts),
// and to tidy shapes that arrive hand-drawn (old files, paste, library).

/** Excalidraw's "Liberation Sans" (bundled in the package, served from /excalidraw/fonts/). */
export const CLEAN_FONT_FAMILY = 9;

/** Excalidraw's handwriting fonts: Virgil (1) and Excalifont (5). */
const HAND_FONTS: ReadonlySet<unknown> = new Set([1, 5]);

/** Starting tool settings for a fresh canvas (`initialData.appState`). */
export const CLEAN_APP_STATE = {
  currentItemRoughness: 0,
  currentItemFontFamily: CLEAN_FONT_FAMILY,
  currentItemStrokeWidth: 1,
  currentItemRoundness: 'round' as const,
  currentItemFillStyle: 'solid' as const,
  // Arrows turn at right angles, like the connectors in diagram blocks.
  currentItemArrowType: 'elbow' as const,
};

/**
 * Clean style for an element skeleton (convertToExcalidrawElements), which would otherwise get Excalidraw's
 * hand-drawn defaults (roughness 1, handwriting font, thick lines). Fields the skeleton already sets win.
 */
export function cleanSkeleton(sk: Record<string, unknown>): Record<string, unknown> {
  const base = { roughness: 0, strokeWidth: 1 };
  switch (sk.type) {
    case 'text':
      return { ...base, fontFamily: CLEAN_FONT_FAMILY, ...sk };
    case 'rectangle':
      return { ...base, roundness: { type: 3 }, ...sk };
    case 'diamond':
      return { ...base, roundness: { type: 2 }, ...sk };
    case 'arrow':
      return { ...base, elbowed: true, ...sk };
    default:
      return { ...base, ...sk };
  }
}

type StyleEl = { type: string; roughness?: number; fontFamily?: number };
type CleanPatch = { roughness?: 0; fontFamily?: number };

/**
 * Hand-drawn shapes made clean: roughness above 0 becomes 0 and handwriting fonts become the clean font.
 * Images are left alone (diagram blocks are images). Returns the same array when nothing needed changing.
 * `apply` builds the changed element; `fonts` tells whether any text changed font (its size needs measuring again).
 */
export function cleanElements<T extends StyleEl>(
  els: readonly T[],
  apply: (el: T, patch: CleanPatch) => T = (el, patch) => ({ ...el, ...patch }),
): { elements: readonly T[]; changed: boolean; fonts: boolean } {
  let changed = false;
  let fonts = false;
  const elements = els.map((e) => {
    if (e.type === 'image') return e;
    const patch: CleanPatch = {};
    if (typeof e.roughness === 'number' && e.roughness > 0) patch.roughness = 0;
    if (e.type === 'text' && HAND_FONTS.has(e.fontFamily)) {
      patch.fontFamily = CLEAN_FONT_FAMILY;
      fonts = true;
    }
    if (patch.roughness === undefined && patch.fontFamily === undefined) return e;
    changed = true;
    return apply(e, patch);
  });
  return changed ? { elements, changed, fonts } : { elements: els, changed, fonts };
}
