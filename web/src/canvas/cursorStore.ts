// Live agent cursors (E56) for the whole page, fed by `cursor` events from the shared event stream. Memory only.
import { useSyncExternalStore } from 'react';
import { applyCursor, lastDrawn, pruneGone, type Cursor, type CursorEvent, type GlideClock } from './agentCursor.ts';

let cursors: ReadonlyMap<string, Cursor> = new Map();
/** How much of each cursor's glide has been drawn (AgentCursors). Here, not in the layer: it outlives a remount. */
export const glideClocks = new Map<string, GlideClock>();
const subs = new Set<() => void>();
const set = (next: ReadonlyMap<string, Cursor>) => {
  if (next === cursors) return;
  cursors = next;
  for (const sid of glideClocks.keys()) if (!cursors.has(sid)) glideClocks.delete(sid);
  for (const f of subs) f();
};
/** f() after every change of the cursors; returns an unsubscribe function. */
export const subscribeCursors = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One `cursor` event from the server. */
export function applyCursorEvent(e: CursorEvent) {
  const t = now();
  // A new place glides on from where the cursor was last drawn, which may lag the event clock (see shownCursor).
  const old = e && typeof e.sid === 'string' ? cursors.get(e.sid) : undefined;
  const base = old ? new Map(cursors).set(old.sid, lastDrawn(glideClocks, old, t)) : cursors;
  const next = applyCursor(base, e, t, reducedMotion());
  set(next === base ? cursors : next);
}

/** Drop cursors that have faded out. */
export function pruneCursors(at = now()) {
  set(pruneGone(cursors, at));
}

/** A run of `file` ended (or the stream reconnected): no agent is editing it any more. */
export function clearCursors(file?: string) {
  let next: Map<string, Cursor> | null = null;
  for (const [sid, c] of cursors) if (file === undefined || c.file === file) (next ??= new Map(cursors)).delete(sid);
  if (next) set(next);
}

export const cursorsNow = () => cursors;

export const useCursors = () => useSyncExternalStore(subscribeCursors, cursorsNow, cursorsNow);
