// Canvas mount of the progress board (design 2 §5.1): a RunLayer over every block image that has a run, placed with
// the layout-edit frame math and moved on scroll and zoom only. Run updates change what is drawn, never where.
import { useEffect, useState } from 'react';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types';
import type { Scene } from '../../../shared/render/index.ts';
import { RunLayer } from '../run/RunLayer';
import { useRunBlocks } from '../run/runStore';
import { layoutFrame } from './layoutEdit';
import { blockIdOf, type SceneEl } from './sync';

type Pic = { width: number; scene?: Scene };
type Placed = { blockId: string; scene: Scene; left: number; top: number; scale: number };

/**
 * Where each run block's picture sits in the wrapper. Scene units are picture pixels, so this is the layout frame
 * with a zero origin. Rotated, hidden or deleted images and pictures without a scene (placeholders) are skipped.
 */
export function placeRuns(
  els: readonly ExcalidrawElement[],
  st: Pick<AppState, 'scrollX' | 'scrollY' | 'zoom' | 'offsetLeft' | 'offsetTop'>,
  wrapRect: { left: number; top: number },
  runs: ReadonlyMap<string, unknown>,
  pictureOf: (fileId: string) => Pic | undefined,
  hide: string | null,
): Placed[] {
  const out: Placed[] = [];
  const seen = new Set<string>();
  for (const e of els) {
    if (e.isDeleted || e.type !== 'image' || e.opacity === 0 || e.angle !== 0) continue;
    const blockId = blockIdOf(e as unknown as SceneEl);
    if (!blockId || blockId === hide || seen.has(blockId) || !runs.has(blockId)) continue;
    const img = e as ExcalidrawImageElement;
    const pic = pictureOf(img.fileId ?? '');
    if (!pic?.scene || !(img.width > 0)) continue;
    seen.add(blockId);
    const f = layoutFrame(img, { width: pic.width, origin: { x: 0, y: 0 } }, { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, offsetX: st.offsetLeft - wrapRect.left, offsetY: st.offsetTop - wrapRect.top });
    out.push({ blockId, scene: pic.scene, left: f.x, top: f.y, scale: f.k });
  }
  return out;
}

const samePlaced = (a: Placed[], b: Placed[]) =>
  a.length === b.length && a.every((p, i) => p.blockId === b[i]!.blockId && p.scene === b[i]!.scene && p.left === b[i]!.left && p.top === b[i]!.top && p.scale === b[i]!.scale);

type Props = {
  api: ExcalidrawImperativeAPI;
  wrap: HTMLElement;
  pictureOf: (fileId: string) => Pic | undefined;
  /** Block in layout edit mode: its own overlay draws the picture, so no board over it. */
  hide: string | null;
};

export function RunOverlay({ api, wrap, pictureOf, hide }: Props) {
  const runs = useRunBlocks();
  const [placed, setPlaced] = useState<Placed[]>([]);
  useEffect(() => {
    if (!runs.size) {
      setPlaced([]);
      return;
    }
    const place = (els: readonly ExcalidrawElement[], st: AppState) => {
      const next = placeRuns(els, st, wrap.getBoundingClientRect(), runs, pictureOf, hide);
      setPlaced((old) => (samePlaced(old, next) ? old : next));
    };
    place(api.getSceneElements(), api.getAppState());
    return api.onChange((els, st) => place(els, st));
  }, [api, wrap, runs, pictureOf, hide]);
  if (!placed.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[4] overflow-hidden" data-run-overlay="">
      {placed.map((p) => {
        const steps = runs.get(p.blockId);
        return steps ? <RunLayer key={p.blockId} scene={p.scene} steps={steps} left={p.left} top={p.top} scale={p.scale} /> : null;
      })}
    </div>
  );
}
