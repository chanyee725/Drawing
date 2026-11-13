// The infinite canvas: Excalidraw (MIT) with diagram blocks shown as image elements.
// Loaded lazily from CanvasPane so the editor shell does not wait for it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, exportToBlob, exportToSvg, newElementWith, restoreElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI, BinaryFileData } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import type { Block } from '../api';
import type { BlockLayout } from '../../../shared/render/index.ts';
import { BlockEditor } from '../BlockEditor';
import { BlockProps } from '../BlockProps';
import { CanvasInsertMenu } from './CanvasInsertMenu';
import { DIAGRAM_TYPES, TEMPLATES, isDiagramType, type DiagramType } from '../dsl/templates';
import { analyzeDiagram, prunedLayout } from '../dsl/adapter';
import { blockLabel, brokenNotice, type BrokenBlock } from './notice';
import { renderBlock, type BlockPicture } from './render';
import { baseFileId, pictureScale, scaleSvg, svgDataURL, variantId } from './resolution';
import type { CanvasHandle } from '../export/types';
import { DEFAULT_EXPORT, type ExportOptions } from '../export/options';
import { applyScene, blockIdOf, blockImageSkeleton, findCopies, freeSignature, hash, layoutSig, layoutsFromImages, newBlockId, picturesFor, placeBlocks, rectOf, sameDrawing, shiftForOrigin, splitScene, type PictureCache, type Rect, type SceneEl } from './sync';
import { LayoutEditOverlay, focusCanvas, type EditStart } from './LayoutEditOverlay';
import { openLayoutSession, sessionKey, type LayoutSession } from './layoutSession';
import { bindArrows, frameFor, sceneToFreeform } from './freeform';
import { hitHandle, imageReason, layoutFrame, layoutHandles, toLayout, type LayoutFrame } from './layoutEdit';

export type CanvasData = { elements: unknown[]; appState: Record<string, unknown> };
/** Show (scroll to and select) this block's image; a new `n` is a new request. */
export type CanvasFocus = { blockId?: string; frameId?: string; n: number };

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

const fileData = (p: BlockPicture, k = 1): BinaryFileData => ({
  id: variantId(p.fileId, k) as FileId,
  mimeType: 'image/svg+xml',
  dataURL: (k === 1 ? p.dataURL : svgDataURL(scaleSvg(p.svg, k))) as BinaryFileData['dataURL'],
  created: Date.now(),
});

const UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false as const, saveAsImage: false, toggleTheme: false },
  tools: { image: false },
};
// Web embeds load third-party pages in iframes; the canvas makes no outbound requests.
const NO_EMBEDS = () => false;

/** The layout session made for one block's code (or why there is none). */
type Sess = { blockId: string; key: string; s: LayoutSession | { reason: string } };
/** Layout edit mode for a block; `start` is the press that entered it on a node, continued as a drag. */
type Edit = { blockId: string; start: EditStart | null };
const ready = (s: Sess | null, b: Block | undefined): LayoutSession | null => (s && b && s.blockId === b.id && s.key === sessionKey(b) && !('reason' in s.s) ? s.s : null);
const withLayout = (cd: Record<string, unknown> | undefined, layout: BlockLayout | undefined) => {
  const { layout: _old, ...rest } = cd ?? {};
  return layout ? { ...rest, layout } : rest;
};
const isGraphType = (type: string | undefined) => type === 'architecture' || type === 'flowchart';
const BAR_BTN = 'h-7 rounded-md border px-2.5';

