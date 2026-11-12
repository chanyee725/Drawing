// Figma-like cursors for agents working on the page being viewed (T5).
// Render as a DiagramView child. Positions live in diagram coordinates and glide on a
// critically damped spring driven by requestAnimationFrame; each frame maps them to
// screen px, so pan and zoom never make a cursor lag behind the diagram.
import { useEffect, useRef, useState } from 'react';
import type { DiagramApi } from '../view/DiagramView';
import { cursorOpacity, cursorPoint, roleColor, springSettled, springStep, type Agent, type Rect, type Spring1 } from './model';
import type { FocusRequest } from './useLiveAgents';

const OMEGA = 9; // spring speed: ~0.45 s to arrive
const FADE_RATE = 5; // opacity easing per second
const FOCUS_TTL_MS = 8000;

interface Anim {
  x: Spring1;
  y: Spring1;
  tx: number;
  ty: number;
  o: number;
  to: number;
}

export interface LiveCursorsProps {
  api: DiagramApi | null;
  agents: Agent[];
  /** File path and page id being viewed. */
  path: string | null;
  pageId: string | null;
  /** Same string as DiagramView's resetKey, to know when the drawn page is this one. */
  viewKey: string;
  now: number;
  focus: FocusRequest | null;
}

export function LiveCursors({ api, agents, path, pageId, viewKey, now, focus }: LiveCursorsProps) {
  const visible = agents.filter((a) => a.lastChange?.relPath === path && a.lastChange.page?.id === pageId && path && pageId);
  const anims = useRef(new Map<string, Anim>());
  const els = useRef(new Map<string, HTMLDivElement>());
  const raf = useRef(0);
  const last = useRef(0);
  const pending = useRef<{ agentId: string; until: number } | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);

  // Latest props for callbacks fired by the view or rAF.
  const live = useRef({ api, visible, viewKey, now });
  live.current = { api, visible, viewKey, now };

  const draw = (id: string, a: Anim) => {
    const el = els.current.get(id);
    const api = live.current.api;
    if (!el || !api) return;
    const p = api.graphToScreen({ x: a.x.x, y: a.y.x, width: 0, height: 0 });
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    el.style.opacity = String(a.o);
    el.style.visibility = a.o < 0.01 ? 'hidden' : 'visible';
  };

  const frame = (t: number) => {
    const dt = Math.min(0.05, Math.max(0, (t - last.current) / 1000));
    last.current = t;
    let moving = false;
    for (const [id, a] of anims.current) {
      a.x = springStep(a.x, a.tx, dt, OMEGA);
      a.y = springStep(a.y, a.ty, dt, OMEGA);
      a.o += (a.to - a.o) * (1 - Math.exp(-FADE_RATE * dt));
      if (Math.abs(a.o - a.to) < 0.005) a.o = a.to;
      draw(id, a);
      if (!springSettled(a.x, a.tx) || !springSettled(a.y, a.ty) || a.o !== a.to) moving = true;
    }
    raf.current = moving ? requestAnimationFrame(frame) : 0;
  };

  const kick = () => {
    if (raf.current) return;
    last.current = performance.now();
    raf.current = requestAnimationFrame(frame);
  };

  /** Where each visible agent's cursor should go, in diagram coordinates. */
  const retarget = () => {
    const { api, visible, viewKey, now } = live.current;
    if (!api) return;
    const drawn = api.shownKey() === viewKey;
    const seen = new Set<string>();
    for (const agent of visible) {
      const c = agent.lastChange!;
      const screen = drawn ? api.getCellsRect(c.cellIds) : null;
      const r: Rect | null = screen ? api.screenToGraph(screen) : c.bbox;
      if (!r) continue;
      const p = cursorPoint(r);
      seen.add(agent.id);
      let a = anims.current.get(agent.id);
      if (!a) {
        a = { x: { x: p.x, v: 0 }, y: { x: p.y, v: 0 }, tx: p.x, ty: p.y, o: 0, to: 0 };
        anims.current.set(agent.id, a);
      }
      a.tx = p.x;
      a.ty = p.y;
      a.to = cursorOpacity(agent, now);
      if (drawn && pending.current?.agentId === agent.id) {
        if (performance.now() < pending.current.until) {
          api.centerOn({ x: p.x, y: p.y, width: 0, height: 0 });
          setPulse(agent.id);
        }
        pending.current = null;
      }
    }
    for (const id of anims.current.keys()) if (!seen.has(id)) anims.current.delete(id);
    for (const [id, a] of anims.current) draw(id, a);
    kick();
  };

  // A new page: start cursors fresh there instead of gliding across from the old page.
  useEffect(() => {
    anims.current.clear();
  }, [viewKey]);

  useEffect(() => {
    if (!api) return;
    return api.onViewChange(retarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    retarget();
  });

  useEffect(() => {
    if (!focus) return;
    pending.current = { agentId: focus.agentId, until: performance.now() + FOCUS_TTL_MS };
    retarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), 1600);
    return () => clearTimeout(t);
  }, [pulse]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="cursors">
      {visible.map((agent) => {
        const color = roleColor(agent.role, agent.roleName);
        const activity = agent.activity || agent.lastChange?.summary || '';
        return (
          <div
            key={agent.id}
            ref={(el) => {
              if (el) els.current.set(agent.id, el);
              else els.current.delete(agent.id);
            }}
            className="absolute left-0 top-0 will-change-transform"
            style={{ opacity: 0, visibility: 'hidden' }}
            data-cursor={agent.id}
            data-agent-name={agent.name}
          >
            {pulse === agent.id && (
              <span className="absolute -left-4 -top-4 h-8 w-8 animate-ping rounded-full" style={{ background: color, opacity: 0.35 }} />
            )}
            <svg width="20" height="22" viewBox="0 0 20 22" className="absolute -left-[3px] -top-[2px] drop-shadow-sm" aria-hidden>
              <path d="M3 2 L17 11.5 L10.5 12.6 L7.2 19 Z" fill={color} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            <div className="absolute left-4 top-[18px] flex max-w-[260px] flex-col items-start gap-0.5">
              <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium text-white shadow-sm" style={{ background: color }}>
                {agent.name || '이름 없음'}
                {agent.roleName && <span className="opacity-80"> · {agent.roleName}</span>}
              </span>
              {activity && (
                <span className="max-w-[260px] truncate rounded-md bg-white/95 px-2 py-0.5 text-xs text-neutral-700 shadow-sm ring-1 ring-black/5">
                  {activity}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
