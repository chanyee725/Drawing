// The infinite canvas: Excalidraw (MIT) with diagram blocks shown as image elements.
// Loaded lazily from CanvasPane so the editor shell does not wait for it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, newElementWith, restoreElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI, BinaryFileData } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import type { Block } from '../api';
import { BlockEditor } from '../BlockEditor';
import { DIAGRAM_TYPES, isDiagramType } from '../dsl/templates';
import { renderBlock, type BlockPicture } from './render';
import { applyScene, blockIdOf, blockImageSkeleton, findFreeSpot, fitHeight, freeSignature, isUnplaced, rectOf, splitScene, type Rect, type SceneEl } from './sync';

export type CanvasData = { elements: unknown[]; appState: Record<string, unknown> };

type Props = {
  canvas: CanvasData;
  blocks: Block[];
  dark: boolean;
  onChange: (patch: { canvas?: CanvasData; blocks?: Block[] }) => void;
};

const theme = (dark: boolean) => (dark ? 'dark' : 'light') as 'dark' | 'light';
// Pictures are always drawn light: Excalidraw's dark mode inverts the whole canvas, images included.
const PIC_THEME = 'light';
const newElId = (blockId: string) => `blk_${blockId}_${Math.random().toString(36).slice(2, 8)}`;
const liveRects = (els: readonly ExcalidrawElement[]): Rect[] => els.filter((e) => !e.isDeleted).map((e) => rectOf(e));

/**
 * Where a block's image goes. A placed block keeps its spot and width (height follows the picture);
 * a block never placed gets the picture's own size and a spot clear of everything in `taken`.
 */
function placeBlock(b: Block, p: BlockPicture, taken: Rect[]): Block {
  if (!isUnplaced(b)) return { ...b, h: fitHeight(b.w, p.width, p.height) };
  const spot = findFreeSpot(p.width, p.height, taken);
  const out = { ...b, ...spot, w: p.width, h: p.height };
  taken.push(out);
  return out;
}

const fileData = (p: BlockPicture): BinaryFileData => ({ id: p.fileId as FileId, mimeType: 'image/svg+xml', dataURL: p.dataURL as BinaryFileData['dataURL'], created: Date.now() });

const UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false as const, saveAsImage: false, toggleTheme: false },
  tools: { image: false },
};

