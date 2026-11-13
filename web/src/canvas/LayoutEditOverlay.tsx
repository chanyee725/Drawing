// Layout edit mode overlay (design §5.3, §5.4): the block's picture drawn live over its (hidden) canvas image, with
// selection, marquee, drag with snapping and guides, and arrow-key nudges. Commits once per gesture.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockLayout, Scene } from '../../../shared/render/index.ts';
import type { LayoutSession } from './layoutSession';
import { layoutSig } from './sync';
import {
  SNAP_PX,
  boundsOf,
  hitHandle,
  layoutHandles,
  leavesOf,
  marquee,
  movedLayout,
  nudgeFor,
  snapMove,
  snapTargets,
  toLayout,
  toScreen,
  type LayoutFrame,
  type LayoutHandle,
  type Line,
} from './layoutEdit';

/** A press that entered edit mode on a node: the overlay continues it as a drag. */
export type EditStart = { id: string; clientX: number; clientY: number; shift: boolean; n: number };

type Props = {
  layout: BlockLayout | undefined;
  session: LayoutSession;
  frame: LayoutFrame;
  dark: boolean;
  /** Wrapper element, to turn client coordinates into frame coordinates. */
  wrap: HTMLElement;
  start: EditStart | null;
  /** The picture is the one from before a code edit, kept until the new one is placed: shown, but not editable. */
  stale?: boolean;
  onCommit: (layout: BlockLayout) => void;
  onExit: () => void;
  onOpenCode: () => void;
  /** Wheel over the overlay goes to the canvas, so zoom and pan keep working. */
  onWheel: (e: WheelEvent) => void;
};

// Pixels a press must travel before it counts as a drag (a smaller move is a click).
const DRAG_PX = 3;
// The overlay sits outside Excalidraw's dark filter, so it draws with the dark palette itself; the block image under
// the filter is pre-corrected to look the same (shared/render/darkFilter.ts), so entering edit mode does not flash.
const paletteOf = (dark: boolean) => (dark ? 'dark' : 'light') as 'dark' | 'light';
const ACCENT = '#3b82f6';
const GUIDE = '#ec4899';

type Gesture =
  | { kind: 'drag'; x0: number; y0: number; leaves: string[]; moved: boolean; clickId: string | null }
  | { kind: 'marquee'; x0: number; y0: number; keep: Set<string> };

