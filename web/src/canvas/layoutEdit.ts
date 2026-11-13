// Layout edit mode geometry (design: docs/design/block-drag-edit.md §5.3, §5.4). Pure functions, no DOM or
// Excalidraw import, so they run under `node --test`.
//
// Coordinates:
// - layout (L): ELK root space, what `block.layout.items[*].cx/cy` store. Does not move when the picture's bounds change.
// - scene (S): one rendered picture, S = L + scene.origin.
// - screen: pixels inside the canvas wrapper, screen = base + k * L (see `layoutFrame`).

import type { BlockLayout, LayoutBasis, LayoutItem, Point, SceneHandle } from '../../../shared/render/index.ts';
import { BLOCK_LAYOUT_VERSION } from '../../../shared/render/block-layout.ts';
import { IMAGE_TEXT, type EditAction, type ImageReasonCode } from './reasons.ts';

export type Box = { x: number; y: number; w: number; h: number };
/** A draggable element in layout coordinates. */
export type LayoutHandle = Box & { id: string; kind: 'node' | 'group'; parent: string };
/** Maps layout coordinates to wrapper pixels: screen = (x + k * lx, y + k * ly). */
export type LayoutFrame = { x: number; y: number; k: number };
export type Line = { x1: number; y1: number; x2: number; y2: number };

/** Snap distance on screen, in pixels (§5.4). */
export const SNAP_PX = 6;
/** Grid used when no alignment guide applies, in layout units. */
export const GRID = 8;
/** Arrow key steps in layout units. */
export const NUDGE = 1;
export const NUDGE_BIG = 10;

/** Handles of a scene moved into layout coordinates. */
export function layoutHandles(handles: readonly SceneHandle[] | undefined, origin: Point | undefined): LayoutHandle[] {
  const o = origin ?? { x: 0, y: 0 };
  return (handles ?? []).map((h) => ({ id: h.id, kind: h.kind, parent: h.parent, x: h.x - o.x, y: h.y - o.y, w: h.w, h: h.h }));
}

/**
 * Where layout coordinates land on screen. The block image shows a picture of `picWidth` whose layout origin is
 * `picOrigin`; the image sits at world `img` and Excalidraw shows world `w` at `(w + scroll) * zoom + offset`.
 */
export function layoutFrame(
  img: { x: number; y: number; width: number },
  pic: { width: number; origin: Point },
  view: { scrollX: number; scrollY: number; zoom: number; offsetX: number; offsetY: number },
): LayoutFrame {
  const s = pic.width > 0 ? img.width / pic.width : 1;
  const z = view.zoom;
  return {
    x: (img.x + s * pic.origin.x + view.scrollX) * z + view.offsetX,
    y: (img.y + s * pic.origin.y + view.scrollY) * z + view.offsetY,
    k: s * z,
  };
}

export const toScreen = (f: LayoutFrame, p: Point): Point => ({ x: f.x + f.k * p.x, y: f.y + f.k * p.y });
export const toLayout = (f: LayoutFrame, p: Point): Point => ({ x: (p.x - f.x) / f.k, y: (p.y - f.y) / f.k });

const inside = (b: Box, p: Point) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** The topmost handle under `p` (handles are in paint order, so the last hit wins), or null. */
export function hitHandle(handles: readonly LayoutHandle[], p: Point): LayoutHandle | null {
  for (let i = handles.length - 1; i >= 0; i--) if (inside(handles[i]!, p)) return handles[i]!;
  return null;
}

/** Handles lying fully inside the marquee `r` (any drag direction). */
export function marquee(handles: readonly LayoutHandle[], a: Point, b: Point): string[] {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  return handles.filter((h) => h.x >= x0 && h.y >= y0 && h.x + h.w <= x1 && h.y + h.h <= y1).map((h) => h.id);
}

/**
 * What actually moves for a selection: nodes and empty groups. A group with children moves all its descendants
 * and keeps no key itself (its box always comes from the children, design §3.3).
 */
export function leavesOf(ids: Iterable<string>, handles: readonly LayoutHandle[]): string[] {
  const kids = new Map<string, string[]>();
  for (const h of handles) if (h.parent) kids.set(h.parent, [...(kids.get(h.parent) ?? []), h.id]);
  const out = new Set<string>();
  const walk = (id: string): void => {
    const c = kids.get(id);
    if (!c?.length) out.add(id);
    else for (const k of c) walk(k);
  };
  for (const id of ids) walk(id);
  return [...out];
}

/** Bounding box of the handles with these ids, or null. */
export function boundsOf(handles: readonly LayoutHandle[], ids: Iterable<string>): Box | null {
  const want = new Set(ids);
  let b: Box | null = null;
  for (const h of handles) {
    if (!want.has(h.id)) continue;
    if (!b) b = { x: h.x, y: h.y, w: h.w, h: h.h };
    else {
      const x1 = Math.max(b.x + b.w, h.x + h.w);
      const y1 = Math.max(b.y + b.h, h.y + h.h);
      b.x = Math.min(b.x, h.x);
      b.y = Math.min(b.y, h.y);
      b.w = x1 - b.x;
      b.h = y1 - b.y;
    }
  }
  return b;
}

const half = (v: number) => Math.round(v * 2) / 2;

/**
 * The layout after moving `leaves` by (dx, dy) from where `handles` shows them. Other items are kept as they are.
 * Centres are rounded to 0.5 so the same drag always stores the same numbers (design §3.1).
 */
