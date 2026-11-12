// Keeps per-node layout overrides in step with code edits (design: docs/design/block-drag-edit.md §4.1, §4.2).
// Pure functions over the parsed diagram; nothing here touches the file or the DOM.

import type { Diagnostic, GraphChild, GraphDiagram } from '../dsl/index.ts';

/** Drop the whole layout when this share of the existing keys would be discarded (keys >= 2). */
export const RESET_DROP_RATIO = 0.5;
/** Drop the whole layout when node+group count moves more than this share away from `basis.count`. */
export const RESET_COUNT_RATIO = 0.5;

// NOTE: shape follows design §2.1. The compose step (D2) and the server (D1) use the same JSON shape.
export interface LayoutItem {
  /** Centre point in layout coordinates. */
  cx: number;
  cy: number;
  /** Parent group name when the override was made; root is "". */
  parent: string;
}

export interface LayoutBasis {
  type: string;
  direction: string;
  /** Node + group count at the last save. */
  count: number;
}

export interface BlockLayout {
  v: number;
  basis?: LayoutBasis;
  items: Record<string, LayoutItem>;
}

/** What the layout depends on: diagram type, direction, and every node/group id with its parent group. */
export interface Structure {
  type: string;
  direction: string;
  count: number;
  /** id -> parent group id ("" for root). Groups and nodes share one namespace, like edges do. */
  parents: Map<string, string>;
}

export function structureOf(diagram: GraphDiagram): Structure {
  const parents = new Map<string, string>();
  const walk = (children: GraphChild[], parent: string): void => {
    for (const c of children) {
      // The parser keeps the first definition only, but stay safe for hand-built ASTs.
      if (!parents.has(c.id)) parents.set(c.id, parent);
      if (c.kind === 'group') walk(c.children, c.id);
    }
  };
  walk(diagram.children, '');
  return { type: diagram.type, direction: diagram.direction, count: parents.size, parents };
}

/** The `basis` to store next to the items when saving. */
export function basisOf(diagram: GraphDiagram): LayoutBasis {
  const s = structureOf(diagram);
  return { type: s.type, direction: s.direction, count: s.count };
}

export type ReconcileReason = 'type' | 'direction' | 'dropped' | 'count';

export interface ReconcileResult {
  /** The layout to draw with / store. `undefined` means auto layout (nothing kept). */
  layout: BlockLayout | undefined;
  /** Keys discarded by the per-node rules (§4.1). */
  dropped: string[];
  /** Set when §4.2 wiped the whole layout. */
  reset?: ReconcileReason;
  /** True when `layout` differs from the input, i.e. the file would change if saved. */
  changed: boolean;
}

/** Apply §4.1 then §4.2. Never mutates `layout`; returns the same object when nothing changes. */
export function reconcileLayout(diagram: GraphDiagram, layout: BlockLayout | undefined): ReconcileResult {
  if (!layout) return { layout, dropped: [], changed: false };
  const keys = Object.keys(layout.items);
  if (keys.length === 0) return { layout, dropped: [], changed: false };
  const s = structureOf(diagram);
  const basis = layout.basis;

  if (basis && basis.type !== s.type) return wiped(keys, 'type');
  if (basis && basis.direction !== s.direction) return wiped(keys, 'direction');

  const dropped = keys.filter((k) => {
    const parent = s.parents.get(k);
    return parent === undefined || parent !== layout.items[k]!.parent;
  });
  if (keys.length >= 2 && dropped.length >= keys.length * RESET_DROP_RATIO) return wiped(keys, 'dropped');
  if (basis && basis.count > 0 && Math.abs(s.count - basis.count) > basis.count * RESET_COUNT_RATIO) return wiped(keys, 'count');
  if (basis && basis.count === 0 && s.count > 0) return wiped(keys, 'count');

  if (dropped.length === 0) return { layout, dropped, changed: false };
  const gone = new Set(dropped);
  const items: Record<string, LayoutItem> = {};
  for (const k of keys) if (!gone.has(k)) items[k] = layout.items[k]!;
  // Keep the old basis: it describes the structure the surviving items were made for.
  return { layout: { ...layout, items }, dropped, changed: true };
}

function wiped(keys: string[], reason: ReconcileReason): ReconcileResult {
  return { layout: undefined, dropped: keys, reset: reason, changed: true };
}

/**
 * Whether the file may be rewritten with the reconciled layout (§4.3): only a clean parse of a
 * graph diagram. With errors the canvas shows the last good picture, so nothing is pruned.
 */
export function reconcileForSave(
  parsed: { ast: GraphDiagram; diagnostics: Diagnostic[] },
  layout: BlockLayout | undefined,
): ReconcileResult {
  if (parsed.diagnostics.some((d) => d.severity === 'error')) return { layout, dropped: [], changed: false };
  return reconcileLayout(parsed.ast, layout);
}
