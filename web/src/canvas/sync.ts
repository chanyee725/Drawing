// Pure glue between the file model and the Excalidraw scene. No Excalidraw import, so it runs under `node --test`.
//
// A diagram block is shown on the canvas as an Excalidraw image element whose `customData.blockId`
// points at the block. The block (file.blocks) is the source of truth for code and geometry; the
// image element is rebuilt on load and never written into file.canvas.elements.

export type BlockGeom = { x: number; y: number; w: number; h: number };
export type BlockLike = BlockGeom & { id: string; type: string; code: string };

/** The subset of an Excalidraw element this module reads. */
export type SceneEl = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  version?: number;
  customData?: Record<string, unknown> | null;
};

export const blockIdOf = (el: SceneEl): string | null => {
  const id = el.customData?.blockId;
  return typeof id === 'string' && id ? id : null;
};

/** FNV-1a, enough to tell renders apart. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** File id of a rendered block image: changes whenever the picture would change. */
export const fileIdFor = (b: Pick<BlockLike, 'id' | 'type' | 'code'>, theme: string) => `blk_${b.id}_${hash(`${theme}\n${b.type}\n${b.code}`)}`;

export type SplitScene<E extends SceneEl> = {
  /** Free-form elements to save in file.canvas.elements (deleted ones dropped). */
  free: E[];
  /** Geometry of live block images, by block id. */
  geometry: Map<string, BlockGeom>;
  /** Block ids whose image was deleted on the canvas. */
  deleted: Set<string>;
};

export function splitScene<E extends SceneEl>(elements: readonly E[]): SplitScene<E> {
  const free: E[] = [];
  const geometry = new Map<string, BlockGeom>();
  const deleted = new Set<string>();
  for (const el of elements) {
    const bid = blockIdOf(el);
    if (bid === null) {
      if (!el.isDeleted) free.push(el);
    } else if (el.isDeleted) {
      if (!geometry.has(bid)) deleted.add(bid);
    } else {
      geometry.set(bid, { x: el.x, y: el.y, w: el.width, h: el.height });
      deleted.delete(bid);
    }
  }
  return { free, geometry, deleted };
}

const round = (v: number) => Math.round(v * 100) / 100;
const same = (a: BlockGeom, b: BlockGeom) => round(a.x) === round(b.x) && round(a.y) === round(b.y) && round(a.w) === round(b.w) && round(a.h) === round(b.h);

/**
 * Apply canvas moves/resizes/deletes to the block list. Returns the same array when nothing changed,
 * so callers can skip a save.
 */
export function applyScene<B extends BlockLike>(blocks: readonly B[], split: Pick<SplitScene<SceneEl>, 'geometry' | 'deleted'>): readonly B[] {
  let changed = false;
  const out: B[] = [];
  for (const b of blocks) {
    if (split.deleted.has(b.id)) {
      changed = true;
      continue;
    }
    const g = split.geometry.get(b.id);
    if (g && !same(g, b)) {
      changed = true;
      out.push({ ...b, x: round(g.x), y: round(g.y), w: round(g.w), h: round(g.h) });
    } else out.push(b);
  }
  return changed ? out : blocks;
}

/** Cheap fingerprint of the free-form elements, to tell real edits from scroll/selection changes. */
export const freeSignature = (free: readonly SceneEl[]) => free.map((e) => `${e.id}:${e.version ?? 0}`).join(',');

/** Height for a block of width `w` showing a picture of `pw`×`ph`. */
export const fitHeight = (w: number, pw: number, ph: number) => (pw > 0 && ph > 0 ? round((w * ph) / pw) : w);

/** Base fields of a new block image element; Excalidraw's restoreElements fills in the rest. */
export function blockImageSkeleton(b: BlockLike, fileId: string, id: string) {
  return {
    id,
    type: 'image' as const,
    x: b.x,
    y: b.y,
    width: b.w,
    height: b.h,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid' as const,
    strokeWidth: 1,
    strokeStyle: 'solid' as const,
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    status: 'saved' as const,
    fileId,
    scale: [1, 1] as [number, number],
    crop: null,
    customData: { blockId: b.id },
  };
}

/**
 * True for a block that was never placed on the canvas: new blocks are created with w = 0. Blocks
 * saved before the canvas existed carry the old 640×400 placeholder and are treated the same.
 */
export const isUnplaced = (b: BlockGeom) => !(b.w > 0 && b.h > 0) || (b.w === 640 && b.h === 400);

export type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect, gap: number) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Box of a scene element, for placement. Rotation is ignored; lines may have negative sizes. */
export const rectOf = (el: Pick<SceneEl, 'x' | 'y' | 'width' | 'height'>): Rect => ({
  x: Math.min(el.x, el.x + el.width),
  y: Math.min(el.y, el.y + el.height),
  w: Math.abs(el.width),
  h: Math.abs(el.height),
});

/**
 * Top-left corner for a `w`×`h` box that keeps `gap` clear of every rect in `taken`. Tries the
 * spots right of and below each taken rect (plus the top-left of everything), in reading order.
 */
export function findFreeSpot(w: number, h: number, taken: readonly Rect[], gap = 40): { x: number; y: number } {
  if (!taken.length) return { x: 0, y: 0 };
  const minX = Math.min(...taken.map((r) => r.x));
  const minY = Math.min(...taken.map((r) => r.y));
  const spots = [{ x: minX, y: minY }];
  for (const r of taken) spots.push({ x: r.x + r.w + gap, y: r.y }, { x: minX, y: r.y + r.h + gap }, { x: r.x, y: r.y + r.h + gap });
  spots.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const s of spots) if (!taken.some((r) => overlaps({ ...s, w, h }, r, gap))) return { x: round(s.x), y: round(s.y) };
  // Unreachable: the spot below the lowest rect is always free. Kept as a safe fallback.
  return { x: minX, y: round(Math.max(...taken.map((r) => r.y + r.h)) + gap) };
}

export const newBlockId = () => `b_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Live block images that show a block another image already shows: copies made by duplicate,
 * paste or alt-drag, which keep `customData.blockId`. One image per block stays its owner
 * (`owners`, block id → element id, updated in place); every other one is returned as a copy.
 */
export function findCopies(elements: readonly SceneEl[], owners: Map<string, string>): { id: string; blockId: string }[] {
  const groups = new Map<string, SceneEl[]>();
  for (const el of elements) {
    const bid = blockIdOf(el);
    if (bid === null || el.isDeleted) continue;
    const g = groups.get(bid);
    if (g) g.push(el);
    else groups.set(bid, [el]);
  }
  const copies: { id: string; blockId: string }[] = [];
  for (const [bid, els] of groups) {
    const owner = els.find((e) => e.id === owners.get(bid)) ?? els[0];
    owners.set(bid, owner.id);
    for (const e of els) if (e !== owner) copies.push({ id: e.id, blockId: bid });
  }
  return copies;
}
