// Canvas layer for live agent cursors (E56, issue #226): a pointer and a name tag in the session's colour (one per
// session, picked when it was created), gliding to the centre of what the agent changed, "thinking" near its last
// edit, then fading out.
//
// Placement runs in one animation-frame loop while a cursor of this file glides (a timer wakes it for phase changes):
// it writes `translate` and the phase straight onto each cursor's node (no React render per frame). A new cursor node
// is placed in a layout effect, before the browser paints it (hidden while the canvas is still loading its scene), so
// it never shows at the overlay's corner or at a place from an unsettled view first.
// Stacking is the run overlay's: z 3, above the drawing and under Excalidraw's toolbar and menus; it takes no pointer
// events.
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { roleLabel } from '../run/overlayModel';
import { moving, nextPhaseAt, phaseOf, positionAt, shownCursor, toScreen } from './agentCursor';
import { cursorsNow, glideClocks, now, pruneCursors, reducedMotion, subscribeCursors, useCursors } from './cursorStore';

type Props = { api: ExcalidrawImperativeAPI; wrap: HTMLElement; file: string };

export function AgentCursors({ api, wrap, file }: Props) {
  const all = useCursors();
  const mine = useMemo(() => [...all.values()].filter((c) => c.file === file), [all, file]);
  // The loop restarts only when cursors come or go, not on every event (a new place reaches it via the store).
  const sids = mine.map((c) => c.sid).join(' ');
  const nodes = useRef(new Map<string, HTMLDivElement>());

  useLayoutEffect(() => {
    if (!sids) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(timer);
      const t = now();
      const reduced = reducedMotion();
      const st = api.getAppState();
      // A remounted canvas loads its scene (and scrolls to its content) after it hands out its API: until then a
      // scene point has no settled place on screen. Stay hidden; Excalidraw's first onChange comes once it is loaded,
      // and a short timer looks again in case it does not.
      if (st.isLoading) {
        for (const el of nodes.current.values()) el.style.visibility = 'hidden';
        timer = setTimeout(draw, 50);
        return;
      }
      const rect = wrap.getBoundingClientRect();
      let glide = false;
      let wake = Infinity;
      for (const c of cursorsNow().values()) {
        const el = nodes.current.get(c.sid);
        if (!el || c.file !== file) continue;
        // The glide runs on the clock of the frames that show it (a remount must not use it up unseen).
        const shown = shownCursor(glideClocks, c, t);
        const p = toScreen(positionAt(shown, t, reduced), st, rect);
        el.style.translate = `${Math.round(p.x * 10) / 10}px ${Math.round(p.y * 10) / 10}px`;
        el.style.visibility = '';
        const phase = phaseOf(c, t);
        if (el.dataset.phase !== phase) el.dataset.phase = phase;
        if (moving(shown, t, reduced)) glide = true;
        wake = Math.min(wake, nextPhaseAt(c, t));
      }
      // Gone cursors leave the store (and the DOM). Frames only while gliding; otherwise wake at the next phase.
      pruneCursors(t);
      if (glide) frame = requestAnimationFrame(draw);
      else if (wake < Infinity) timer = setTimeout(draw, Math.max(16, wake - t));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    // New nodes are in the DOM but not painted yet: place (or hide) them now.
    draw();
    // A new place from the server; panning and zooming move the scene under a still cursor.
    const offStore = subscribeCursors(soon);
    const off = api.onChange(soon);
    return () => {
      offStore();
      off();
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api, wrap, file, sids]);

  if (!mine.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" data-agent-cursors="">
      {mine.map((c) => (
        <div
          key={c.sid}
          ref={(el) => {
            if (el) nodes.current.set(c.sid, el);
            else nodes.current.delete(c.sid);
          }}
          className="agent-cursor"
          data-agent-cursor={c.sid}
          data-role={c.role}
          style={c.color ? ({ '--agent': c.color } as CSSProperties) : undefined}
          data-phase="editing"
          aria-hidden="true"
        >
          <svg className="agent-cursor-pointer" width="16" height="18" viewBox="0 0 16 18">
            <path d="M1 1 L1 15 L5 11.5 L8 17 L10.5 15.8 L7.6 10.4 L13 10 Z" />
          </svg>
          <span className="agent-cursor-tag">
            {c.name || roleLabel(c.role)}
            <span className="agent-cursor-dots">
              <span />
              <span />
              <span />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
