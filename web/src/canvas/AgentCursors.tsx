// Canvas layer for live agent cursors (E56, issue #226): a pointer and a name tag in the session's role colour,
// gliding to the centre of what the agent changed, "thinking" near its last edit, then fading out.
//
// Placement runs in one animation-frame loop while a cursor of this file glides (a timer wakes it for phase changes): it writes `translate` and the
// phase straight onto each cursor's node (no React render per frame). Stacking is the run overlay's: z 3, above the
// drawing and under Excalidraw's toolbar and menus; it takes no pointer events.
import { useEffect, useMemo, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { roleLabel } from '../run/overlayModel';
import { moving, nextPhaseAt, phaseOf, positionAt, toScreen } from './agentCursor';
import { cursorsNow, now, pruneCursors, reducedMotion, useCursors } from './cursorStore';

type Props = { api: ExcalidrawImperativeAPI; wrap: HTMLElement; file: string };

export function AgentCursors({ api, wrap, file }: Props) {
  const all = useCursors();
  const mine = useMemo(() => [...all.values()].filter((c) => c.file === file), [all, file]);
  const nodes = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!mine.length) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = () => {
      frame = 0;
      clearTimeout(timer);
      const t = now();
      const reduced = reducedMotion();
      const st = api.getAppState();
      const rect = wrap.getBoundingClientRect();
      let glide = false;
      let wake = Infinity;
      for (const c of cursorsNow().values()) {
        const el = nodes.current.get(c.sid);
        if (!el || c.file !== file) continue;
        const p = toScreen(positionAt(c, t, reduced), st, rect);
        el.style.translate = `${Math.round(p.x * 10) / 10}px ${Math.round(p.y * 10) / 10}px`;
        const phase = phaseOf(c, t);
        if (el.dataset.phase !== phase) el.dataset.phase = phase;
        if (moving(c, t, reduced)) glide = true;
        wake = Math.min(wake, nextPhaseAt(c, t));
      }
      // Gone cursors leave the store (and the DOM). Frames only while gliding; otherwise wake at the next phase.
      pruneCursors(t);
      if (glide) frame = requestAnimationFrame(draw);
      else if (wake < Infinity) timer = setTimeout(draw, Math.max(16, wake - t));
    };
    frame = requestAnimationFrame(draw);
    // Panning and zooming move the scene under a still cursor.
    const off = api.onChange(() => {
      if (!frame) frame = requestAnimationFrame(draw);
    });
    return () => {
      off();
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api, wrap, file, mine]);

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
