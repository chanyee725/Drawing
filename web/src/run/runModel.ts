// Run screen model (E22): from a run record (server/runs/record.js), the plan snapshot it started with and the live
// Dispatch sessions, what the step rows, the canvas overlay, the status strip and the history list show.
// Pure: no DOM, no fetch, so it runs under `node --test`. Metadata only, like the record: no transcripts.

import type { Plan } from '../../../shared/dispatch/plan.ts';
import type { SessionState } from '../../../shared/dispatch/types.ts';
import { STEP_VIEWS, progressLabel, stepView, type Progress, type StepView } from '../../../shared/dispatch/step-view.ts';
import { roleLabel, runProgress, type RunAgent, type RunStep } from './overlayModel.ts';

export type RunState = 'running' | 'done' | 'failed' | 'stopped';

/** A session as the record keeps it (record.js pickSession). */
export interface RecSession {
  sid: string;
  name?: string;
  provider?: string;
  model?: string;
  effort?: string;
  branch?: string;
  commit?: string;
  state?: SessionState;
  stateSince?: number;
  cost?: number;
  ctxPct?: number;
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  pr?: { number: number; state: string | null } | null;
  attention?: string | null;
}

export interface RecStep {
  state: string;
  startedAt: number | null;
  endedAt: number | null;
  sessions: RecSession[];
}

export interface RunRecord {
  v: number;
  id: string;
  file: string;
  plan: { revision: number; hash: string; snapshot: Plan };
  startedAt: number;
  endedAt: number | null;
  state: RunState;
  steps: Record<string, RecStep>;
  totals: { cost: number; mtok: number };
  timeline: [number, string, string][];
}

export type RunSummary = Pick<RunRecord, 'id' | 'startedAt' | 'endedAt' | 'state' | 'totals'>;

/** The live Dispatch session fields the run screen reads (shared/dispatch/types.ts Session). */
export interface LiveSession {
  id: string;
  name: string;
  role: string;
  model?: string;
  modelLabel?: string;
  provider?: string;
  state?: SessionState;
  stateSince?: number;
  branch?: string | null;
  cost?: number | null;
  activity?: { label: string; since: number } | null;
  ctx?: number;
  ctxWindow?: number;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** A `run` SSE event (server/runs/recorder.js). */
export interface RunEvent {
  file: string;
  runId: string;
  run?: RunSummary;
  step?: string;
  state?: string;
  session?: Partial<RecSession> & { sid: string };
}

// ---- picking and patching ----

/** The run to show: the one running, else the newest. `list` is newest first (GET /api/runs). */
export function pickRun(list: readonly RunSummary[]): RunSummary | null {
  return list.find((r) => r.state === 'running') ?? list[0] ?? null;
}

/** Apply a `run` event to the record it belongs to; returns the same object when it does not apply. */
export function applyRunEvent(record: RunRecord, ev: RunEvent): RunRecord {
  if (ev.runId !== record.id) return record;
  if (ev.run) return { ...record, state: ev.run.state, endedAt: ev.run.endedAt, totals: ev.run.totals };
  if (!ev.step || !record.steps[ev.step]) return record;
  const step = record.steps[ev.step]!;
  let sessions = step.sessions;
  if (ev.session) {
    const i = sessions.findIndex((s) => s.sid === ev.session!.sid);
    sessions = i >= 0 ? sessions.map((s, j) => (j === i ? { ...s, ...ev.session } : s)) : [...sessions, { ...ev.session }];
  }
  const next: RecStep = { ...step, sessions, state: ev.state ?? step.state };
  return { ...record, steps: { ...record.steps, [ev.step]: next } };
}

// ---- formatting ----

/** "40초" → "1분", "12분", "1시간 7분". */
export function fmtDur(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60e3));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

export const fmtCost = (n: number) => `$${n.toFixed(2)}`;

/** "14:05" in local time. */
export function fmtClock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Node labels from a diagram block's code: `impl [label: "Implement"]` → impl → Implement. */
export function nodeLabels(code: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of (code ?? '').split('\n')) {
    const m = /^\s*([^\s[>:-][^[>]*?)\s*\[[^\]]*\blabel:\s*"([^"]*)"/.exec(line);
    if (m && !out.has(m[1]!)) out.set(m[1]!, m[2]!);
  }
  return out;
}

// ---- steps ----

export interface StepRow {
  id: string;
  /** 1-based position in the plan. */
  n: number;
  title: string;
  view: StepView;
  glyph: string;
  /** "진행", "완료", "건너뜀"... */
  label: string;
  /** "12분" (done), "8분째" (running), "기다려요", "막힘". */
  time: string;
  agents: RunAgent[];
  waiting: boolean;
  skipped: boolean;
  node: string;
  /** Blocked step: its view before blocking, from the timeline (keeps its progress weight). */
  before?: StepView;
}

