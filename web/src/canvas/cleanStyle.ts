// The canvas draws clean, not hand-drawn: Excalidraw's defaults are swapped for the 'architect' look
// (no roughness), a plain sans font that is already bundled, round corners and thin lines.
// Used for new shapes the user draws and for converted diagram blocks (freeform.ts).

/** Excalidraw's "Liberation Sans" (bundled in the package, served from /excalidraw/fonts/). */
export const CLEAN_FONT_FAMILY = 9;

/** Starting tool settings for a fresh canvas (`initialData.appState`). Existing elements keep their own style. */
export const CLEAN_APP_STATE = {
  currentItemRoughness: 0,
  currentItemFontFamily: CLEAN_FONT_FAMILY,
  currentItemStrokeWidth: 1,
  currentItemRoundness: 'round' as const,
  currentItemFillStyle: 'solid' as const,
};
