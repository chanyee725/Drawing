// Canvas mount of the progress board (design 2 §5.1): a RunLayer over every block image that has a run, placed with
// the layout-edit frame math and moved on scroll and zoom only. Run updates change what is drawn, never where.
//
// Stacking: Excalidraw's static canvas is z 1, its text editor 3 and its UI layer (toolbar, menus) 4, and `.excalidraw`
// makes no stacking context. This layer is z 3 and comes later in the DOM: above the drawing, under the toolbar and
// menus, so it never covers or blocks them (#186). It takes no pointer events except its own motion switch.
import { useEffect, useRef, useState } from 'react';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { RunLayer } from '../run/RunLayer';
import { useRunBlocks } from '../run/runStore';
import { placeRuns, samePlaced, type Pic, type PlaceEl, type Placed } from './runPlace';

export { placeRuns } from './runPlace';

type Props = {
  api: ExcalidrawImperativeAPI;
  wrap: HTMLElement;
  pictureOf: (fileId: string) => Pic | undefined;
  /** Block in layout edit mode: its own overlay draws the picture, so no board over it. */
  hide: string | null;
};

/** Room above a picture for the motion switch; closer to the top it moves inside the picture so it is not clipped. */
const MOTION_ROOM = 28;

export function RunOverlay({ api, wrap, pictureOf, hide }: Props) {
  const runs = useRunBlocks();
  const [placed, setPlaced] = useState<Placed[]>([]);
  const frame = useRef(0);
  useEffect(() => {
    if (!runs.size) {
      setPlaced([]);
      return;
    }
    // Excalidraw calls onChange many times a frame while panning: measure and scan once per animation frame.
    let last: { els: readonly ExcalidrawElement[]; st: AppState } | null = null;
    const place = () => {
      frame.current = 0;
      if (!last) return;
      const next = placeRuns(last.els as readonly PlaceEl[], last.st, wrap.getBoundingClientRect(), runs, pictureOf, hide);
      setPlaced((old) => (samePlaced(old, next) ? old : next));
    };
    const queue = (els: readonly ExcalidrawElement[], st: AppState) => {
      last = { els, st };
      if (!frame.current) frame.current = requestAnimationFrame(place);
    };
    last = { els: api.getSceneElements(), st: api.getAppState() };
    place();
    const off = api.onChange(queue);
    return () => {
      off();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [api, wrap, runs, pictureOf, hide]);
  if (!placed.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" data-run-overlay="">
      {placed.map((p) => {
        const steps = runs.get(p.blockId);
        return steps ? <RunLayer key={p.blockId} scene={p.scene} steps={steps} left={p.left} top={p.top} scale={p.scale} motionInside={p.top < MOTION_ROOM} /> : null;
      })}
    </div>
  );
}