export default function ExcalidrawCanvas({ canvas, blocks, dark, onChange }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Only diagram blocks are selected: hide Excalidraw's "double-click to crop" hint, since that opens the code.
  const [blockSelected, setBlockSelected] = useState(false);
  // Picture size per file id, to keep a block's scale when its picture changes.
  const sizes = useRef(new Map<string, { width: number; height: number }>());
  const wrap = useRef<HTMLDivElement>(null);
  const blocksRef = useRef(blocks);
  const canvasRef = useRef(canvas);
  const onChangeRef = useRef(onChange);
  blocksRef.current = blocks;
  canvasRef.current = canvas;
  onChangeRef.current = onChange;
  const sigRef = useRef<string | null>(null);
  // Blocks removed by deleting their image, kept so undo can bring them back.
  const graveyard = useRef(new Map<string, Block>());

  // Built once per mount (CanvasPane remounts on file switch/reload).
  const initialData = useMemo(
    () => async () => {
      const pics = await Promise.all(blocks.map((b) => renderBlock(b, PIC_THEME)));
      for (const p of pics) sizes.current.set(p.fileId, p);
      const free = restoreElements(canvas.elements as ExcalidrawElement[], null);
      sigRef.current = freeSignature(free);
      // Placed blocks first, so blocks still to place keep clear of them.
      const taken = [...liveRects(free), ...blocks.filter((b) => !isUnplaced(b)).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))];
      const images = restoreElements(
        blocks.map((b, i) => blockImageSkeleton(placeBlock(b, pics[i], taken), pics[i].fileId, newElId(b.id)) as unknown as ExcalidrawElement),
        null,
      );
      return { elements: [...free, ...images], files: Object.fromEntries(pics.map((p) => [p.fileId, fileData(p)])), scrollToContent: true };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Keep block images in step with the block list: new code → new picture, new block → new image, removed block → gone.
  useEffect(() => {
    if (!api) return;
    let live = true;
    void Promise.all(blocks.map((b) => renderBlock(b, PIC_THEME))).then((pics) => {
      if (!live) return;
      for (const p of pics) sizes.current.set(p.fileId, p);
      const files = api.getFiles();
      const add = pics.filter((p) => !files[p.fileId]).map(fileData);
      if (add.length) api.addFiles(add);
      const els = api.getSceneElementsIncludingDeleted();
      const index = new Map(blocks.map((b, i) => [b.id, i]));
      const shown = new Set<string>();
      let changed = false;
      const next: ExcalidrawElement[] = els.map((el) => {
        const bid = blockIdOf(el as unknown as SceneEl);
        if (bid === null || el.isDeleted) return el;
        const i = index.get(bid);
        if (i === undefined || shown.has(bid)) {
          changed = true;
          return newElementWith(el, { isDeleted: true });
        }
        shown.add(bid);
        const p = pics[i];
        const img = el as ExcalidrawImageElement;
        if (img.fileId === p.fileId) return el;
        changed = true;
        // Keep the zoom the block was shown at, so a bigger diagram takes more room instead of shrinking.
        const old = sizes.current.get(img.fileId ?? '');
        const scale = old && old.width > 0 ? img.width / old.width : 1;
        return newElementWith(img, { fileId: p.fileId as FileId, width: p.width * scale, height: p.height * scale });
      });
      const missing = blocks.filter((b) => !shown.has(b.id));
      if (missing.length) {
        changed = true;
        const taken = liveRects(next);
        const skeletons = missing.map((b) => {
          const p = pics[index.get(b.id)!];
          return blockImageSkeleton(placeBlock(b, p, taken), p.fileId, newElId(b.id)) as unknown as ExcalidrawElement;
        });
        next.push(...restoreElements(skeletons, null));
      }
      if (changed) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
    });
    return () => {
      live = false;
    };
  }, [api, blocks]);

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    const sel = elements.filter((e) => appState.selectedElementIds[e.id] && !e.isDeleted);
    setBlockSelected(sel.length > 0 && sel.every((e) => blockIdOf(e as unknown as SceneEl) !== null));
    const split = splitScene(elements as unknown as readonly SceneEl[]);
    const cur = blocksRef.current;
    for (const b of cur) if (split.deleted.has(b.id)) graveyard.current.set(b.id, b);
    let next = applyScene(cur, split);
    // An image came back (undo) for a block that was deleted on the canvas.
    const back = [...split.geometry.keys()].filter((id) => !cur.some((b) => b.id === id) && graveyard.current.has(id));
    if (back.length) {
      next = [
        ...next,
        ...back.map((id) => {
          const g = split.geometry.get(id)!;
          const old = graveyard.current.get(id)!;
          graveyard.current.delete(id);
          return { ...old, x: g.x, y: g.y, w: g.w, h: g.h };
        }),
      ];
    }
    const sig = freeSignature(split.free);
    const patch: { canvas?: CanvasData; blocks?: Block[] } = {};
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      patch.canvas = { ...canvasRef.current, elements: split.free as unknown[] };
    }
    if (next !== cur) patch.blocks = [...next];
    if (patch.canvas || patch.blocks) onChangeRef.current(patch);
  }, []);

  // Double-click on a diagram block opens its code instead of Excalidraw's image crop.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !api) return;
    const onDbl = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      const { x, y } = viewportCoordsToSceneCoords(e, api.getAppState());
      const hit = [...api.getSceneElements()]
        .reverse()
        .find((s) => blockIdOf(s as unknown as SceneEl) !== null && x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);
      if (!hit) return;
      e.stopPropagation();
      e.preventDefault();
      setEditing(blockIdOf(hit as unknown as SceneEl));
    };
    // Enter on a selected block opens its code too (Excalidraw would start cropping).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || !(e.target instanceof HTMLElement) || e.target.closest('aside, input, textarea, [contenteditable]')) return;
      const st = api.getAppState();
      const sel = api.getSceneElements().filter((s) => st.selectedElementIds[s.id]);
      if (sel.length !== 1) return;
      const bid = blockIdOf(sel[0] as unknown as SceneEl);
      if (bid === null) return;
      e.stopPropagation();
      e.preventDefault();
      setEditing(bid);
    };
    el.addEventListener('dblclick', onDbl, true);
    el.addEventListener('keydown', onKey, true);
    return () => {
      el.removeEventListener('dblclick', onDbl, true);
      el.removeEventListener('keydown', onKey, true);
    };
  }, [api]);

  const block = editing ? blocks.find((b) => b.id === editing) : undefined;
  useEffect(() => {
    if (editing && !block) setEditing(null);
  }, [editing, block]);
  const patchBlock = (p: Partial<Block>) => onChangeRef.current({ blocks: blocksRef.current.map((b) => (b.id === editing ? { ...b, ...p } : b)) });

  return (
    <div ref={wrap} className={`relative h-full w-full${blockSelected ? ' block-selected' : ''}`} data-canvas="excalidraw">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={handleChange}
        theme={theme(dark)}
        langCode="ko-KR"
        UIOptions={UI_OPTIONS}
      />
      {block && (
        <aside
          aria-label="다이어그램 코드"
          className="absolute right-3 top-16 bottom-3 z-10 flex w-[min(28rem,calc(100%-1.5rem))] flex-col gap-2 rounded-lg border p-3 shadow-lg"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">다이어그램 코드</span>
            <select
              aria-label="종류"
              value={block.type}
              onChange={(e) => patchBlock({ type: e.target.value })}
              className="h-8 rounded-md border px-2"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              {!isDiagramType(block.type) && <option value={block.type}>{block.type}</option>}
              {DIAGRAM_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="button" className="ml-auto h-8 rounded-md border px-3" style={{ borderColor: 'var(--border)' }} onClick={() => setEditing(null)}>
              닫기
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <BlockEditor key={block.id} code={block.code} type={block.type} dark={dark} onChange={(code) => patchBlock({ code })} />
          </div>
        </aside>
      )}
    </div>
  );
}
