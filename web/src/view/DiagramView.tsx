// Renders one draw.io page with the vendored diagrams.net Graph, with pan/zoom/fit,
// live model swaps that keep the view, and coloured flashes for changed cells.
//
// For overlays (T5 cursors): pass `onApi` to get a DiagramApi and render overlay
// elements as `children`; they sit in an absolutely positioned layer over the
// diagram whose origin matches the rects DiagramApi returns.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadDrawio, type Drawio } from './drawio';
import {
  diffSnapshots,
  fitTransform,
  graphToScreen,
  screenToGraph,
  unionRects,
  zoomAt,
  type CellSnap,
  type Rect,
  type ViewTransform,
} from './diff';

export type { Rect } from './diff';

export interface DiagramApi {
  /** Screen rect of a cell, in px relative to the diagram container. Null if not on this page. */
  getCellRect(id: string): Rect | null;
  /** Union of several cells' screen rects (missing ids are skipped). */
  getCellsRect(ids: string[]): Rect | null;
  /** Diagram (model) coordinates → container px, e.g. for a change bbox. */
  graphToScreen(r: Rect): Rect;
  /** Container px → diagram (model) coordinates. */
  screenToGraph(r: Rect): Rect;
  /** Pan (keeping the zoom) so this diagram-coordinate rect sits in the middle, with a short glide. */
  centerOn(r: Rect): void;
  /** Called after every pan, zoom, resize or model update. Returns an unsubscribe. */
  onViewChange(cb: () => void): () => void;
  /** `resetKey` of the page currently drawn, or null before the first page. Rects belong to this page. */
  shownKey(): string | null;
  /** The container element the rects are relative to. */
  readonly container: HTMLElement;
  /** Pan (zoom unchanged) to centre a container-px rect, unless it is already fully in view. */
  reveal(r: Rect): void;
}

type FlashKind = 'added' | 'changed' | 'removed';
interface Flash {
  kind: FlashKind;
  rect: Rect; // graph coords
  start: number;
  el: HTMLDivElement;
}

const FLASH_MS: Record<FlashKind, number> = { added: 1600, changed: 1600, removed: 2000 };
const FLASH_STYLE: Record<FlashKind, string> = {
  added: 'border:2px solid #16a34a;background:rgba(34,197,94,0.18);',
  changed: 'border:2px solid #d97706;background:rgba(245,158,11,0.18);',
  removed: 'border:2px dashed #dc2626;background:rgba(239,68,68,0.22);',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Graph = any;

function viewOf(graph: Graph): ViewTransform {
  const v = graph.view;
  return { scale: v.scale, tx: v.translate.x, ty: v.translate.y };
}

function setView(graph: Graph, t: ViewTransform) {
  graph.view.scaleAndTranslate(t.scale, t.tx, t.ty);
}

function snapshot(graph: Graph): Map<string, CellSnap> {
  const out = new Map<string, CellSnap>();
  const cells = graph.model.cells ?? {};
  for (const id of Object.keys(cells)) {
    const c = cells[id];
    if (!c || (!c.vertex && !c.edge)) continue;
    const g = c.geometry;
    const pts = g?.points ? g.points.map((p: any) => `${p.x},${p.y}`).join(' ') : '';
    const value = c.value == null ? '' : typeof c.value === 'string' ? c.value : (c.value.outerHTML ?? String(c.value));
    out.set(id, {
      id,
      parent: c.parent?.id ?? '',
      value,
      style: c.style ?? '',
      geo: g ? `${g.x},${g.y},${g.width},${g.height},${g.relative ? 1 : 0},${pts}` : '',
      source: c.source?.id ?? '',
      target: c.target?.id ?? '',
    });
  }
  return out;
}

/** Graph-space rects of all visible cells, captured before a model swap for removed ghosts. */
function graphRects(graph: Graph): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const v = viewOf(graph);
  const cells = graph.model.cells ?? {};
  for (const id of Object.keys(cells)) {
    const st = graph.view.getState(cells[id]);
    if (st && (st.width > 0 || st.height > 0)) out.set(id, screenToGraph({ x: st.x, y: st.y, width: st.width, height: st.height }, v));
  }
  return out;
}

