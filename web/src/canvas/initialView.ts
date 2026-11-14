// Where the canvas looks when a file opens (E494). The first time a file opens in this tab, the view fits every
// shape and block, but never zooms in past 100%, so a small drawing is not blown up. Once the user pans or zooms,
// the file keeps the view they left it at: a reload (another tab, an agent editing the file) or switching back to
// the file does not move it. Until then a reload fits again, so a block an agent adds comes into view.
// Views live in memory only, per workspace path.

export type View = { scrollX: number; scrollY: number; zoom: number };
/** Scene bounds [minX, minY, maxX, maxY]. */
export type Bounds = readonly [number, number, number, number];

/** Largest zoom of a fitted view: a small drawing stays at its real size. */
export const FIT_MAX_ZOOM = 1;
/** Smallest zoom of a fitted view (Excalidraw's own minimum). */
export const FIT_MIN_ZOOM = 0.1;
/** Share of the viewport the drawing takes, leaving a margin around it. */
export const FIT_MARGIN = 0.9;
/** Excalidraw's zoom step: fitted zooms are rounded down to it, like its own fit. */
const ZOOM_STEP = 0.1;

/**
 * The view that shows `bounds` whole and centred in a `width`×`height` viewport, or null when there is nothing to
 * fit (no shapes, an empty or hidden viewport). Excalidraw shows scene point p at `(p + scroll) * zoom`.
 */
export function fitView(bounds: Bounds | null, width: number, height: number): View | null {
  if (!bounds || !(width > 0) || !(height > 0)) return null;
  const [x1, y1, x2, y2] = bounds;
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 < x1 || y2 < y1) return null;
  const w = Math.max(x2 - x1, 1);
  const h = Math.max(y2 - y1, 1);
  const raw = Math.min(width / w, height / h) * FIT_MARGIN;
  // Rounded down to the step (a hair over a step counts as on it), then kept within the limits.
  const stepped = Math.floor(raw / ZOOM_STEP + 1e-9) * ZOOM_STEP;
  const zoom = Math.min(FIT_MAX_ZOOM, Math.max(FIT_MIN_ZOOM, Number(stepped.toFixed(2))));
  return { zoom, scrollX: width / 2 / zoom - (x1 + x2) / 2, scrollY: height / 2 / zoom - (y1 + y2) / 2 };
}

const same = (a: View, b: View) => a.scrollX === b.scrollX && a.scrollY === b.scrollY && a.zoom === b.zoom;

// Path → the view it was last shown at, and whether that is still the view it was fitted to (the user has not moved it).
const views = new Map<string, { view: View; fitted: boolean }>();

/** The view the user left `path` at in this tab; null if it was never opened or never moved from its fit. */
export function rememberedView(path: string | undefined): View | null {
  const v = path ? views.get(path) : undefined;
  return v && !v.fitted ? v.view : null;
}

/** Note the view `path` was fitted to on open, so it is not taken for a view the user chose. */
export function noteFitted(path: string | undefined, v: View): void {
  if (path) views.set(path, { view: { ...v }, fitted: true });
}

/** Keep the current view of `path`, for its next open (reload, switching back). */
export function rememberView(path: string | undefined, v: View): void {
  if (!path || ![v.scrollX, v.scrollY, v.zoom].every(Number.isFinite) || v.zoom <= 0) return;
  const old = views.get(path);
  if (old && same(old.view, v)) return;
  views.set(path, { view: { scrollX: v.scrollX, scrollY: v.scrollY, zoom: v.zoom }, fitted: false });
}

/** Forget every remembered view (tests). */
export function forgetViews(): void {
  views.clear();
}

/**
 * The opening view of `path`: the one the user left it at, else a fit of `bounds` (noted as fitted), else null
 * (Excalidraw then centres the content at 100%, as before).
 */
export function openingView(path: string | undefined, bounds: Bounds | null, width: number, height: number): View | null {
  const kept = rememberedView(path);
  if (kept) return kept;
  const fit = fitView(bounds, width, height);
  if (fit) noteFitted(path, fit);
  return fit;
}
