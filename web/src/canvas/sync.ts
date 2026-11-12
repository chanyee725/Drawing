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
