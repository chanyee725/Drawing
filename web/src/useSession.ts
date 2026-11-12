import { useRef, useSyncExternalStore } from 'react';
import type { FileSession, SessionState } from './fileSession';

/** One slice of the open file's state; the component re-renders only when that slice changes (by `same`). */
export function useSession<T>(session: FileSession, pick: (s: SessionState) => T, same: (a: T, b: T) => boolean = Object.is): T {
  const last = useRef<{ v: T } | null>(null);
  const get = () => {
    const v = pick(session.getState());
    if (last.current && same(last.current.v, v)) return last.current.v;
    last.current = { v };
    return v;
  };
  return useSyncExternalStore(session.subscribe, get);
}