export default function ExcalidrawCanvas({ canvas, blocks, focus, dark, onChange, handle }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Only diagram blocks are selected: hide Excalidraw's "double-click to crop" hint, since that opens the code.
  const [blockSelected, setBlockSelected] = useState(false);
  // Blocks whose code has errors (they show their last good picture), for the notice on the canvas.
  const [broken, setBroken] = useState<BrokenBlock[]>([]);
  // Blocks drawn with their saved layout left out because the code changed a lot (design §4.2).
  const [resets, setResets] = useState<ReadonlySet<string>>(new Set());
  // Picture size per file id, to keep a block's scale when its picture changes.
  const sizes = useRef(new Map<string, BlockPicture>());
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
  // Block id → layout text last seen on its image's customData; a block takes the image's layout only when that changes (an undo).
  const seenLayouts = useRef(new Map<string, string>());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusDone = useRef(0);

  // Layout edit mode (design §5): the one selected block, its session (opened ahead, so a press can enter at once),
  // the block being edited and where its layout sits on screen.
  const [selBlock, setSelBlock] = useState<string | null>(null);
  const [sess, setSess] = useState<Sess | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [frame, setFrame] = useState<LayoutFrame | null>(null);
  // Why the selected block cannot be laid out by hand, shown after a try.
  const [notice, setNotice] = useState<{ blockId: string; text: string } | null>(null);
  const selRef = useRef(selBlock);
  selRef.current = selBlock;
  const sessRef = useRef(sess);
  sessRef.current = sess;
  const editRef = useRef<Edit | null>(null);
  const startN = useRef(0);
  // Opacity the edited block image had before it was hidden under the overlay.
  const hiddenOpacity = useRef(100);

  const imageOf = (els: readonly ExcalidrawElement[], blockId: string) => els.find((e) => !e.isDeleted && blockIdOf(e as unknown as SceneEl) === blockId) as ExcalidrawImageElement | undefined;

  /** Where the block's layout lands in the wrapper, from its image and the view; null while its picture is not current. */
  const frameOf = useCallback((img: ExcalidrawImageElement, st: AppState, b: Block): LayoutFrame | null => {
    const pic = sizes.current.get(baseFileId(img.fileId ?? ''));
    const el = wrap.current;
    if (!pic || !el) return null;
    let origin = pic.anchor && pic.anchor.key === hash(`${PIC_THEME}\n${b.type}\n${b.code}`) ? pic.anchor : null;
    // A picture drawn with its layout left out (§4.2) has no anchor, but it is what the session composes for that layout.
    const s = ready(sessRef.current, b);
    if (!pic.anchor && pic.layoutReset && s) origin = { key: '', ...(s.compose(b.layout).scene.origin ?? { x: 0, y: 0 }) };
    if (!origin) return null;
    const r = el.getBoundingClientRect();
    return layoutFrame(img, { width: pic.width, origin }, { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, offsetX: st.offsetLeft - r.left, offsetY: st.offsetTop - r.top });
  }, []);

  const sameFrame = (a: LayoutFrame | null, b: LayoutFrame | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.k === b.k);

  /** Place the overlay again from the edited block's image and picture (both can change without a scene change). */
  const refreshFrame = useCallback(() => {
    const ed = editRef.current;
    const xapi = apiRef.current;
    const b = ed && blocksRef.current.find((x) => x.id === ed.blockId);
    if (!xapi || !ed || !b) return;
    const img = imageOf(xapi.getSceneElements(), ed.blockId);
    const f = img ? frameOf(img, xapi.getAppState(), b) : null;
    setFrame((old) => (sameFrame(old, f) ? old : f));
  }, [frameOf]);

  /** Leave layout edit mode: show the image again, and select it unless the press that ended the mode selects something. */
  const exitEdit = useCallback((reselect: boolean) => {
    const ed = editRef.current;
    if (!ed) return;
    editRef.current = null;
    setEdit(null);
    setFrame(null);
    const xapi = apiRef.current;
    if (!xapi) return;
    const els = xapi.getSceneElementsIncludingDeleted();
    const img = imageOf(els, ed.blockId);
    if (!img) return;
    xapi.updateScene({
      elements: els.map((e) => (e === img && e.opacity === 0 ? newElementWith(img, { opacity: hiddenOpacity.current }) : e)),
      ...(reselect ? { appState: { selectedElementIds: { [img.id]: true } } } : {}),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  /** Enter layout edit mode for a block: tidy its layout first (§4.3), hide its image under the overlay. */
  const enterEdit = useCallback(
    (blockId: string, start: EditStart | null) => {
      const xapi = apiRef.current;
      const b = blocksRef.current.find((x) => x.id === blockId);
      if (!xapi || !b) return;
      const els = xapi.getSceneElementsIncludingDeleted();
      const img = imageOf(els, blockId);
      if (!img) return;
      const pruned = prunedLayout(b);
      hiddenOpacity.current = img.opacity || 100;
      // The tidy-up goes through the image like any layout change, so block and image agree; it is not an undo step.
      const patch = pruned ? { opacity: 0, customData: withLayout(img.customData, pruned.layout) } : { opacity: 0 };
      editRef.current = { blockId, start };
      setEdit(editRef.current);
      setNotice(null);
      setFrame(frameOf(img, xapi.getAppState(), b));
      xapi.updateScene({ elements: els.map((e) => (e === img ? newElementWith(img, patch) : e)), appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
    },
    [frameOf],
  );

  /** Store a block's layout on its image; `IMMEDIATELY` makes it one undo step (design §5.6). */
  const writeLayout = useCallback((blockId: string, layout: BlockLayout | undefined) => {
    const xapi = apiRef.current;
    if (!xapi) return;
    const els = xapi.getSceneElementsIncludingDeleted();
    const img = imageOf(els, blockId);
    if (!img) return;
    xapi.updateScene({ elements: els.map((e) => (e === img ? newElementWith(img, { customData: withLayout(img.customData, layout) }) : e)), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }, []);

  const resetLayout = useCallback(
    (blockId: string) => {
      if (blocksRef.current.find((b) => b.id === blockId)?.layout) writeLayout(blockId, undefined);
    },
    [writeLayout],
  );

  /** Palette `레이아웃 편집`: enter for the selected block, or say why not. */
  const tryEdit = useCallback(async () => {
    if (editRef.current) return exitEdit(true);
    const xapi = apiRef.current;
    const id = selRef.current;
    const b = id ? blocksRef.current.find((x) => x.id === id) : undefined;
    if (!xapi || !id || !b) return;
    const img = imageOf(xapi.getSceneElements(), id);
    const why = (img && imageReason(img)) ?? null;
    const s = why ? null : await openLayoutSession(b);
    const reason = why ?? (s && 'reason' in s ? s.reason : null);
    if (reason) return setNotice({ blockId: id, text: reason });
    if (selRef.current === id) enterEdit(id, null);
  }, [enterEdit, exitEdit]);

  /** Palette and bar `자유 도형으로 바꾸기`: replace the selected graph block with plain shapes, as one undo step (#38). */
  const toFreeform = useCallback(async () => {
    if (editRef.current) exitEdit(false);
    const xapi = apiRef.current;
    const id = selRef.current;
    const b = id ? blocksRef.current.find((x) => x.id === id) : undefined;
    if (!xapi || !id || !b) return;
    const first = imageOf(xapi.getSceneElements(), id);
    const why = first && imageReason(first, 'freeform');
    if (why) return setNotice({ blockId: id, text: why });
    const s = await openLayoutSession(b, 'freeform');
    if ('reason' in s) return setNotice({ blockId: id, text: s.reason });
    const els = xapi.getSceneElementsIncludingDeleted();
    const img = imageOf(els, id);
    if (!img) return;
    // Checked again: the image may have been rotated or cropped while the session was opening.
    const late = imageReason(img, 'freeform');
    if (late) return setNotice({ blockId: id, text: late });
    const { scene } = s.compose(b.layout);
    const { skeletons, bindings } = sceneToFreeform(scene, { x: img.x, y: img.y, width: img.width, height: img.height }, () => Math.random().toString(36).slice(2, 12));
    const converted = convertToExcalidrawElements(skeletons as never, { regenerateIds: false }) as unknown as ExcalidrawElement[];
    // A block inside a frame leaves its shapes in that frame.
    const frameId = frameFor(img, els);
    const inFrame = frameId ? converted.map((e) => ({ ...e, frameId })) : converted;
    const made = bindArrows(inFrame, bindings);
    const fresh = made.filter((e) => !(e as { containerId?: string }).containerId).map((e) => e.id);
    xapi.updateScene({
      // The shapes take the image's place in the stacking order (inside its frame, if any).
      elements: els.flatMap((e) => (e === img ? [newElementWith(img, { isDeleted: true }), ...made] : [e])),
      appState: { selectedElementIds: Object.fromEntries(fresh.map((x) => [x, true])) },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    focusCanvas(wrap.current);
  }, [exitEdit]);

  // Show the requested block once its image is on the canvas (a new block's image arrives after its picture is drawn).
  const tryFocus = useCallback(() => {
    const f = focusRef.current;
    const xapi = apiRef.current;
    if (!f || !xapi || focusDone.current === f.n) return;
    const el = xapi.getSceneElements().find((e) => (f.frameId ? e.id === f.frameId && !e.isDeleted : blockIdOf(e as unknown as SceneEl) === f.blockId));
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
      for (const b of blocks) seenLayouts.current.set(b.id, layoutSig(b.layout));
      const free = restoreElements(canvas.elements as ExcalidrawElement[], null);
      sigRef.current = freeSignature(free);
      const placed = placeBlocks(blocks, pics, liveRects(free));
      const images = restoreElements(
        placed.map((b, i) => blockImageSkeleton(b, pics[i].fileId, newElId(b.id)) as unknown as ExcalidrawElement),
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
      setResets(new Set(pics.flatMap((p, i) => (p.layoutReset ? [blocks[i]!.id] : []))));
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
        // The image carries the block's layout, so undo of a layout edit comes back through it (design §5.6).
        const want = blocks[i]!.layout;
        const layoutStale = layoutSig(img.customData?.layout as never) !== layoutSig(want);
        if (baseFileId(img.fileId ?? '') === p.fileId && !layoutStale) return el;
        changed = true;
        const { layout: _old, ...rest } = img.customData ?? {};
        const customData = want ? { ...rest, layout: want } : rest;
        seenLayouts.current.set(bid, layoutSig(want));
        if (baseFileId(img.fileId ?? '') === p.fileId) return newElementWith(img, { customData });
        // Keep the zoom the block was shown at, so a bigger diagram takes more room instead of shrinking.
        const old = sizes.current.get(baseFileId(img.fileId ?? ''));
        const scale = old && old.width > 0 ? img.width / old.width : 1;
        // When only the layout changed, its origin stays where it was on screen, so moving a node left does not push
        // the whole block right. Code edits, resets and error pictures leave the block where it is.
        const at = shiftForOrigin(img, old, p);
        return newElementWith(img, { fileId: p.fileId as FileId, width: p.width * scale, height: p.height * scale, ...at, customData });
      });
      const missing = blocks.filter((b) => !shown.has(b.id));
      if (missing.length) {
        changed = true;
        const mpics = missing.map((b) => pics[index.get(b.id)!]!);
        const skeletons = placeBlocks(missing, mpics, liveRects(next)).map(
          (b, i) => blockImageSkeleton(b, mpics[i]!.fileId, newElId(b.id)) as unknown as ExcalidrawElement,
        );
        next.push(...restoreElements(skeletons, null));
      }
      if (changed) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
      // A comment edit keeps the same picture (no scene change) but gives it a new anchor: the overlay needs it.
      else refreshFrame();
      tryFocus();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, drawn, draw, tryFocus, refreshFrame]);

  // Block pictures follow the zoom and screen scale: each image shows the variant of its picture that is
  // sharp at the size it covers on screen (resolution.ts). Checked shortly after the view or the images change.
  const sharpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sharpenView = useRef('');
  const sharpen = useCallback(() => {
    sharpenTimer.current = null;
    const xapi = apiRef.current;
    if (!xapi) return;
    const zoom = xapi.getAppState().zoom.value;
    const dpr = window.devicePixelRatio || 1;
    const files = xapi.getFiles();
    const add = new Map<string, BinaryFileData>();
    const swaps = new Map<string, string>();
    for (const el of xapi.getSceneElements()) {
      if (el.type !== 'image' || blockIdOf(el as unknown as SceneEl) === null) continue;
      const img = el as ExcalidrawImageElement;
      const p = sizes.current.get(baseFileId(img.fileId ?? ''));
      if (!p) continue;
      const k = pictureScale(Math.max(Math.abs(img.width) / p.width, Math.abs(img.height) / p.height) * zoom * dpr, p.width, p.height);
      const id = variantId(p.fileId, k);
      if (id === img.fileId) continue;
      if (!files[id] && !add.has(id)) add.set(id, fileData(p, k));
      swaps.set(img.id, id);
    }
    if (!swaps.size) return;
    // Decode the new variants before showing them, so a block does not flash its loading placeholder.
    void Promise.all(
      [...add.values()].map((f) => {
        const im = new Image();
        im.src = f.dataURL;
        return im.decode().catch(() => undefined);
      }),
    ).then(() => {
      if (apiRef.current !== xapi) return;
      if (add.size) xapi.addFiles([...add.values()]);
      let changed = false;
      const els = xapi.getSceneElementsIncludingDeleted().map((el) => {
        const id = swaps.get(el.id);
        // Skip an image whose picture changed meanwhile (a code edit); the next check handles it.
        const img = el as ExcalidrawImageElement;
        if (!id || el.isDeleted || baseFileId(img.fileId ?? '') !== baseFileId(id)) return el;
        changed = true;
        return newElementWith(img, { fileId: id as FileId });
      });
      if (changed) xapi.updateScene({ elements: els, captureUpdate: CaptureUpdateAction.NEVER });
    });
  }, []);
  const scheduleSharpen = useCallback(() => {
    if (sharpenTimer.current) clearTimeout(sharpenTimer.current);
    sharpenTimer.current = setTimeout(sharpen, 120);
  }, [sharpen]);
  useEffect(() => {
    window.addEventListener('resize', scheduleSharpen);
    return () => {
      window.removeEventListener('resize', scheduleSharpen);
      if (sharpenTimer.current) clearTimeout(sharpenTimer.current);
    };
  }, [scheduleSharpen]);

  const handleChange = useCallback((sceneEls: readonly ExcalidrawElement[], appState: AppState) => {
    const sel = sceneEls.filter((e) => appState.selectedElementIds[e.id] && !e.isDeleted);
    const view = `${appState.zoom.value}|${sceneEls.map((e) => (e.type === 'image' && !e.isDeleted && blockIdOf(e as unknown as SceneEl) !== null ? `${e.id}:${(e as ExcalidrawImageElement).fileId}:${Math.round(e.width)}` : '')).join('')}`;
    if (view !== sharpenView.current) {
      sharpenView.current = view;
      scheduleSharpen();
    }
    setBlockSelected(sel.length > 0 && sel.every((e) => blockIdOf(e as unknown as SceneEl) !== null));
    setSelBlock(sel.length === 1 ? blockIdOf(sel[0] as unknown as SceneEl) : null);
    const ed = editRef.current;
    if (ed) {
      // While editing, the overlay follows zoom, pan and the block image; a deleted image (undo, another tab) ends it.
      const img = imageOf(sceneEls, ed.blockId);
      const b = blocksRef.current.find((x) => x.id === ed.blockId);
      if (!img || !b) exitEdit(false);
      else {
        const f = frameOf(img, appState, b);
        setFrame((old) => (sameFrame(old, f) ? old : f));
      }
    }
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
    // A deleted image's layout is not "seen" any more: if undo brings the image back, the block takes its layout again.
    for (const id of split.deleted) seenLayouts.current.delete(id);
    let next = applyScene(cur, split, layoutsFromImages(split.layouts, seenLayouts.current));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Layout edit mode (design §5.2): pressing a node of the one selected block enters it and goes on as a drag; any
    // other press on the canvas while editing leaves it (and does what it would do anyway).
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest('[data-layout-edit]'))) return;
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (editRef.current) return exitEdit(false);
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const st = api.getAppState();
      if (st.activeTool.type !== 'selection') return;
      const sel = api.getSceneElements().filter((s) => st.selectedElementIds[s.id]);
      const img = sel.length === 1 ? (sel[0] as ExcalidrawImageElement) : null;
      const bid = img && blockIdOf(img as unknown as SceneEl);
      const b = bid ? blocksRef.current.find((x) => x.id === bid) : undefined;
      if (!img || !bid || !b) return;
      const { x, y } = viewportCoordsToSceneCoords(e, st);
      if (x < img.x || x > img.x + img.width || y < img.y || y > img.y + img.height) return;
      // No session (still being made, or a block that cannot be laid out: sequence, ERD, an error): this press moves
      // the block, like before, and says nothing; the palette's try is where the reason shows.
      const ls = ready(sessRef.current, b);
      const f = ls && frameOf(img, st, b);
      if (!ls || !f) return;
      const scene = ls.compose(b.layout).scene;
      const r = el.getBoundingClientRect();
      const hit = hitHandle(layoutHandles(scene.handles, scene.origin), toLayout(f, { x: e.clientX - r.left, y: e.clientY - r.top }));
      if (!hit) return;
      // A node was hit, but a locked or turned image cannot be edited: say why instead of entering.
      const why = imageReason(img);
      if (why) return setNotice({ blockId: bid, text: why });
      e.stopPropagation();
      e.preventDefault();
      enterEdit(bid, { id: hit.id, clientX: e.clientX, clientY: e.clientY, shift: false, n: ++startN.current });
    };
    // A press outside the canvas (sidebar, top bar, document) leaves edit mode too; a modal (the palette) does not.
    const onOutside = (e: PointerEvent) => {
      if (!editRef.current || !(e.target instanceof Node) || el.contains(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      exitEdit(true);
    };
    el.addEventListener('dblclick', onDbl, true);
    el.addEventListener('keydown', onKey, true);
    el.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerdown', onOutside, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      el.removeEventListener('dblclick', onDbl, true);
      el.removeEventListener('keydown', onKey, true);
      el.removeEventListener('pointerdown', onDown, true);
    };
  }, [api, enterEdit, exitEdit, frameOf]);

  // The session for the selected (or edited) block, opened ahead and again whenever its code changes.
  const sessId = edit?.blockId ?? selBlock;
  const sessBlock = sessId ? blocks.find((b) => b.id === sessId) : undefined;
  const sessFor = sessBlock ? sessionKey(sessBlock) : null;
  useEffect(() => {
    const b = sessBlock;
    if (!b) return setSess(null);
    let live = true;
    void openLayoutSession(b).then((s) => live && setSess({ blockId: b.id, key: sessionKey(b), s }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessId, sessFor]);

  // Edit mode ends when its block goes away or its code can no longer be laid out by hand (an error, another kind).
  // While that block's code panel is open an error is judged later: typing passes through broken code, so the last
  // picture stays (not editable) and the verdict comes when the panel closes.
  const editBlock = edit ? blocks.find((b) => b.id === edit.blockId) : undefined;
  const editSess = ready(sess, editBlock);
  useEffect(() => {
    if (!edit) return;
    if (!editBlock) return exitEdit(false);
    if (sess && sess.blockId === edit.blockId && sess.key === sessionKey(editBlock) && 'reason' in sess.s) {
      if (editing === edit.blockId) return;
      setNotice({ blockId: edit.blockId, text: sess.s.reason });
      exitEdit(true);
    }
  }, [edit, editBlock, sess, exitEdit, editing]);
  // While the code changes, the new session and picture come a moment later; the overlay keeps the last picture it
  // placed (not editable) instead of leaving the hidden block blank.
  const lastShown = useRef<{ blockId: string; sess: LayoutSession; frame: LayoutFrame } | null>(null);
  if (!edit) lastShown.current = null;
  else if (editSess && frame) lastShown.current = { blockId: edit.blockId, sess: editSess, frame };
  const kept = edit && !(editSess && frame) && lastShown.current?.blockId === edit.blockId ? lastShown.current : null;
  const overlaySess = editSess && frame ? editSess : kept?.sess;
  const overlayFrame = editSess && frame ? frame : kept?.frame;
  // A fresh session (or the first one) can place a picture whose layout was left out; place the overlay again.
  useEffect(refreshFrame, [api, editSess, refreshFrame]);
  // A notice belongs to one try; it goes when another block is selected, or after a while.
  useEffect(() => {
    if (!notice) return;
    if (selBlock && selBlock !== notice.blockId) return setNotice(null);
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice, selBlock]);

  // Wheel over the overlay goes to Excalidraw's canvas: it zooms at the pointer (tracked on document) and pans.
  const forwardWheel = useCallback((e: WheelEvent) => {
    const c = wrap.current?.querySelector('canvas.interactive') ?? wrap.current?.querySelector('.excalidraw canvas');
    c?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);

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
    // Excalidraw inverts the white background itself in dark mode; a transparent export skips the background.
    const opts = (o: ExportOptions) => ({ exportBackground: !o.transparent, viewBackgroundColor: '#ffffff', exportWithDarkMode: o.dark });
    handle.current = {
      scope: () => {
        const s = scope();
        return { selected: s.selected, count: s.elements.length };
      },
      svg: async (o = DEFAULT_EXPORT) => {
        const { elements } = scope();
        if (!elements.length) return null;
        const el = await exportToSvg({ elements, appState: opts(o), files: api.getFiles(), exportPadding: 16 });
        el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return { svg: new XMLSerializer().serializeToString(el), width: parseFloat(el.getAttribute('width') ?? '0'), height: parseFloat(el.getAttribute('height') ?? '0') };
      },
      png: async (o = DEFAULT_EXPORT) => {
        const { elements } = scope();
        if (!elements.length) return null;
        return await exportToBlob({ elements, appState: opts(o), files: api.getFiles(), mimeType: 'image/png', exportPadding: 16, getDimensions: (w: number, h: number) => ({ width: w * o.scale, height: h * o.scale, scale: o.scale }) });
      },
      key: ({ key, code, ctrl, meta, shift, alt }) => {
        const target = wrap.current?.querySelector<HTMLElement>('.excalidraw');
        if (!target) return;
        target.focus({ preventScroll: true });
        target.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: !!ctrl, metaKey: !!meta, shiftKey: !!shift, altKey: !!alt, bubbles: true, cancelable: true }));
      },
      layout: {
        state: () => {
          const id = editRef.current?.blockId ?? selRef.current;
          const b = id ? blocksRef.current.find((x) => x.id === id) : undefined;
          return { block: !!b, graph: isGraphType(b?.type), editing: !!editRef.current, moved: !!b?.layout };
        },
        edit: () => void tryEdit(),
        freeform: () => void toFreeform(),
        reset: () => {
          const id = editRef.current?.blockId ?? selRef.current;
          if (id) resetLayout(id);
        },
      },
    };
    return () => {
      handle.current = null;
    };
  }, [api, handle, tryEdit, resetLayout, toFreeform]);

  const block = editing ? blocks.find((b) => b.id === editing) : undefined;
  useEffect(() => {
    if (editing && !block) setEditing(null);
  }, [editing, block]);
  // Closing the code panel (or opening another block's) tidies the layout of the block it showed (design §4.3).
  const prevEditing = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevEditing.current;
    prevEditing.current = editing;
    if (!prev || prev === editing) return;
    const b = blocksRef.current.find((x) => x.id === prev);
    const pruned = b && prunedLayout(b);
    if (pruned) onChangeRef.current({ blocks: blocksRef.current.map((x) => (x.id === prev ? pruned : x)) });
  }, [editing]);
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
      <CanvasInsertMenu
        api={api}
        wrap={wrap}
        onBlock={(b) => {
          onChangeRef.current({ blocks: [...blocksRef.current, b] });
          setEditing(b.id);
        }}
      />
      {edit && editBlock && overlaySess && overlayFrame && wrap.current && (
        <LayoutEditOverlay
          layout={editBlock.layout}
          session={overlaySess}
          frame={overlayFrame}
          stale={!!kept}
          dark={dark}
          wrap={wrap.current}
          start={edit.start}
          onCommit={(l) => writeLayout(edit.blockId, l)}
          onExit={() => exitEdit(true)}
          onOpenCode={() => setEditing(edit.blockId)}
          onWheel={forwardWheel}
        />
      )}
      <LayoutBar
        editing={!!edit}
        broken={!!(edit && sess && sess.blockId === edit.blockId && 'reason' in sess.s)}
        moved={!!(editBlock ?? (selBlock ? blocks.find((b) => b.id === selBlock) : undefined))?.layout}
        notice={!edit && notice && notice.blockId === selBlock ? notice.text : null}
        convertible={!edit && !!selBlock && isGraphType(blocks.find((b) => b.id === selBlock)?.type)}
        onFreeform={() => void toFreeform()}
        onReset={() => {
          const id = edit?.blockId ?? selBlock;
          if (id) resetLayout(id);
          // The button took focus; Ctrl+Z right after must still reach Excalidraw.
          focusCanvas(wrap.current);
        }}
        onDone={() => {
          exitEdit(true);
          focusCanvas(wrap.current);
        }}
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
          {resets.has(block.id) && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              코드가 많이 바뀌어서 자동 배치로 그려요. 패널을 닫으면 옮긴 배치가 지워져요
            </p>
          )}
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

/** Bottom-centre bar for layout edit mode (design §5.5): what the mode does, or that a block has a moved layout, or why it cannot be edited. */
function LayoutBar({ editing, broken, moved, notice, convertible, onReset, onDone, onFreeform }: { editing: boolean; broken: boolean; moved: boolean; notice: string | null; convertible: boolean; onReset: () => void; onDone: () => void; onFreeform: () => void }) {
  if (!editing && !notice && !moved && !convertible) return null;
  return (
    <div
      role="status"
      aria-label="레이아웃 안내"
      className="absolute bottom-16 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {(editing || notice || moved) && <span>{editing ? (broken ? '코드 오류를 고치면 옮길 수 있어요' : '노드를 끌어 옮겨요 · Alt를 누르면 맞춤이 꺼져요') : (notice ?? '직접 옮긴 배치예요')}</span>}
      {(editing || (!notice && moved)) && (
        <button type="button" className={BAR_BTN} style={{ borderColor: 'var(--border)' }} disabled={!moved} onClick={onReset}>
          레이아웃 초기화
        </button>
      )}
      {convertible && !notice && (
        <button type="button" className={BAR_BTN} style={{ borderColor: 'var(--border)' }} onClick={onFreeform}>
          자유 도형으로 바꾸기
        </button>
      )}
      {editing && (
        <button type="button" className={BAR_BTN} style={{ borderColor: 'var(--border)' }} onClick={onDone}>
          완료
        </button>
      )}
    </div>
  );
}
