// Per-block layout overrides (`block.layout` in `.dpx.json`): moved node centres on top of the automatic layout.
// Types only. Reconciling overrides with code edits lives elsewhere; rendering applies them in `composeGraph`.

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
  items: Record<string, LayoutItem>;
}
