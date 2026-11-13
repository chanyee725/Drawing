// The open file's run, for the status strip, the run view and the canvas overlay. One external store: the run list
// (GET /api/runs) and the shown record (GET /api/runs/run), kept current by the app's `run` SSE events and read
// again after the stream reconnects. In memory only; records hold metadata only (no transcripts).
// E28: the person can pick a past run in the run view; that choice is kept and preferred on every reload until
// another file opens or they pick the default (the live run, else the newest) again.
import { useSyncExternalStore } from 'react';
import { applyRunEvent, pickRun, type RunEvent, type RunRecord, type RunSummary } from './runModel.ts';

export interface RunData {
  /** File path the data is for ('' when no pipeline file is open). */
  path: string;
  runs: RunSummary[];
  record: RunRecord | null;
  /** The run the person picked (E28), or null for the default (the live run, else the newest). */
  selected: string | null;
}

let state: RunData = { path: '', runs: [], record: null, selected: null };
const subs = new Set<() => void>();
const emit = (next: RunData) => {
  state = next;
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

const bare = (p: string) => p.replace(/\.dpx\.json$/, '');
const q = (p: string) => `path=${encodeURIComponent(p)}`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

let seq = 0;
/** The run to show: the picked one while it is still listed, else the live run, else the newest. */
export function shownRun(runs: readonly RunSummary[], selected: string | null): RunSummary | null {
  return (selected ? runs.find((r) => r.id === selected) : undefined) ?? pickRun(runs);
}

/** Read the list and the record to show (the picked run, else the running run, else the newest) again. */
export async function reloadRun(): Promise<void> {
  const path = state.path;
  if (!path) return;
  const n = ++seq;
  try {
    const { runs } = await getJson<{ runs: RunSummary[] }>(`/api/runs?${q(path)}`);
    const pick = shownRun(runs, state.selected);
    const record = pick ? await getJson<RunRecord>(`/api/runs/run?${q(path)}&id=${encodeURIComponent(pick.id)}`) : null;
    if (n === seq && state.path === path) emit({ ...state, runs, record });
  } catch {
    // A file without runs or a server without the runs module: nothing to show.
    if (n === seq && state.path === path) emit({ ...state, runs: [], record: null });
  }
}

/** Follow the runs of `path` (a pipeline file), or nothing with null. */
export function watchRun(path: string | null) {
  const p = path ?? '';
  if (p === state.path) return;
  seq++;
  emit({ path: p, runs: [], record: null, selected: null });
  void reloadRun();
}

/** Show run `id` of the open file (E28); the default run (live, else newest) clears the choice. */
export function selectRun(id: string | null): Promise<void> {
  if (!state.path) return Promise.resolve();
  const selected = id && id !== pickRun(state.runs)?.id ? id : null;
  if (selected === state.selected && state.record?.id === (id ?? pickRun(state.runs)?.id)) return Promise.resolve();
  emit({ ...state, selected });
  return reloadRun();
}

/** A `run` SSE event. Start and end events (they carry `run`) read the list again; the rest patch the record. */
export function onRunEvent(ev: RunEvent) {
  if (!state.path || bare(ev.file) !== bare(state.path)) return;
  if (ev.run) {
    void reloadRun();
    return;
  }
  if (!state.record) return;
  const record = applyRunEvent(state.record, ev);
  if (record !== state.record) emit({ ...state, record });
}

export function useRunData(): RunData {
  return useSyncExternalStore(subscribe, () => state);
}

/** Tests only. */
export const runDataForTests = () => state;
