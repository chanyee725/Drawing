// The infinite canvas: Excalidraw (MIT) with diagram blocks shown as image elements.
// Loaded lazily from CanvasPane so the editor shell does not wait for it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, exportToBlob, exportToSvg, newElementWith, restoreElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI, BinaryFileData } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import type { Block } from '../api';
import { BlockEditor } from '../BlockEditor';
import { BlockProps } from '../BlockProps';
import { DIAGRAM_TYPES, TEMPLATES, isDiagramType, type DiagramType } from '../dsl/templates';
import { analyzeDiagram } from '../dsl/adapter';
import { blockLabel, brokenNotice, type BrokenBlock } from './notice';
import { renderBlock, type BlockPicture } from './render';
import type { CanvasHandle } from '../export/types';
import { applyScene, blockIdOf, blockImageSkeleton, findCopies, findFreeSpot, fitHeight, freeSignature, isUnplaced, newBlockId, picturesFor, rectOf, sameDrawing, splitScene, type PictureCache, type Rect, type SceneEl } from './sync';

export type CanvasData = { elements: unknown[]; appState: Record<string, unknown> };
/** Show (scroll to and select) this block's image; a new `n` is a new request. */
export type CanvasFocus = { blockId: string; n: number };

type Props = {
  canvas: CanvasData;
  blocks: Block[];
  focus: CanvasFocus | null;
  dark: boolean;
  onChange: (patch: { canvas?: CanvasData; blocks?: Block[] }) => void;
  /** Filled while this canvas is mounted, so export, the palette and shortcuts can reach it. */
  handle?: { current: CanvasHandle | null };
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
// Web embeds load third-party pages in iframes; the canvas makes no outbound requests.
const NO_EMBEDS = () => false;

export default function ExcalidrawCanvas({ canvas, blocks, focus, dark, onChange, handle }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Only diagram blocks are selected: hide Excalidraw's "double-click to crop" hint, since that opens the code.
  const [blockSelected, setBlockSelected] = useState(false);
  // Blocks whose code has errors (they show their last good picture), for the notice on the canvas.
  const [broken, setBroken] = useState<BrokenBlock[]>([]);
  // Picture size per file id, to keep a block's scale when its picture changes.
  const sizes = useRef(new Map<string, { width: number; height: number }>());
  // The picture each block shows, so a block whose code did not change is not rendered again.
  const picCache = useRef<PictureCache<BlockPicture>>(new Map());
  const draw = useCallback((list: readonly Block[]) => picturesFor(list, picCache.current, (b) => renderBlock(b, PIC_THEME)), []);
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
  // Block id → the one image element that shows it; other images with that block id are copies.
  const owners = useRef(new Map<string, string>());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusDone = useRef(0);

  // Show the requested block once its image is on the canvas (a new block's image arrives after its picture is drawn).
  const tryFocus = useCallback(() => {
    const f = focusRef.current;
    const xapi = apiRef.current;
    if (!f || !xapi || focusDone.current === f.n) return;
    const el = xapi.getSceneElements().find((e) => blockIdOf(e as unknown as SceneEl) === f.blockId);
    if (!el) return;
    focusDone.current = f.n;
    xapi.updateScene({ appState: { selectedElementIds: { [el.id]: true } }, captureUpdate: CaptureUpdateAction.NEVER });
    xapi.scrollToContent(el, { fitToViewport: true, viewportZoomFactor: 0.7, animate: true });
    // Move focus to the canvas, so Enter opens the block's code right away.
    wrap.current?.querySelector<HTMLElement>('.excalidraw')?.focus({ preventScroll: true });
  }, []);
  useEffect(tryFocus, [api, focus, tryFocus]);

  // Built once per mount (CanvasPane remounts on file switch/reload).
  const initialData = useMemo(
    () => async () => {
      const pics = await draw(blocks);
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

  // What the images depend on: which blocks exist and their type and code, not where they sit. Dragging a
  // block changes `blocks` on every frame; `drawn` keeps its identity then, so nothing below runs.
  const drawnRef = useRef(blocks);
  if (!sameDrawing(drawnRef.current, blocks)) drawnRef.current = blocks;
  const drawn = drawnRef.current;

  // Keep block images in step with the block list: new code → new picture, new block → new image, removed block → gone.
  useEffect(() => {
    if (!api) return;
    let live = true;
    const blocks = blocksRef.current;
    void draw(blocks).then((pics) => {
      if (!live) return;
      setBroken(pics.flatMap((p, i) => (p.errors > 0 || p.failed ? [{ id: blocks[i]!.id, type: blocks[i]!.type, errors: p.errors, lastGood: p.lastGood, failed: p.failed }] : [])));
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
      tryFocus();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, drawn, draw, tryFocus]);

  const handleChange = useCallback((sceneEls: readonly ExcalidrawElement[], appState: AppState) => {
    const sel = sceneEls.filter((e) => appState.selectedElementIds[e.id] && !e.isDeleted);
    setBlockSelected(sel.length > 0 && sel.every((e) => blockIdOf(e as unknown as SceneEl) !== null));
    let elements = sceneEls;
    let cur = blocksRef.current;
    // A copied block image (duplicate, paste, alt-drag) becomes a new block with the same code.
    const copies = findCopies(elements as unknown as readonly SceneEl[], owners.current);
    const xapi = apiRef.current;
    if (copies.length && xapi) {
      const retag = new Map<string, string>();
      const added: Block[] = [];
      for (const c of copies) {
        const src = cur.find((b) => b.id === c.blockId);
        if (!src) continue;
        const id = newBlockId();
        retag.set(c.id, id);
        owners.current.set(id, c.id);
        // Geometry comes from the image below (applyScene).
        added.push({ ...src, id });
      }
      if (retag.size) {
        elements = elements.map((e) => (retag.has(e.id) ? newElementWith(e, { customData: { ...e.customData, blockId: retag.get(e.id)! } }) : e));
        cur = [...cur, ...added];
        xapi.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      }
    }
    const split = splitScene(elements as unknown as readonly SceneEl[]);
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
    if (next !== blocksRef.current) patch.blocks = [...next];
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

  // What export, the palette and shortcuts can do with this canvas.
  useEffect(() => {
    if (!api || !handle) return;
    // The selection (with the text bound to selected shapes), or everything when nothing is selected.
    const scope = () => {
      const st = api.getAppState();
      const all = api.getSceneElements();
      const picked = all.filter((e) => st.selectedElementIds[e.id]);
      const ids = new Set(picked.map((e) => e.id));
      const sel = picked.length ? all.filter((e) => ids.has(e.id) || (e.type === 'text' && e.containerId && ids.has(e.containerId))) : [];
      return { selected: sel.length > 0, elements: sel.length ? sel : all };
    };
    const opts = () => ({ exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false });
    handle.current = {
      scope: () => {
        const s = scope();
        return { selected: s.selected, count: s.elements.length };
      },
      svg: async () => {
        const { elements } = scope();
        if (!elements.length) return null;
        const el = await exportToSvg({ elements, appState: opts(), files: api.getFiles(), exportPadding: 16 });
        el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return { svg: new XMLSerializer().serializeToString(el), width: parseFloat(el.getAttribute('width') ?? '0'), height: parseFloat(el.getAttribute('height') ?? '0') };
      },
      png: async () => {
        const { elements } = scope();
        if (!elements.length) return null;
        return await exportToBlob({ elements, appState: opts(), files: api.getFiles(), mimeType: 'image/png', exportPadding: 16 });
      },
      key: ({ key, code, ctrl, meta, shift, alt }) => {
        const target = wrap.current?.querySelector<HTMLElement>('.excalidraw');
        if (!target) return;
        target.focus({ preventScroll: true });
        target.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: !!ctrl, metaKey: !!meta, shiftKey: !!shift, altKey: !!alt, bubbles: true, cancelable: true }));
      },
    };
    return () => {
      handle.current = null;
    };
  }, [api, handle]);

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
        validateEmbeddable={NO_EMBEDS}
        aiEnabled={false}
      />
      {broken.length > 0 && !block && (
        <div role="status" aria-label="코드 오류 안내" className="absolute bottom-16 left-3 z-10 flex max-w-[min(26rem,calc(100%-1.5rem))] flex-col gap-1 rounded-lg border p-2 text-xs shadow" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          {broken.map((b) => (
            <button key={b.id} type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setEditing(b.id)}>
              {brokenNotice(b, blockLabel(b, blocks, DIAGRAM_TYPES.find((t) => t.id === b.type)?.label ?? b.type))}
            </button>
          ))}
        </div>
      )}
      {block && (
        <aside
          aria-label="다이어그램 코드"
          className="absolute right-3 top-16 bottom-3 z-10 flex w-[min(28rem,calc(100%-1.5rem))] flex-col gap-2 rounded-lg border p-3 shadow-lg"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          // CodeMirror marks Escape it already used (closing the autocomplete popup) as handled; leave the panel open then.
          onKeyDown={(e) => e.key === 'Escape' && !e.defaultPrevented && setEditing(null)}
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
            {isDiagramType(block.type) && (
              <button
                type="button"
                className="h-8 rounded-md border px-3"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => {
                  const t = TEMPLATES[block.type as DiagramType];
                  if (!block.code.trim() || block.code === t || window.confirm('지금 코드를 예시로 바꿀까요?')) patchBlock({ code: t });
                }}
              >
                예시 넣기
              </button>
            )}
            <button type="button" className="ml-auto h-8 rounded-md border px-3" style={{ borderColor: 'var(--border)' }} onClick={() => setEditing(null)}>
              닫기
            </button>
          </div>
          <BlockProps type={block.type} code={block.code} onChange={(code) => patchBlock({ code })} />
          <div className="min-h-0 flex-1 overflow-auto">
            <BlockEditor key={block.id} code={block.code} type={block.type} dark={dark} onChange={(code) => patchBlock({ code })} />
          </div>
          {!analyzeDiagram(block.type, block.code).parsed && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              이 종류는 아직 문법 검사를 지원하지 않아요.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