type Live = ReadonlyMap<string, LiveSession>;

/** Timeline step state → the view it stands for; blocking states are left out. */
const VIEW_OF_STATE: Partial<Record<string, StepView>> = { working: 'active', waiting: 'active', resting: 'active', done: 'review', pending: 'pending' };

/** The view a step had before it became blocked: its newest non-blocking timeline entry. */
export function beforeBlocked(timeline: RunRecord['timeline'], stepId: string): StepView | undefined {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const [, step, state] = timeline[i]!;
    const v = step === stepId ? VIEW_OF_STATE[state] : undefined;
    if (v) return v;
  }
  return undefined;
}

const stateNow = (s: RecSession, live: Live, running: boolean): SessionState | undefined => (running ? live.get(s.sid)?.state : undefined) ?? s.state;

function roleOf(plan: Plan, stepId: string, s: RecSession, live: Live): string {
  const l = live.get(s.sid)?.role;
  if (l) return l;
  const st = plan.steps.find((x) => x.id === stepId);
  return st?.role ?? plan.defaults?.role ?? '';
}

export function stepRows(record: RunRecord, live: Live = new Map(), now = Date.now(), labels: ReadonlyMap<string, string> = new Map()): StepRow[] {
  const plan = record.plan.snapshot;
  const running = record.state === 'running';
  return plan.steps.map((ps, i) => {
    const step = record.steps[ps.id] ?? { state: 'pending', startedAt: null, endedAt: null, sessions: [] };
    const node = ps.node ?? ps.id;
    const states = step.sessions.map((s) => stateNow(s, live, running)).filter((x): x is SessionState => !!x);
    const skipped = step.state === 'skipped';
    let view: StepView;
    if (skipped) view = 'pending';
    else if (step.state === 'blocked') view = 'blocked';
    else if (states.length === 0) view = 'pending';
    else view = stepView({ sessions: states.map((state) => ({ state })) });
    // A finished run closed its steps: what ran and was not blocked is done.
    if (record.state === 'done' && !skipped && view !== 'blocked' && states.length > 0) view = 'done';
    const waiting = (view === 'active' || view === 'review') && states.includes('waiting');
    const v = STEP_VIEWS[view];
    let time: string;
    if (skipped) time = '건너뜀';
    else if (view === 'blocked') time = '막힘';
    else if (step.startedAt === null) time = '기다려요';
    else if (view === 'done' || !running || step.endedAt !== null) time = fmtDur((step.endedAt ?? record.endedAt ?? now) - step.startedAt);
    else time = `${fmtDur(now - step.startedAt)}째`;
    const agents = step.sessions.map((s) => {
      const l = live.get(s.sid);
      const model = l?.modelLabel ?? s.model ?? l?.model;
      return { name: l?.name ?? s.name ?? s.sid, role: roleOf(plan, ps.id, s, live), ...(model ? { model } : {}) };
    });
    const row: StepRow = { id: ps.id, n: i + 1, title: labels.get(node) ?? node, view, glyph: v.glyph, label: skipped ? '건너뜀' : v.label, time, agents, waiting, skipped, node };
    if (view === 'blocked') {
      const before = beforeBlocked(record.timeline, ps.id);
      if (before) row.before = before;
    }
    return row;
  });
}

/** What the canvas overlay draws (runStore.setRunSteps). */
export const overlaySteps = (rows: readonly StepRow[]): RunStep[] =>
  rows.map((r) => ({ id: r.id, node: r.node, view: r.view, waiting: r.waiting, title: r.title, agents: r.agents, ...(r.before ? { before: r.before } : {}), ...(r.skipped ? { skipped: true } : {}) }));

// ---- sessions ----

export interface SessionRow {
  sid: string;
  step: string;
  name: string;
  role: string;
  roleName: string;
  model: string;
  state: SessionState | null;
  branch: string | null;
  /** "npm test 실행 · 2분째" while live. */
  activity: string | null;
  cost: number | null;
  tokens: number;
  ctxPct: number | null;
  pr: number | null;
  /** Still a live Dispatch session (its sheet can open). */
  live: boolean;
}

