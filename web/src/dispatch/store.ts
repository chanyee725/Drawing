// Dispatch screen state: one external store fed by the /api/events stream, read with useDispatch(selector).
// Transcripts stay in this tab's memory; nothing here writes to storage.
import { useSyncExternalStore } from 'react';
import { events } from '../lib/events.ts';
import type { DispatchState, BoardTask, Ticket } from './types';
import type { Entry, Limits, Provider, ProviderStatus, Session, Settings, Snapshot } from '../../../shared/dispatch/types.ts';

const initial = (): DispatchState => ({
  ready: false, online: false, unavailable: false, transcripts: {}, tasks: [], tickets: [],
  project: { name: '', path: '', branch: null }, roles: [], perms: [], models: [],
  providers: {} as Record<Provider, ProviderStatus>,
  limits: { five: null, seven: null, fable: null, fiveReset: null, sevenReset: null, fableReset: null, updatedAt: null },
  settings: { guard: { enabled: true, five: 0.9, seven: 0.85 }, team: { rotateLead: 5, rotateOthers: 10, ctxHandoff: 70, handoffMTokens: 15, maxChildren: 8, replyStyle: true, shareDeps: true, dropWorktrees: true, roleModels: {} } },
  sessions: [],
});

let state = initial();
const listeners = new Set<() => void>();

export function setState(patch: Partial<DispatchState>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useDispatch<T>(select: (s: DispatchState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
export const getState = () => state;
/** Tests only: back to the empty state. */
export const resetState = () => { state = initial(); gone.clear(); };

/** JSON request to the Dispatch API. Writes carry x-drawing: 1 (server/app.js rejects them otherwise). */
export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'x-drawing': '1' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export async function loadTranscript(id: string) {
  const res = await api<{ messages: Entry[] }>('GET', `/api/sessions/${encodeURIComponent(id)}/messages`);
  setState({ transcripts: { ...state.transcripts, [id]: res.messages } });
}

/** Drops a closed session's transcript from memory. */
export function forgetTranscript(id: string) {
  if (!(id in state.transcripts)) return;
  const { [id]: _, ...rest } = state.transcripts;
  setState({ transcripts: rest });
}

// Ids removed in this page's lifetime: a late update for one of them must not bring it back.
const gone = new Set<string>();

/** Applies one SSE event to the state. Exported so tests can drive it without a server. */
export function apply(ev: string, d: unknown) {
  switch (ev) {
    case 'snapshot': setState({ ...(d as Snapshot), ready: true, online: true }); break;
    case 'session': {
      const s = d as Session;
      if (gone.has(s.id)) return;
      const i = state.sessions.findIndex(x => x.id === s.id);
      setState({ sessions: i >= 0 ? state.sessions.map(x => (x.id === s.id ? s : x)) : [s, ...state.sessions] });
      break;
    }
    case 'removed': {
      const { id } = d as { id: string };
      gone.add(id);
      const { [id]: _, ...transcripts } = state.transcripts;
      setState({ sessions: state.sessions.filter(s => s.id !== id), transcripts });
      break;
    }
    case 'message': {
      const { id, entry } = d as { id: string; entry: Entry };
      const cur = state.transcripts[id];
      if (cur) setState({ transcripts: { ...state.transcripts, [id]: [...cur, entry] } });
      break;
    }
    case 'tasks': setState({ tasks: d as BoardTask[] }); break;
    case 'tickets': setState({ tickets: d as Ticket[] }); break;
    case 'limits': setState({ limits: d as Limits }); break;
    case 'settings': setState({ settings: d as Settings }); break;
    case 'providers': setState({ providers: d as Record<Provider, ProviderStatus> }); break;
  }
}

/** Events this store listens to; `prefs` (theme) is the app shell's business, not this screen's. */
export const EVENTS = ['snapshot', 'session', 'removed', 'message', 'tasks', 'tickets', 'limits', 'settings', 'providers'] as const;

/** Opens the event stream; returns a close function. A server without Dispatch marks the screen unavailable. */
export function connect(): () => void {
  const offs = EVENTS.map(ev => events.subscribeJson<unknown>(ev, d => apply(ev, d)));
  offs.push(events.onConnection(online => setState({ online })));
  // The snapshot comes over the stream; if Dispatch is off the state route 404s and nothing ever arrives.
  api<Snapshot>('GET', '/api/state').then(
    snap => { if (!state.ready) apply('snapshot', snap); },
    () => { if (!state.ready) setState({ unavailable: true }); },
  );
  return () => offs.forEach(off => off());
}