function modelBounds(graph: Graph): Rect | null {
  const b = graph.getGraphBounds();
  if (!b || (b.width === 0 && b.height === 0)) return null;
  return screenToGraph({ x: b.x, y: b.y, width: b.width, height: b.height }, viewOf(graph));
}

export interface DiagramViewProps {
  /** `<mxGraphModel>` XML of the page to show, or null while loading. */
  xml: string | null;
  /** When this changes the view fits to screen (e.g. file path + page id). */
  resetKey: string;
  /** Flashes show only while this stays the same (e.g. file id + page id). */
  flashKey: string;
  onApi?: (api: DiagramApi | null) => void;
  children?: ReactNode;
}

export function DiagramView({ xml, resetKey, flashKey, onApi, children }: DiagramViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const graphElRef = useRef<HTMLDivElement>(null);
  const flashLayerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph>(null);
  const drawioRef = useRef<Drawio | null>(null);
  const listeners = useRef(new Set<() => void>());
  const flashes = useRef<Flash[]>([]);
  const raf = useRef(0);
  const shown = useRef<{ resetKey: string; flashKey: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const onApiRef = useRef(onApi);
  onApiRef.current = onApi;

  const notify = () => {
    const g = graphRef.current;
    if (g) setZoomPct(Math.round(g.view.scale * 100));
    positionFlashes();
    for (const cb of listeners.current) cb();
  };

  function positionFlashes() {
    const g = graphRef.current;
    if (!g) return;
    const v = viewOf(g);
    for (const f of flashes.current) {
      const r = graphToScreen(f.rect, v);
      f.el.style.transform = `translate(${r.x - 3}px, ${r.y - 3}px)`;
      f.el.style.width = `${r.width + 6}px`;
      f.el.style.height = `${r.height + 6}px`;
    }
  }

  function animateFlashes() {
    const now = performance.now();
    flashes.current = flashes.current.filter((f) => {
      const t = (now - f.start) / FLASH_MS[f.kind];
      if (t >= 1) {
        f.el.remove();
        return false;
      }
      f.el.style.opacity = String(t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85);
      return true;
    });
    raf.current = flashes.current.length ? requestAnimationFrame(animateFlashes) : 0;
  }

  function addFlash(kind: FlashKind, rect: Rect) {
    const layer = flashLayerRef.current;
    if (!layer) return;
    const el = document.createElement('div');
    el.dataset.flash = kind;
    el.style.cssText = `position:absolute;left:0;top:0;border-radius:4px;pointer-events:none;${FLASH_STYLE[kind]}`;
    layer.appendChild(el);
    flashes.current.push({ kind, rect, start: performance.now(), el });
  }

  function clearFlashes() {
    for (const f of flashes.current) f.el.remove();
    flashes.current = [];
  }

  // Create the graph once.
  useEffect(() => {
    let disposed = false;
    loadDrawio()
      .then((d) => {
        if (disposed || !graphElRef.current) return;
        drawioRef.current = d;
        const graph = new d.Graph(graphElRef.current);
        graph.setEnabled(false);
        graph.setTooltips(false);
        graph.container.style.overflow = 'hidden';
        graph.container.style.cursor = 'grab';
        const onView = () => notify();
        graph.view.addListener(d.mxEvent.SCALE, onView);
        graph.view.addListener(d.mxEvent.TRANSLATE, onView);
        graph.view.addListener(d.mxEvent.SCALE_AND_TRANSLATE, onView);
        graphRef.current = graph;
        setReady(true);
      })
      .catch(() => !disposed && setError('다이어그램 도구를 불러오지 못했어요.'));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf.current);
      clearFlashes();
      graphRef.current?.destroy();
      graphRef.current = null;
      shown.current = null;
      setReady(false);
    };
  }, []);

  // Expose the API.
  useEffect(() => {
    if (!ready || !wrapRef.current) return;
    const container = wrapRef.current;
    const cellRect = (id: string): Rect | null => {
      const g = graphRef.current;
      const cell = g?.model.getCell(id);
      const st = cell && g.view.getState(cell);
      return st ? { x: st.x, y: st.y, width: st.width, height: st.height } : null;
    };
    const api: DiagramApi = {
      container,
      getCellRect: cellRect,
      getCellsRect: (ids) => unionRects(ids.map(cellRect).filter((r): r is Rect => r !== null)),
      graphToScreen: (r) => (graphRef.current ? graphToScreen(r, viewOf(graphRef.current)) : r),
      screenToGraph: (r) => (graphRef.current ? screenToGraph(r, viewOf(graphRef.current)) : r),
      centerOn: (r) => glideTo(r),
      shownKey: () => shown.current?.resetKey ?? null,
      onViewChange(cb) {
        listeners.current.add(cb);
        return () => listeners.current.delete(cb);
      },
      reveal(r) {
        const g = graphRef.current;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (!g || (r.x >= 0 && r.y >= 0 && r.x + r.width <= w && r.y + r.height <= h)) return;
        const v = viewOf(g);
        setView(g, { ...v, tx: v.tx + (w / 2 - (r.x + r.width / 2)) / v.scale, ty: v.ty + (h / 2 - (r.y + r.height / 2)) / v.scale });
      },
    };
    onApiRef.current?.(api);
    return () => onApiRef.current?.(null);
  }, [ready]);

  // Swap in a new model when the XML changes.
  useEffect(() => {
    const graph = graphRef.current;
    const d = drawioRef.current;
    if (!ready || !graph || !d || xml == null) return;
    const prev = shown.current;
    const sameView = prev?.resetKey === resetKey;
    const sameFlash = sameView && prev?.flashKey === flashKey;
    const before = sameFlash ? snapshot(graph) : null;
    const beforeRects = sameFlash ? graphRects(graph) : null;
    const view = viewOf(graph);

    let doc;
    try {
      doc = d.mxUtils.parseXml(xml);
    } catch {
      setError('이 페이지를 읽지 못했어요.');
      return;
    }
    const root = doc.documentElement;
    if (!root || root.nodeName !== 'mxGraphModel') {
      setError('이 페이지를 읽지 못했어요.');
      return;
    }
    setError(null);
    if (!sameFlash) clearFlashes();
    new d.mxCodec(doc).decode(root, graph.getModel());
    graphElRef.current!.style.background = root.getAttribute('background') && root.getAttribute('background') !== 'none' ? root.getAttribute('background') : '#ffffff';
    shown.current = { resetKey, flashKey };

    if (sameView) setView(graph, view);
    else fit();

    if (before && beforeRects) {
      const diff = diffSnapshots(before, snapshot(graph));
      const afterRects = graphRects(graph);
      for (const id of diff.removed) {
        const r = beforeRects.get(id);
        if (r) addFlash('removed', r);
      }
      for (const id of diff.added) {
        const r = afterRects.get(id);
        if (r) addFlash('added', r);
      }
      for (const id of diff.changed) {
        const r = afterRects.get(id);
        if (r) addFlash('changed', r);
      }
      positionFlashes();
      if (flashes.current.length && !raf.current) raf.current = requestAnimationFrame(animateFlashes);
    }
    notify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, xml, resetKey, flashKey]);

  function fit() {
    const g = graphRef.current;
    const el = wrapRef.current;
    if (!g || !el) return;
    const b = modelBounds(g);
    if (!b) return setView(g, { scale: 1, tx: 0, ty: 0 });
    setView(g, fitTransform(b, el.clientWidth, el.clientHeight));
  }

  const glide = useRef(0);
  function glideTo(r: Rect) {
    const g = graphRef.current;
    const el = wrapRef.current;
    if (!g || !el) return;
    cancelAnimationFrame(glide.current);
    const from = viewOf(g);
    const to = {
      scale: from.scale,
      tx: el.clientWidth / (2 * from.scale) - (r.x + r.width / 2),
      ty: el.clientHeight / (2 * from.scale) - (r.y + r.height / 2),
    };
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / 350);
      const e = 1 - (1 - t) ** 3;
      if (!graphRef.current) return;
      setView(graphRef.current, { scale: to.scale, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e });
      if (t < 1) glide.current = requestAnimationFrame(tick);
    };
    glide.current = requestAnimationFrame(tick);
  }

  function zoomBy(factor: number, px?: number, py?: number) {
    const g = graphRef.current;
    const el = wrapRef.current;
    if (!g || !el) return;
    setView(g, zoomAt(viewOf(g), factor, px ?? el.clientWidth / 2, py ?? el.clientHeight / 2));
  }

  function zoomTo100() {
    const g = graphRef.current;
    const el = wrapRef.current;
    if (!g || !el) return;
    zoomBy(1 / g.view.scale);
  }

  // Pan with drag or wheel, zoom with Ctrl/⌘+wheel or pinch (like Figma).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !ready) return;
    let drag: { x: number; y: number; id: number } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const skip = (e: Event) => e.target instanceof Element && e.target.closest('[data-no-pan]') !== null;
    const onWheel = (e: WheelEvent) => {
      const g = graphRef.current;
      if (!g || skip(e)) return;
      e.preventDefault();
      cancelAnimationFrame(glide.current);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) {
        const [px, py] = local(e);
        zoomBy(Math.exp(-e.deltaY * unit * 0.0025), px, py);
      } else {
        const v = viewOf(g);
        setView(g, { ...v, tx: v.tx - (e.deltaX * unit) / v.scale, ty: v.ty - (e.deltaY * unit) / v.scale });
      }
    };
    const onDown = (e: PointerEvent) => {
      if ((e.button !== 0 && e.button !== 1) || skip(e)) return;
      cancelAnimationFrame(glide.current);
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      if (graphElRef.current) graphElRef.current.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      const g = graphRef.current;
      if (!drag || !g || e.pointerId !== drag.id) return;
      const v = viewOf(g);
      setView(g, { ...v, tx: v.tx + (e.clientX - drag.x) / v.scale, ty: v.ty + (e.clientY - drag.y) / v.scale });
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      if (graphElRef.current) graphElRef.current.style.cursor = 'grab';
    };
    const ro = new ResizeObserver(() => notify());
    ro.observe(el);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const btn =
    'h-8 min-w-8 rounded-md px-2 text-sm text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-40';

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none select-none overflow-hidden bg-neutral-100" data-testid="diagram">
      <div ref={graphElRef} className="absolute inset-0" />
      <div ref={flashLayerRef} className="pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-0">{children}</div>
      {(!ready || xml == null) && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
          {ready ? '페이지를 불러오고 있어요.' : '다이어그램 도구를 불러오고 있어요.'}
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600" role="alert">
          {error}
        </div>
      )}
      <div
        className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-1 shadow-sm"
        data-no-pan
      >
        <button type="button" className={btn} onClick={() => zoomBy(1 / 1.25)} disabled={!ready} aria-label="축소">
          −
        </button>
        <button type="button" className={`${btn} w-14 tabular-nums`} onClick={zoomTo100} disabled={!ready} title="100%로 보기">
          {zoomPct}%
        </button>
        <button type="button" className={btn} onClick={() => zoomBy(1.25)} disabled={!ready} aria-label="확대">
          +
        </button>
        <button type="button" className={btn} onClick={fit} disabled={!ready}>
          맞춤
        </button>
      </div>
    </div>
  );
}