export function sessionRows(record: RunRecord, live: Live = new Map(), now = Date.now()): SessionRow[] {
  const plan = record.plan.snapshot;
  const running = record.state === 'running';
  const out: SessionRow[] = [];
  for (const ps of plan.steps) {
    for (const s of record.steps[ps.id]?.sessions ?? []) {
      const l = running ? live.get(s.sid) : undefined;
      const role = roleOf(plan, ps.id, s, live);
      const t = s.tokens ?? {};
      const usage = l?.usage;
      out.push({
        sid: s.sid,
        step: ps.id,
        name: l?.name ?? s.name ?? s.sid,
        role,
        roleName: roleLabel(role),
        model: l?.modelLabel ?? s.model ?? l?.model ?? '',
        state: stateNow(s, live, running) ?? null,
        branch: l?.branch ?? s.branch ?? null,
        activity: l?.activity ? `${l.activity.label} · ${fmtDur(now - l.activity.since)}째` : null,
        cost: l?.cost ?? s.cost ?? null,
        tokens: usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite : (t.input ?? 0) + (t.output ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0),
        ctxPct: l?.ctx && l.ctxWindow ? Math.round((l.ctx / l.ctxWindow) * 100) : (s.ctxPct ?? null),
        pr: s.pr?.number ?? null,
        live: !!l,
      });
    }
  }
  return out;
}

// ---- status strip ----

export interface Attention {
  sid: string;
  text: string;
  since: number | null;
}

export interface StripModel {
  state: RunState;
  glyph: string;
  /** `실행 중 · 5단계 중 2 완료 · 48% · 남은 3 · 24분째 · $1.82 · 5시간 68%` as parts, joined with " · ". */
  parts: string[];
  /** Weighted progress (the strip's bar). */
  progress: Progress;
  /** Sessions a person should look at (running runs only), worst first. */
  attention: Attention[];
}

const RUN_LABEL: Record<RunState, { glyph: string; label: string }> = {
  running: { glyph: '●', label: '실행 중' },
  done: { glyph: '✓', label: '완료' },
  failed: { glyph: '⏸', label: '멈춤 · 실패' },
  stopped: { glyph: '⏸', label: '멈춤' },
};

const NEEDS: Partial<Record<SessionState, string>> = { failed: '실패했어요', stuck: '멈춰 있어요', waiting: '답을 기다려요' };
const ORDER: SessionState[] = ['failed', 'stuck', 'waiting'];

/** `five`: the 5-hour usage share 0–1 from Dispatch limits, shown while running. */
export function stripModel(record: RunRecord, rows: readonly StepRow[], sessions: readonly SessionRow[], five: number | null = null, now = Date.now()): StripModel {
  const running = record.state === 'running';
  const p = runProgress(overlaySteps(rows));
  const r = RUN_LABEL[record.state] ?? RUN_LABEL.stopped;
  const parts = [r.label, progressLabel(p), running ? `${fmtDur(now - record.startedAt)}째` : fmtDur((record.endedAt ?? now) - record.startedAt), fmtCost(record.totals.cost)];
  if (running && five !== null && Number.isFinite(five)) parts.push(`5시간 ${Math.round(five * 100)}%`);
  const attention: Attention[] = [];
  if (running) {
    for (const st of ORDER)
      for (const s of sessions)
        if (s.state === st) attention.push({ sid: s.sid, text: `${s.name}(${s.roleName})가 ${NEEDS[st]}`, since: null });
  }
  return { state: record.state, glyph: r.glyph, parts, progress: p, attention };
}

// ---- history ----

export interface HistoryLine {
  at: number;
  text: string;
}

const STEP_STATE_LABEL: Record<string, string> = {
  working: '진행',
  waiting: '사람 기다림',
  stuck: '멈춤',
  failed: '실패',
  resting: '쉼',
  done: '세션 끝남',
  pending: '대기',
  skipped: '건너뜀',
  blocked: '막힘',
};

/** The run's timeline, newest first, plus its start and end. */
export function historyLines(record: RunRecord, labels: ReadonlyMap<string, string> = new Map(), max = 50): HistoryLine[] {
  const plan = record.plan.snapshot;
  const title = (id: string) => {
    const i = plan.steps.findIndex((s) => s.id === id);
    const node = plan.steps[i]?.node ?? id;
    return i >= 0 ? `${i + 1} ${labels.get(node) ?? node}` : id;
  };
  const out: HistoryLine[] = [{ at: record.startedAt, text: `시작 · 계획 rev ${record.plan.revision}` }];
  for (const [at, step, state] of record.timeline) out.push({ at, text: `${title(step)} · ${STEP_STATE_LABEL[state] ?? state}` });
  if (record.endedAt !== null) out.push({ at: record.endedAt, text: RUN_LABEL[record.state]?.label ?? record.state });
  return out.reverse().slice(0, max);
}

/** One past run in the list: "11월 13일 14:05 · 완료 · 1시간 7분 · $4.90". */
export function runListText(r: RunSummary, now = Date.now()): string {
  const d = new Date(r.startedAt);
  const label = RUN_LABEL[r.state]?.label ?? r.state;
  const dur = r.state === 'running' ? `${fmtDur(now - r.startedAt)}째` : fmtDur((r.endedAt ?? r.startedAt) - r.startedAt);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${fmtClock(r.startedAt)} · ${label} · ${dur} · ${fmtCost(r.totals.cost)}`;
}
