// Pure glue between the file model and the Excalidraw scene. No Excalidraw import, so it runs under `node --test`.
//
// A diagram block is shown on the canvas as an Excalidraw image element whose `customData.blockId`
// points at the block. The block (file.blocks) is the source of truth for code and geometry; the
// image element is rebuilt on load and never written into file.canvas.elements.

import { layoutProblem, type BlockLayout } from '../../../shared/render/block-layout.ts';

export type BlockGeom = { x: number; y: number; w: number; h: number };
/** `frameId`: the frame the block's image sits in, kept on the block because the image is rebuilt on load (#83). */
export type BlockLike = BlockGeom & { id: string; type: string; code: string; layout?: BlockLayout; frameId?: string };
type DrawKey = Pick<BlockLike, 'id' | 'type' | 'code' | 'layout'>;

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
  frameId?: string | null;
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

// Layouts are never mutated, so their text form is computed once per object (handleChange compares them on every frame).
const sigs = new WeakMap<object, string>();

// JSON with object keys sorted at every level, so two layouts with the same content compare equal whatever order
// their keys were written in (a file edited by hand, a server that rebuilt the object).
const sorted = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(sorted).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${sorted(o[k])}`).join(',')}}`;
};

/** Stable text form of a layout ("" for none), for cache keys and for comparing layouts. Key order does not count. */
export function layoutSig(l: BlockLayout | undefined | null): string {
  if (!l) return '';
  let s = sigs.get(l);
  if (s === undefined) {
    s = sorted(l);
    sigs.set(l, s);
  }
  return s;
}

/** What the picture depends on: type, code and layout (not where the block sits). */
export const drawSig = (b: Pick<BlockLike, 'type' | 'code' | 'layout'>): string => `${b.type}\n${b.code}\n${layoutSig(b.layout)}`;

/** File id of a rendered block image: changes whenever the picture would change. */
export const fileIdFor = (b: DrawKey, theme: string) => `blk_${b.id}_${hash(`${theme}\n${drawSig(b)}`)}`;

const checked = new WeakMap<object, boolean>();

/**
 * A layout read back from an image's `customData`. Anything the server would refuse counts as none (same rules,
 * `layoutProblem`), so a bad value never reaches a save. The object is kept as is, checked once.
 */
export function asLayout(v: unknown): BlockLayout | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  let ok = checked.get(v);
  if (ok === undefined) {
    ok = layoutProblem(v) === null;
    checked.set(v, ok);
  }
  return ok ? (v as BlockLayout) : undefined;
}

export type SplitScene<E extends SceneEl> = {
  /** Free-form elements to save in file.canvas.elements (deleted ones dropped). */
  free: E[];
  /** Geometry of live block images, by block id. */
  geometry: Map<string, BlockGeom>;
  /** The frame each live block image sits in, by block id (null: none). */
  frames: Map<string, string | null>;
  /** Block ids whose image was deleted on the canvas. */
  deleted: Set<string>;
  /** `customData.layout` of live block images, by block id (undefined: the image carries none). */
  layouts: Map<string, BlockLayout | undefined>;
};

export function splitScene<E extends SceneEl>(elements: readonly E[]): SplitScene<E> {
  const free: E[] = [];
  const geometry = new Map<string, BlockGeom>();
  const frames = new Map<string, string | null>();
  const deleted = new Set<string>();
  const layouts = new Map<string, BlockLayout | undefined>();
  for (const el of elements) {
    const bid = blockIdOf(el);
    if (bid === null) {
      if (!el.isDeleted) free.push(el);
    } else if (el.isDeleted) {
      if (!geometry.has(bid)) deleted.add(bid);
    } else {
      geometry.set(bid, { x: el.x, y: el.y, w: el.width, h: el.height });
      frames.set(bid, el.frameId || null);
      layouts.set(bid, asLayout(el.customData?.layout));
      deleted.delete(bid);
    }
  }
  return { free, geometry, frames, deleted, layouts };
}

const round = (v: number) => Math.round(v * 100) / 100;
const same = (a: BlockGeom, b: BlockGeom) => round(a.x) === round(b.x) && round(a.y) === round(b.y) && round(a.w) === round(b.w) && round(a.h) === round(b.h);

/**
 * Apply canvas moves/resizes/deletes to the block list. Returns the same array when nothing changed,
 * so callers can skip a save.
 */
export function applyScene<B extends BlockLike>(
  blocks: readonly B[],
  split: Pick<SplitScene<SceneEl>, 'geometry' | 'deleted'> & Partial<Pick<SplitScene<SceneEl>, 'frames'>>,
  /** Layouts to take from images (see `layoutsFromImages`); a block id with `undefined` has its layout cleared. */
  layouts?: ReadonlyMap<string, BlockLayout | undefined>,
): readonly B[] {
  let changed = false;
  const out: B[] = [];
  for (const b of blocks) {
    if (split.deleted.has(b.id)) {
      changed = true;
      continue;
    }
    const g = split.geometry.get(b.id);
    let nb = b;
    if (g && !same(g, b)) nb = { ...nb, x: round(g.x), y: round(g.y), w: round(g.w), h: round(g.h) };
    // The image's frame is kept on the block, since the image is rebuilt on load (#83).
    const f = split.frames?.get(b.id);
    if (f !== undefined && (f ?? undefined) !== b.frameId) {
      const { frameId: _drop, ...rest } = nb;
      nb = (f ? { ...rest, frameId: f } : rest) as B;
    }
    if (layouts?.has(b.id)) {
      const l = layouts.get(b.id);
      if (layoutSig(l) !== layoutSig(b.layout)) {
        const { layout: _drop, ...rest } = nb;
        nb = (l ? { ...rest, layout: l } : rest) as B;
      }
    }
    if (nb !== b) changed = true;
    out.push(nb);
  }
  return changed ? out : blocks;
}

