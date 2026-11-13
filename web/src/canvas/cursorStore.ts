// Live agent cursors (E56) for the whole page, fed by `cursor` events from the shared event stream. Memory only.
import { useSyncExternalStore } from 'react';
import { applyCursor, pruneGone, type Cursor, type CursorEvent } from './agentCursor.ts';

let cursors: ReadonlyMap<string, Cursor> = new Map();
const subs = new Set<() => void>();
const set = (next: ReadonlyMap<string, Cursor>) => {
  if (next === cursors) return;
  cursors = next;
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One `cursor` event from the server. */
export function applyCursorEvent(e: CursorEvent) {
  set(applyCursor(cursors, e, now(), reducedMotion()));
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

export const useCursors = () => useSyncExternalStore(subscribe, cursorsNow, cursorsNow);
