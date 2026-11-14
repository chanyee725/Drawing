// Usage screen numbers (E29): week totals, per-model and per-role sums, unusual days, top sessions, the always-on
// order and the screen picked by the URL hash. Pure: node --test loads it directly. Inputs are the metadata the
// server already keeps (daily cost and token counts, session cost); nothing here reads or keeps a transcript.
import { recordState, type Entry } from '../../../../shared/dispatch/timeline.js';
import type { Session, SessionState, Usage, UsageDay } from '../../../../shared/dispatch/types.ts';
import { stateOf } from './format.ts';

export const WEEK = 7;

export type ModelSum = Usage & { cost: number };

/** Per-model token and cost sums and per-role cost sums over `days`. */
export function aggregate(days: readonly UsageDay[]): { byModel: Record<string, ModelSum>; byRole: Record<string, number> } {
  const byModel: Record<string, ModelSum> = {};
  const byRole: Record<string, number> = {};
  for (const d of days) {
    for (const [m, u] of Object.entries(d.models ?? {})) {
      const t = (byModel[m] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
      t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheWrite += u.cacheWrite; t.cost += u.cost;
    }
    for (const [r, c] of Object.entries(d.roles ?? {})) byRole[r] = (byRole[r] ?? 0) + c;
  }
  return { byModel, byRole };
}

const sum = (ds: readonly UsageDay[]) => ds.reduce((a, d) => a + (d.cost || 0), 0);

/** The four headline numbers: today, the last 7 days, the 7 before them, and everything the server sent (14 days). */
export function totals(days: readonly UsageDay[]) {
  return { today: days.at(-1)?.cost ?? 0, week: sum(days.slice(-WEEK)), prev: sum(days.slice(0, -WEEK)), all: sum(days) };
}

/** "그 전 7일보다 +20%" text, or the daily average when there is no earlier week to compare with. */
export function weekHint(week: number, prev: number, fmt: (n: number) => string): string {
  if (!prev) return `하루 평균 ${fmt(week / WEEK)}`;
  const d = Math.round((week / prev - 1) * 100);
  return `그 전 7일보다 ${d >= 0 ? '+' : ''}${d}%`;
}

/** Share of input tokens read from cache: cacheRead / (input + cacheRead + cacheWrite); null with no input. */
export function cacheRate(byModel: Record<string, ModelSum>): number | null {
  let r = 0, t = 0;
  for (const u of Object.values(byModel)) { r += u.cacheRead; t += u.input + u.cacheRead + u.cacheWrite; }
  return t ? r / t : null;
}

/**
 * Days that cost at least twice the usual day. "Usual" is the median of the days that spent anything, and needs
 * three of them: idle days would drag the median to zero. Returns that median and, per day, the multiple (one
 * decimal) or null.
 */
export function outliers(totals: readonly number[]): { median: number | null; ratio: (number | null)[] } {
  const spent = totals.filter(t => t > 0).sort((a, b) => a - b);
  if (spent.length < 3) return { median: null, ratio: totals.map(() => null) };
  const m = spent.length >> 1;
  const median = spent.length % 2 ? spent[m] : (spent[m - 1] + spent[m]) / 2;
  return { median, ratio: totals.map(t => (t >= 2 * median ? Math.round((t / median) * 10) / 10 : null)) };
}

/** Sum of the per-session hourly rates that are known, and how many sessions have one. */
export function burnNow(sessions: readonly Pick<Session, 'burn'>[]): { perHour: number; rated: number } {
  const rated = sessions.filter(s => s.burn?.perHour != null);
  return { perHour: rated.reduce((a, s) => a + (s.burn?.perHour ?? 0), 0), rated: rated.length };
}

/** The `n` sessions that cost the most (sessions without a cost, like Codex or Gemini, are left out). */
export function topSessions<T extends Pick<Session, 'cost'>>(sessions: readonly T[], n = 10): T[] {
  return sessions.filter(s => s.cost != null).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, n);
}