export function LayoutEditOverlay({ layout, session, frame, dark, wrap, start, stale = false, onCommit, onExit, onOpenCode, onWheel }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(start ? [start.id] : []));
  // Drawing of an uncommitted drag; kept after the commit until the block's layout catches up, so nothing flickers.
  const [preview, setPreview] = useState<{ sig: string; scene: Scene; svg: string; guides: Line[] } | null>(null);
  const [box, setBox] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const committed = useMemo(() => session.compose(layout, paletteOf(dark)), [session, layout, dark]);
  const handles = useMemo(() => layoutHandles(committed.scene.handles, committed.scene.origin), [committed]);
  const shown = preview ?? committed;
  const shownHandles = useMemo(() => (preview ? layoutHandles(preview.scene.handles, preview.scene.origin) : handles), [preview, handles]);

  // Latest values for the window listeners of a gesture.
  const live = useRef({ layout, session, frame, handles, selected, stale, onCommit, dark });
  live.current = { layout, session, frame, handles, selected, stale, onCommit, dark };
  const gesture = useRef<Gesture | null>(null);
  const frameReq = useRef(0);

  useEffect(() => {
    if (preview && preview.sig === layoutSig(layout)) setPreview(null);
  }, [layout, preview]);
  // Selected ids that no longer exist (an undo, a code edit) drop out.
  useEffect(() => {
    const ids = new Set(handles.map((h) => h.id));
    if ([...selected].some((id) => !ids.has(id))) setSelected(new Set([...selected].filter((id) => ids.has(id))));
  }, [handles, selected]);

  const local = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = wrap.getBoundingClientRect();
      return toLayout(live.current.frame, { x: e.clientX - r.left, y: e.clientY - r.top });
    },
    [wrap],
  );

  /** The layout and picture for moving `leaves` by (dx, dy) in layout units, snapped unless `free`. */
  const dragTo = useCallback((leaves: string[], dx: number, dy: number, free: boolean) => {
    const { handles, session, layout, frame } = live.current;
    const moving = boundsOf(handles, leaves);
    if (!moving) return null;
    const s = free ? { dx, dy, guides: [] } : snapMove(moving, snapTargets(handles, leaves), dx, dy, SNAP_PX / frame.k);
    const next = movedLayout(layout, handles, leaves, s.dx, s.dy, session.basis);
    return { next, guides: s.guides };
  }, []);

  const show = useCallback(
    (next: BlockLayout, guides: Line[]) => {
      cancelAnimationFrame(frameReq.current);
      frameReq.current = requestAnimationFrame(() => {
        const { scene, svg } = live.current.session.compose(next, paletteOf(live.current.dark));
        setPreview({ sig: layoutSig(next), scene, svg, guides });
      });
    },
    [],
  );

  const commit = useCallback((next: BlockLayout) => {
    cancelAnimationFrame(frameReq.current);
    if (layoutSig(next) === layoutSig(live.current.layout)) {
      setPreview(null);
      return;
    }
    const { scene, svg } = live.current.session.compose(next, paletteOf(live.current.dark));
    setPreview({ sig: layoutSig(next), scene, svg, guides: [] });
    live.current.onCommit(next);
  }, []);

  const begin = useCallback(
    (e: { clientX: number; clientY: number; shiftKey: boolean }, hitId: string | null) => {
      if (live.current.stale) return;
      const p = local(e);
      const sel = live.current.selected;
      if (hitId) {
        let next = sel;
        let clickId: string | null = null;
        if (e.shiftKey) {
          const t = new Set(sel);
          if (t.has(hitId)) t.delete(hitId);
          else t.add(hitId);
          next = t;
        } else if (!sel.has(hitId)) next = new Set([hitId]);
        // Pressing a node that is part of a bigger selection keeps the group for a drag, and selects it alone on click.
        else if (sel.size > 1) clickId = hitId;
        setSelected(next);
        if (!next.has(hitId)) return;
        gesture.current = { kind: 'drag', x0: p.x, y0: p.y, leaves: leavesOf(next, live.current.handles), moved: false, clickId };
      } else {
        const keep = e.shiftKey ? new Set(sel) : new Set<string>();
        if (!e.shiftKey) setSelected(keep);
        gesture.current = { kind: 'marquee', x0: p.x, y0: p.y, keep };
        setBox({ a: p, b: p });
      }
    },
    [local],
  );

  // Window listeners for the gesture in progress (a press may start on the canvas, before this overlay existed).
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (!(e.buttons & 1)) return end(e);
      const p = local(e);
      const k = live.current.frame.k;
      if (g.kind === 'drag') {
        const dx = p.x - g.x0;
        const dy = p.y - g.y0;
        if (!g.moved && Math.hypot(dx, dy) * k < DRAG_PX) return;
        g.moved = true;
        const r = dragTo(g.leaves, dx, dy, e.altKey);
        if (r) show(r.next, r.guides);
      } else {
        setBox({ a: { x: g.x0, y: g.y0 }, b: p });
        const ids = marquee(live.current.handles, { x: g.x0, y: g.y0 }, p);
        setSelected(new Set([...g.keep, ...ids]));
      }
    };
    const end = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      if (g.kind === 'marquee') {
        setBox(null);
        return;
      }
      if (!g.moved) {
        if (g.clickId) setSelected(new Set([g.clickId]));
        return;
      }
      const p = local(e);
      const r = dragTo(g.leaves, p.x - g.x0, p.y - g.y0, e.altKey);
      if (r) commit(r.next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      cancelAnimationFrame(frameReq.current);
    };
  }, [local, dragTo, show, commit]);

  // The press that entered edit mode on a node goes on as a drag.
  const startN = useRef(0);
  useEffect(() => {
    if (!start || startN.current === start.n) return;
    startN.current = start.n;
    begin({ clientX: start.clientX, clientY: start.clientY, shiftKey: false }, start.id);
  }, [start, begin]);

  // Entering from the palette or the bar leaves focus outside the canvas; Ctrl+Z must reach Excalidraw.
  useEffect(() => focusCanvas(wrap), [wrap]);

  // Arrow keys move the selection on screen and commit on key up: one undo step per press or hold, not one per
  // auto-repeat. `dx, dy` add up from the layout as it was when the press began.
  // This relies on `live.current.layout` already holding the committed layout when the next keydown arrives: the key
  // up commits through `onCommit` -> Excalidraw onChange -> App state, which React 18 flushes synchronously for a
  // discrete event (keyup), so the overlay re-renders before the next keydown. If that chain ever goes async (a
  // debounced onChange, a transition), a quick second press would start from the old layout and drop the first move.
  const held = useRef<{ leaves: string[]; dx: number; dy: number } | null>(null);
  const endHold = useCallback(() => {
    const h = held.current;
    held.current = null;
    if (!h) return;
    const r = dragTo(h.leaves, h.dx, h.dy, true);
    if (r) commit(r.next);
  }, [dragTo, commit]);
  const endHoldRef = useRef(endHold);
  endHoldRef.current = endHold;
  useEffect(() => () => endHoldRef.current(), []);

  // Keys while editing: Escape leaves, Enter opens the code (§5.2; the selection is empty in edit mode, so the
  // canvas's own Enter cannot), arrows nudge the selection, Ctrl/Cmd+A selects every node (not every canvas element).
  // Delete would remove the whole block image, so it does nothing here. Only keys on the canvas count: the sidebar,
  // the page body, the code panel and any field are left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.target instanceof Node) || !wrap.contains(e.target)) return;
      if (e.isComposing || (e.target instanceof HTMLElement && e.target.closest('aside, input, textarea, select, [contenteditable], [role="dialog"]'))) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      if (e.key === 'Enter' && plain && !(e.target instanceof HTMLElement && e.target.closest('button, a'))) {
        e.preventDefault();
        e.stopPropagation();
        endHold();
        onOpenCode();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (gesture.current) {
          gesture.current = null;
          setBox(null);
          setPreview(null);
          return;
        }
        endHold();
        onExit();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();
        const { handles } = live.current;
        const ids = new Set(handles.map((h) => h.id));
        setSelected(new Set(handles.filter((h) => !ids.has(h.parent)).map((h) => h.id)));
        return;
      }
      const step = e.ctrlKey || e.metaKey ? null : nudgeFor(e.key, e.shiftKey);
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      const { selected, handles, stale } = live.current;
      if (!selected.size || gesture.current || stale) return;
      const h = held.current ?? { leaves: leavesOf(selected, handles), dx: 0, dy: 0 };
      h.dx += step.dx;
      h.dy += step.dy;
      held.current = h;
      const r = dragTo(h.leaves, h.dx, h.dy, true);
      if (r) show(r.next, []);
    };
    const onUp = (e: KeyboardEvent) => {
      if (held.current && nudgeFor(e.key, false)) endHold();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', endHold);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', endHold);
    };
  }, [wrap, onExit, onOpenCode, dragTo, commit, show, endHold]);

  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      onWheel(e);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [onWheel]);

  const o = shown.scene.origin ?? { x: 0, y: 0 };
  const topLeft = toScreen(frame, { x: -o.x, y: -o.y });
  const k = frame.k;
  const rect = (h: { x: number; y: number; w: number; h: number }) => {
    const p = toScreen(frame, h);
    return { x: p.x, y: p.y, w: h.w * k, h: h.h * k };
  };
  const [hover, setHover] = useState<string | null>(null);

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" data-layout-edit="">
      <div
        ref={root}
        className="pointer-events-auto absolute"
        aria-label="레이아웃 편집"
        style={{ left: topLeft.x, top: topLeft.y, width: shown.scene.width * k, height: shown.scene.height * k, cursor: hover ? 'move' : 'default', touchAction: 'none' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          // Keyboard focus goes to Excalidraw's container: arrows nudge here, and Excalidraw only hears keys (Ctrl+Z) there.
          focusCanvas(wrap);
          begin(e, hitHandle(shownHandles, local(e))?.id ?? null);
        }}
        onPointerMove={(e) => {
          if (gesture.current) return;
          setHover(hitHandle(shownHandles, local(e))?.id ?? null);
        }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenCode();
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{ width: shown.scene.width, height: shown.scene.height, transform: `scale(${k})`, transformOrigin: '0 0' }}
          // The SVG comes from our own renderer, which escapes every label.
          dangerouslySetInnerHTML={{ __html: shown.svg }}
        />
      </div>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" data-layout-marks="">
        {hover && !selected.has(hover) && <Mark h={shownHandles.find((h) => h.id === hover)} rect={rect} dashed />}
        {[...selected].map((id) => (
          <Mark key={id} id={id} h={shownHandles.find((h) => h.id === id)} rect={rect} />
        ))}
        {(preview?.guides ?? []).map((g, i) => {
          const a = toScreen(frame, { x: g.x1, y: g.y1 });
          const b = toScreen(frame, { x: g.x2, y: g.y2 });
          return <line key={i} data-guide="" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={GUIDE} strokeWidth={1} />;
        })}
        {box && (() => {
          const a = toScreen(frame, box.a);
          const b = toScreen(frame, box.b);
          return <rect data-marquee="" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} fill={`${ACCENT}14`} stroke={ACCENT} strokeWidth={1} />;
        })()}
      </svg>
    </div>
  );
}

/** Focus Excalidraw's container (it handles keys only there) without scrolling the page. */
export function focusCanvas(wrap: HTMLElement | null | undefined) {
  wrap?.querySelector<HTMLElement>('.excalidraw')?.focus({ preventScroll: true });
}

function Mark({ id, h, rect, dashed }: { id?: string; h: LayoutHandle | undefined; rect: (h: LayoutHandle) => { x: number; y: number; w: number; h: number }; dashed?: boolean }) {
  if (!h) return null;
  const r = rect(h);
  return (
    <rect
      data-selected={id}
      x={r.x - 3}
      y={r.y - 3}
      width={r.w + 6}
      height={r.h + 6}
      rx={6}
      fill="none"
      stroke={ACCENT}
      strokeWidth={dashed ? 1 : 2}
      strokeDasharray={dashed ? '4 3' : undefined}
    />
  );
}