export function movedLayout(layout: BlockLayout | undefined, handles: readonly LayoutHandle[], leaves: readonly string[], dx: number, dy: number, basis: LayoutBasis): BlockLayout {
  const items: Record<string, LayoutItem> = { ...(layout?.v === BLOCK_LAYOUT_VERSION ? layout.items : undefined) };
  const want = new Set(leaves);
  for (const h of handles) {
    if (!want.has(h.id)) continue;
    // defineProperty: a node named `__proto__` must stay plain data (the server refuses that key anyway).
    Object.defineProperty(items, h.id, { value: { cx: half(h.x + h.w / 2 + dx), cy: half(h.y + h.h / 2 + dy), parent: h.parent }, enumerable: true, writable: true, configurable: true });
  }
  return { v: BLOCK_LAYOUT_VERSION, basis, items };
}

export type Snap = { dx: number; dy: number; guides: Line[] };

/**
 * Snap a drag (§5.4): edges and centres of the moving box align with those of the other boxes when within `tol`
 * (layout units), drawing a guide; an axis with no guide snaps the box centre to `grid` (0 turns the grid off).
 */
export function snapMove(moving: Box, others: readonly Box[], dx: number, dy: number, tol: number, grid = GRID): Snap {
  const lines = (b: Box, pos: 'x' | 'y', size: 'w' | 'h') => [b[pos], b[pos] + b[size] / 2, b[pos] + b[size]];
  // The line to align with on one axis, or null.
  const align = (d: number, pos: 'x' | 'y', size: 'w' | 'h'): { off: number; at: number } | null => {
    const ms = lines({ ...moving, [pos]: moving[pos] + d }, pos, size);
    let best: { off: number; at: number } | null = null;
    for (const t of others)
      for (const at of lines(t, pos, size))
        for (const mv of ms) {
          const off = at - mv;
          if (Math.abs(off) <= tol && (!best || Math.abs(off) < Math.abs(best.off))) best = { off, at };
        }
    return best;
  };
  const toGrid = (d: number, pos: 'x' | 'y', size: 'w' | 'h') => {
    if (!(grid > 0)) return d;
    const c = moving[pos] + moving[size] / 2;
    return Math.round((c + d) / grid) * grid - c;
  };
  const ax = align(dx, 'x', 'w');
  const ay = align(dy, 'y', 'h');
  const sx = ax ? dx + ax.off : toGrid(dx, 'x', 'w');
  const sy = ay ? dy + ay.off : toGrid(dy, 'y', 'h');
  const moved = { ...moving, x: moving.x + sx, y: moving.y + sy };
  const guides: Line[] = [];
  // A guide spans the moved box and every other box lying on the same line.
  const on = (t: Box, pos: 'x' | 'y', size: 'w' | 'h', at: number) => lines(t, pos, size).some((v) => Math.abs(v - at) < 1e-6);
  if (ax) {
    let lo = moved.y;
    let hi = moved.y + moved.h;
    for (const t of others) if (on(t, 'x', 'w', ax.at)) (lo = Math.min(lo, t.y)), (hi = Math.max(hi, t.y + t.h));
    guides.push({ x1: ax.at, y1: lo, x2: ax.at, y2: hi });
  }
  if (ay) {
    let lo = moved.x;
    let hi = moved.x + moved.w;
    for (const t of others) if (on(t, 'y', 'h', ay.at)) (lo = Math.min(lo, t.x)), (hi = Math.max(hi, t.x + t.w));
    guides.push({ x1: lo, y1: ay.at, x2: hi, y2: ay.at });
  }
  return { dx: sx, dy: sy, guides };
}

/** Boxes other than the moving ones to align with: nodes and empty groups (filled group boxes follow their children). */
export function snapTargets(handles: readonly LayoutHandle[], moving: readonly string[]): Box[] {
  const skip = new Set(moving);
  const filled = new Set(handles.map((h) => h.parent).filter(Boolean));
  return handles.filter((h) => !skip.has(h.id) && !filled.has(h.id));
}

/** Arrow key → step in layout units (1, or 10 with Shift), or null for other keys. */
export function nudgeFor(key: string, shift: boolean): { dx: number; dy: number } | null {
  const s = shift ? NUDGE_BIG : NUDGE;
  switch (key) {
    case 'ArrowLeft':
      return { dx: -s, dy: 0 };
    case 'ArrowRight':
      return { dx: s, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -s };
    case 'ArrowDown':
      return { dx: 0, dy: s };
    default:
      return null;
  }
}

export type { ImageReasonCode } from './reasons.ts';

/** Why a block image cannot be used for `action` on the canvas side (the code side is `editReasonCode`), or null. */
export function imageReasonCode(img: { angle?: number; locked?: boolean; crop?: unknown }, action: EditAction = 'move'): ImageReasonCode | null {
  if (img.locked) return 'locked';
  if (img.angle) return 'rotated';
  // Layout edit draws over the uncropped picture as before; converting would place shapes the crop hides.
  if (action === 'freeform' && img.crop) return 'cropped';
  return null;
}

/** The canvas-side reason as text for an action, or null. */
export function imageReason(img: { angle?: number; locked?: boolean; crop?: unknown }, action: EditAction = 'move'): string | null {
  const code = imageReasonCode(img, action);
  return code ? IMAGE_TEXT[action][code] : null;
}