/** Always-on order: needs-a-person states first; inside a state by start time then id, so tiles only move on a state change. */
const RANK: Record<SessionState, number> = { failed: 0, stuck: 1, waiting: 2, working: 3, resting: 4, done: 5 };
export function alwaysOnOrder<T extends { id: string; startedAt: number }>(list: readonly T[], stateOf: (s: T) => SessionState): T[] {
  return [...list].sort((a, b) => (RANK[stateOf(a)] ?? 9) - (RANK[stateOf(b)] ?? 9) || a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

/** Screens of /dispatch, picked by the URL hash so a wall display can open `#tv` directly and survive a reload. */
export type View = 'sessions' | 'timeline' | 'usage' | 'tv';
export function viewOf(hash: string): View {
  const h = hash.replace(/^#/, '');
  return h === 'timeline' || h === 'usage' || h === 'tv' ? h : 'sessions';
}
export const hashOf = (v: View) => (v === 'sessions' ? '' : `#${v}`);

/** A timeline row's history: the server's entries plus the live state, if a session event moved it after the last fetch. */
export function rowHistory(s: Pick<Session, 'status' | 'state' | 'stateSince'>, server: readonly Entry[] | undefined, now: number): Entry[] {
  const h: Entry[] = server ? [...server] : [];
  recordState(h, stateOf(s), Math.min(now, s.stateSince ?? now));
  return h;
}

export const REFETCH_DELAY_MS = 2000;
export const REFETCH_MAX_WAIT_MS = 10_000;

/** What the usage page knows when it schedules the next GET /api/usage. */
export type RefetchClock = {
  /** A load has succeeded at least once. */
  loaded: boolean;
  /** When the first change since the last request came in (only after a load). */
  pendingSince: number | null;
  /** When the last request went out, or null to go at once (first load, or the reload button). */
  lastTry: number | null;
};

/** Milliseconds until the next /api/usage request. After a load: REFETCH_DELAY_MS after the latest change, so a
 *  burst of finished turns costs one request, but never later than REFETCH_MAX_WAIT_MS after the first change while
 *  changes keep coming. Before a load (the first one failed): at most one try per REFETCH_DELAY_MS, however many
 *  session events come in. */
export function refetchDelay(c: RefetchClock, now: number): number {
  if (!c.loaded) return c.lastTry == null ? 0 : Math.max(0, c.lastTry + REFETCH_DELAY_MS - now);
  const since = c.pendingSince ?? now;
  return Math.max(0, Math.min(REFETCH_DELAY_MS, since + REFETCH_MAX_WAIT_MS - now));
}

/** Timers the refetcher uses; the page passes nothing (the real ones), tests pass a fake clock. */
export type RefetchTimers = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type UsageRefetcher = {
  /** Something moved: the cost/token key, or a session event while the first load has failed. Arms the next request
   *  with refetchDelay; while a request is out it only marks a change, picked up when that request settles. */
  change(): void;
  /** The reload button: go at once. Ignored (returns false) while a request is out. */
  reload(): boolean;
  /** Mount: results are applied again. Unmount: the timer is cleared and results are dropped. */
  start(): void;
  stop(): void;
  /** For tests: the scheduling state. */
  readonly clock: Readonly<RefetchClock>;
};

/**
 * Schedules GET /api/usage for the usage page. One request at a time: a change while a request is out does not
 * cancel or drop it (its answer, success or failure, is always applied and clears `loading`); the change re-arms
 * the timer once the request settles, so requests stay spaced out by refetchDelay.
 */
export function createUsageRefetcher<T>(
  fetch: () => Promise<T>,
  on: { result: (value: T) => void; error: (message: string) => void; loading: (on: boolean) => void },
  timers: RefetchTimers = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
): UsageRefetcher {
  const c: RefetchClock = { loaded: false, pendingSince: null, lastTry: null };
  let timer: unknown = null;
  let inFlight = false;
  let changedInFlight = false;
  let live = true;
  const disarm = () => { if (timer != null) timers.clearTimeout(timer); timer = null; };
  const arm = () => {
    disarm();
    if (!live) return;
    timer = timers.setTimeout(send, refetchDelay(c, timers.now()));
  };
  const send = () => {
    timer = null;
    c.pendingSince = null;
    c.lastTry = timers.now();
    inFlight = true;
    on.loading(true);
    fetch().then(
      v => { c.loaded = true; if (live) on.result(v); },
      (e: Error) => { if (live) on.error(e?.message ?? String(e)); },
    ).finally(() => {
      inFlight = false;
      if (live) on.loading(false);
      if (changedInFlight) { changedInFlight = false; r.change(); }
    });
  };
  const r: UsageRefetcher = {
    change() {
      if (inFlight) { changedInFlight = true; return; }
      if (c.loaded) c.pendingSince ??= timers.now();
      arm();
    },
    reload() {
      if (inFlight) return false;
      c.lastTry = null;
      arm();
      return true;
    },
    start() { live = true; },
    stop() { live = false; disarm(); },
    get clock() { return c; },
  };
  return r;
}

/** Changes when any session's cost or token totals move (Codex and agy report tokens but no cost). */
export function usageKey(sessions: readonly Pick<Session, 'cost' | 'usage'>[]): string {
  let cost = 0;
  let tokens = 0;
  for (const s of sessions) {
    cost += s.cost ?? 0;
    tokens += s.usage.input + s.usage.output + s.usage.cacheRead + s.usage.cacheWrite;
  }
  return `${cost.toFixed(4)}|${tokens}`;
}
