// Per-block layout overrides (`block.layout` in `.dpx.json`): moved node centres on top of the automatic layout.
// The JSON shape plus the storage rules both sides share (`layoutProblem`, `cleanLayout`): the server checks saves with
// them and the web checks layouts read back from canvas images. Reconciling with code edits is in `overrides.ts`;
// rendering applies layouts in `composeGraph`.

/** Sub-format version this renderer understands. A layout with another `v` is ignored when drawing. */
export const BLOCK_LAYOUT_VERSION = 1;

/** One moved element, keyed by node (or empty group) name. */
export interface LayoutItem {
  /** Centre in layout coordinates (before `finishScene`'s translation; see `Scene.origin`). */
  cx: number;
  cy: number;
  /** Parent group name when the override was made, `""` at the root. A different parent drops the override. */
  parent: string;
  /** Reserved for resizing; not applied yet. */
  w?: number;
  h?: number;
}

/** Structure summary at the time the layout was saved, used to detect big code changes. */
export interface LayoutBasis {
  type: string;
  direction: string;
  /** Node + group count. */
  count: number;
}

export interface BlockLayout {
  v: number;
  basis?: LayoutBasis;
  /** Optional: a layout may carry only `basis` (the server accepts it), meaning nothing moved yet. */
  items?: Record<string, LayoutItem>;
}

// Rules for a stored layout (docs/workspace-api.md). The server enforces them on save; the web uses the same check
// for layouts it reads back from canvas images, so both sides agree on what a layout is.
export const MAX_LAYOUT_ITEMS = 2000;
/** Longest item key, `parent`, `basis.type` and `basis.direction`. */
export const MAX_LAYOUT_NAME = 200;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Why `l` is not a storable layout, or null when it is. `at` names it in the message.
 * A `v` above {@link BLOCK_LAYOUT_VERSION} is only checked for being an integer (a newer client wrote it).
 */
export function layoutProblem(l: unknown, at = 'layout'): string | null {
  if (!isObj(l)) return `${at} must be an object`;
  if (!Number.isInteger(l.v) || (l.v as number) < 1) return `${at}.v must be an integer >= 1`;
  if ((l.v as number) > BLOCK_LAYOUT_VERSION) return null;
  if (l.items !== undefined) {
    if (!isObj(l.items)) return `${at}.items must be an object`;
    const keys = Object.keys(l.items);
    if (keys.length > MAX_LAYOUT_ITEMS) return `${at}.items has more than ${MAX_LAYOUT_ITEMS} entries`;
    for (const k of keys) {
      const it = l.items[k];
      if (k.length < 1 || k.length > MAX_LAYOUT_NAME) return `${at}.items keys must be 1-${MAX_LAYOUT_NAME} characters`;
      // `out['__proto__'] = ...` would set the prototype instead of storing the entry.
      if (k === '__proto__') return `${at}.items must not have a "__proto__" key`;
      if (isObj(it) && typeof it.parent === 'string' && it.parent.length > MAX_LAYOUT_NAME) return `${at}.items parent must be at most ${MAX_LAYOUT_NAME} characters`;
      if (!isObj(it) || !isNum(it.cx) || !isNum(it.cy) || typeof it.parent !== 'string') return `${at}.items["${k.slice(0, 40)}"] needs numeric cx, cy and a string parent`;
    }
  }
  if (l.basis !== undefined) {
    const b = l.basis;
    if (!isObj(b) || typeof b.type !== 'string' || typeof b.direction !== 'string' || !Number.isInteger(b.count) || (b.count as number) < 0) {
      return `${at}.basis needs string type, string direction and integer count >= 0`;
    }
    if (b.type.length > MAX_LAYOUT_NAME || b.direction.length > MAX_LAYOUT_NAME) return `${at}.basis type and direction must be at most ${MAX_LAYOUT_NAME} characters`;
  }
  return null;
}

/** Copy of a layout that passed {@link layoutProblem}, with unknown fields dropped. A newer `v` comes back as is. */
export function cleanLayout(l: BlockLayout): BlockLayout {
  if (l.v > BLOCK_LAYOUT_VERSION) return l;
  const out: BlockLayout = { v: l.v };
  if (l.items !== undefined) {
    // fromEntries defines own properties, so names like `constructor` stay plain data.
    out.items = Object.fromEntries(Object.entries(l.items).map(([k, it]) => [k, { cx: it.cx, cy: it.cy, parent: it.parent }]));
  }
  if (l.basis !== undefined) out.basis = { type: l.basis.type, direction: l.basis.direction, count: l.basis.count };
  return out;
}
