// Where the progress board sits over each block picture on the canvas (design 2 §5.1). Pure (no Excalidraw or React
// import), so it runs under `node --test`; RunOverlay calls it on scroll and zoom.
import type { Scene } from '../../../shared/render/index.ts';
import { layoutFrame } from './layoutEdit.ts';
import { blockIdOf, type SceneEl } from './sync.ts';

export type Pic = { width: number; scene?: Scene };
export type Placed = { blockId: string; scene: Scene; left: number; top: number; scale: number };

/** The element fields placement reads (an Excalidraw image element has them all). */
export type PlaceEl = SceneEl & { opacity?: number; angle?: number; fileId?: string | null };

/** The app state fields placement reads. */
export type PlaceView = { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft: number; offsetTop: number };

/**
 * Where each run block's picture sits in the wrapper. Scene units are picture pixels, so this is the layout frame
 * with a zero origin. Rotated, hidden or deleted images, pictures without a scene (placeholders) and later copies of
 * a block already placed are skipped.
 */
export function placeRuns(
  els: readonly PlaceEl[],
  st: PlaceView,
  wrapRect: { left: number; top: number },
  runs: { has(blockId: string): boolean },
  pictureOf: (fileId: string) => Pic | undefined,
  hide: string | null,
): Placed[] {
  const out: Placed[] = [];
  const seen = new Set<string>();
  for (const e of els) {
    if (e.isDeleted || e.type !== 'image' || e.opacity === 0 || (e.angle ?? 0) !== 0) continue;
    const blockId = blockIdOf(e);
    if (!blockId || blockId === hide || seen.has(blockId) || !runs.has(blockId)) continue;
    const pic = pictureOf(e.fileId ?? '');
    if (!pic?.scene || !(e.width > 0)) continue;
    seen.add(blockId);
    const f = layoutFrame(e, { width: pic.width, origin: { x: 0, y: 0 } }, { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, offsetX: st.offsetLeft - wrapRect.left, offsetY: st.offsetTop - wrapRect.top });
    out.push({ blockId, scene: pic.scene, left: f.x, top: f.y, scale: f.k });
  }
  return out;
}

export const samePlaced = (a: readonly Placed[], b: readonly Placed[]) =>
  a.length === b.length && a.every((p, i) => p.blockId === b[i]!.blockId && p.scene === b[i]!.scene && p.left === b[i]!.left && p.top === b[i]!.top && p.scale === b[i]!.scale);
