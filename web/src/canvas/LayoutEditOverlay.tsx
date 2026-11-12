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
  onCommit: (layout: BlockLayout) => void;
  onExit: () => void;
  onOpenCode: () => void;
  /** Wheel over the overlay goes to the canvas, so zoom and pan keep working. */
  onWheel: (e: WheelEvent) => void;
};

// Pixels a press must travel before it counts as a drag (a smaller move is a click).
const DRAG_PX = 3;
// Excalidraw's dark theme inverts the whole canvas; the overlay picture gets the same filter so it does not flash.
const DARK_FILTER = 'invert(93%) hue-rotate(180deg)';
const ACCENT = '#3b82f6';
const GUIDE = '#ec4899';

type Gesture =
  | { kind: 'drag'; x0: number; y0: number; leaves: string[]; moved: boolean; clickId: string | null }
  | { kind: 'marquee'; x0: number; y0: number; keep: Set<string> };

export function LayoutEditOverlay({ layout, session, frame, dark, wrap, start, onCommit, onExit, onOpenCode, onWheel }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(start ? [start.id] : []));
  // Drawing of an uncommitted drag; kept after the commit until the block's layout catches up, so nothing flickers.
  const [preview, setPreview] = useState<{ sig: string; scene: Scene; svg: string; guides: Line[] } | null>(null);
  const [box, setBox] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const committed = useMemo(() => session.compose(layout), [session, layout]);
  const handles = useMemo(() => layoutHandles(committed.scene.handles, committed.scene.origin), [committed]);
  const shown = preview ?? committed;
  const shownHandles = useMemo(() => (preview ? layoutHandles(preview.scene.handles, preview.scene.origin) : handles), [preview, handles]);

  // Latest values for the window listeners of a gesture.
  const live = useRef({ layout, session, frame, handles, selected, onCommit });
  live.current = { layout, session, frame, handles, selected, onCommit };
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
        const { scene, svg } = live.current.session.compose(next);
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
    const { scene, svg } = live.current.session.compose(next);
    setPreview({ sig: layoutSig(next), scene, svg, guides: [] });
    live.current.onCommit(next);
  }, []);

  const begin = useCallback(
    (e: { clientX: number; clientY: number; shiftKey: boolean }, hitId: string | null) => {
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

  // Keys while editing: Escape leaves, arrows nudge the selection. Delete would remove the whole block image, so it does
  // nothing here. Typing in the code panel or any field is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || (e.target instanceof HTMLElement && e.target.closest('aside, input, textarea, select, [contenteditable], [role="dialog"]'))) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (gesture.current) {
          gesture.current = null;
          setBox(null);
          setPreview(null);
          return;
        }
        onExit();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const step = e.ctrlKey || e.metaKey ? null : nudgeFor(e.key, e.shiftKey);
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      const { selected, handles } = live.current;
      if (!selected.size || gesture.current) return;
      const r = dragTo(leavesOf(selected, handles), step.dx, step.dy, true);
      if (r) commit(r.next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onExit, dragTo, commit]);

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
          // Keep keyboard focus off fields (arrows nudge) without scrolling the page.
          (document.activeElement as HTMLElement | null)?.blur?.();
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
          style={{ width: shown.scene.width, height: shown.scene.height, transform: `scale(${k})`, transformOrigin: '0 0', filter: dark ? DARK_FILTER : undefined }}
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