/**
 * Layouts that changed on their image since `seen` (block id → layout text last seen on that image).
 * The block is the source of truth, so an image only wins when its own `customData.layout` moved
 * (a layout edit or its undo), not when it merely lags behind a block change. Updates `seen` in place.
 */
export function layoutsFromImages(layouts: ReadonlyMap<string, BlockLayout | undefined>, seen: Map<string, string>): Map<string, BlockLayout | undefined> {
  const changed = new Map<string, BlockLayout | undefined>();
  for (const [id, l] of layouts) {
    const sig = layoutSig(l);
    if (seen.get(id) === sig) continue;
    seen.set(id, sig);
    changed.set(id, l);
  }
  return changed;
}

/**
 * Where the layout origin sits in a picture (picture = layout + origin), for a picture that is a real drawing of the
 * code with the block's layout applied (or none). `key` names what was drawn apart from the layout: theme, type, code.
 * Placeholders, last-good pictures kept for broken code and pictures whose layout was reset have no anchor.
 */
export type OriginAnchor = { key: string; x: number; y: number };

/**
 * Where a block image should sit after its picture changed. When only the layout changed (a node was dragged and the
 * bounds moved), the layout origin must not move on screen (design §5.6), so the image shifts by the origin change,
 * scaled like the picture: `x' = x + s * (origin.x - origin'.x)`. Any other change (code, theme, an error picture,
 * an automatic reset) leaves the block where it is.
 */
export function shiftForOrigin(
  el: { x: number; y: number; width: number },
  oldPic: { width: number; anchor?: OriginAnchor } | undefined,
  newPic: { anchor?: OriginAnchor },
): { x: number; y: number } {
  const a = oldPic?.anchor;
  const b = newPic.anchor;
  if (!a || !b || a.key !== b.key || !(oldPic!.width > 0)) return { x: el.x, y: el.y };
  const s = el.width / oldPic!.width;
  return { x: round(el.x + s * (a.x - b.x)), y: round(el.y + s * (a.y - b.y)) };
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
    frameId: b.frameId ?? null,
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
    customData: b.layout ? { blockId: b.id, layout: b.layout } : { blockId: b.id },
  };
}

const isFrame = (e: SceneEl) => !e.isDeleted && (e.type === 'frame' || e.type === 'magicframe');

/**
 * Blocks whose stored frame is not a live frame in `elements` lose it, so a rebuilt image never points at a frame
 * that is gone. Returns the same array when every stored frame is live.
 */
export function liveFrames<B extends BlockLike>(blocks: readonly B[], elements: readonly SceneEl[]): readonly B[] {
  const live = new Set(elements.filter(isFrame).map((e) => e.id));
  let changed = false;
  const out = blocks.map((b) => {
    if (!b.frameId || live.has(b.frameId)) return b;
    changed = true;
    const { frameId: _drop, ...rest } = b;
    return rest as B;
  });
  return changed ? out : blocks;
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

type PicSize = { width: number; height: number };

/**
 * Where a block's image goes. A placed block keeps its spot and width (height follows the picture);
 * a block never placed gets the picture's own size and a spot clear of everything in `taken`.
 */
function placeBlock<B extends BlockGeom>(b: B, p: PicSize, taken: Rect[]): B {
  if (!isUnplaced(b)) return { ...b, h: fitHeight(b.w, p.width, p.height) };
  const spot = findFreeSpot(p.width, p.height, taken);
  const out = { ...b, ...spot, w: p.width, h: p.height };
  taken.push(out);
  return out;
}

/**
 * Place a batch of blocks shown for the first time (`pics[i]` is block i's picture). Blocks with a spot are
 * counted first, at the height their picture gives them, so blocks still to place keep clear of all of them.
 * `taken` (what is on the canvas already) gets the new boxes added.
 */
export function placeBlocks<B extends BlockGeom>(list: readonly B[], pics: readonly PicSize[], taken: Rect[]): B[] {
  list.forEach((b, i) => {
    if (!isUnplaced(b)) taken.push({ x: b.x, y: b.y, w: b.w, h: fitHeight(b.w, pics[i]!.width, pics[i]!.height) });
  });
  return list.map((b, i) => placeBlock(b, pics[i]!, taken));
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

/**
 * Same pictures: the same blocks in the same order with the same type, code and layout; where they sit does not
 * count. Unchanged code keeps its string, so this is cheap on every drag frame.
 */
export function sameDrawing(a: readonly DrawKey[], b: readonly DrawKey[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].type !== b[i].type || a[i].code !== b[i].code) return false;
    if (a[i].layout !== b[i].layout && layoutSig(a[i].layout) !== layoutSig(b[i].layout)) return false;
  }
  return true;
}

/** Per block id: the type+code last drawn and its picture. Owned by one canvas. */
export type PictureCache<P> = Map<string, { sig: string; pic: Promise<P> }>;

/**
 * Pictures for `blocks`, calling `render` only for blocks whose type or code changed since the last call
 * with this cache. Blocks no longer in the list are dropped from the cache.
 */
export function picturesFor<B extends DrawKey, P>(blocks: readonly B[], cache: PictureCache<P>, render: (b: B) => Promise<P>): Promise<P[]> {
  const ids = new Set(blocks.map((b) => b.id));
  for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  return Promise.all(
    blocks.map((b) => {
      const sig = drawSig(b);
      const hit = cache.get(b.id);
      if (hit?.sig === sig) return hit.pic;
      const pic = render(b);
      cache.set(b.id, { sig, pic });
      return pic;
    }),
  );
}
