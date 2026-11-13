// Progress overlay state: step ↔ node link, the five display states (`step.view`) and the weighted progress.
// Spec: docs/design/dispatch-integration/2-file-format-and-live-overlay.md §3 "Step ↔ node link", §5.1.
// Pure functions; `view` is computed, never stored.
//
// Inputs are small local types on purpose. The plan step (E18) and run record (E21) types land separately;
// swap `PlanStepRef` / `StepInput` for them with a one-line change each once they merge.

import type { SessionState } from './types.ts';

/** The fields of a plan step this module reads (E18 `steps[]`). */
export interface PlanStepRef {
  id: string;
  /** DSL node id in `plan.block`; defaults to `id`. */
  node?: string;
}

/** Task board stage (Dispatch tasks). */
export type Stage = 'plan' | 'impl' | 'review' | 'test' | 'merge' | 'done' | 'blocked';

/** What `stepView` reads about one step (E21 run record step plus its board stage). */
export interface StepInput {
  stage?: Stage | null;
  /** Raw Dispatch state of each session working on the step. */
  sessions: ReadonlyArray<{ state: SessionState }>;
  /** Paused by the usage-limit guard. */
  paused?: boolean;
}

export type StepView = 'pending' | 'active' | 'review' | 'done' | 'blocked';

export const STEP_VIEWS: Readonly<Record<StepView, { label: string; glyph: string }>> = {
  pending: { label: '대기', glyph: '◌' },
  active: { label: '진행', glyph: '●' },
  review: { label: '리뷰', glyph: '◐' },
  done: { label: '완료', glyph: '✓' },
  blocked: { label: '막힘', glyph: '⚠' },
};

/** Node id a step is drawn as. */
export function stepNode(step: PlanStepRef): string {
  return step.node ?? step.id;
}

export interface StepLinks {
  /** step id → node id, for steps whose node exists. */
  linked: Map<string, string>;
  /** Steps whose node is not in the diagram ("다이어그램에 없는 단계"); they still run. */
  missing: string[];
}

export function linkSteps(steps: readonly PlanStepRef[], nodes: Iterable<string>): StepLinks {
  const have = new Set(nodes);
  const linked = new Map<string, string>();
  const missing: string[] = [];
  for (const s of steps) {
    const n = stepNode(s);
    if (have.has(n)) linked.set(s.id, n);
    else missing.push(s.id);
  }
  return { linked, missing };
}

/**
 * After a code edit: when exactly one step lost its node and exactly one new, unclaimed node appeared,
 * offer to relink that step ("이 단계를 새 노드에 연결할까요?"). Never relinks by itself.
 */
export function relinkOffer(steps: readonly PlanStepRef[], before: Iterable<string>, after: Iterable<string>): { step: string; node: string } | null {
  const old = new Set(before);
  const now = new Set(after);
  const claimed = new Set(steps.map(stepNode));
  const lost = steps.filter((s) => old.has(stepNode(s)) && !now.has(stepNode(s)));
  const fresh = [...now].filter((n) => !old.has(n) && !claimed.has(n));
  return lost.length === 1 && fresh.length === 1 ? { step: lost[0]!.id, node: fresh[0]! } : null;
}

/** The display state of one step. */
export function stepView(s: StepInput): StepView {
  if (s.stage === 'done') return 'done';
  if (s.stage === 'blocked' || s.paused || s.sessions.some((x) => x.state === 'failed' || x.state === 'stuck')) return 'blocked';
  if (s.stage === 'review') return 'review';
  if (s.stage === 'impl' || s.stage === 'test' || s.stage === 'merge') return 'active';
  if (s.stage === 'plan' || s.sessions.length === 0) return 'pending';
  // No board stage: fall back to the sessions alone.
  return s.sessions.every((x) => x.state === 'done') ? 'done' : 'active';
}

/** A session waits on a person: a "사람 기다림" tag on an active/review step, not a progress state. */
export function waitingOnPerson(s: StepInput, view: StepView = stepView(s)): boolean {
  return (view === 'active' || view === 'review') && s.sessions.some((x) => x.state === 'waiting');
}

/**
 * The view a step had before it became blocked, carried across updates so a blocked step keeps its progress weight.
 * Call with the previous view, the previous carried value and the new view.
 */
export function carryBefore(prevView: StepView | undefined, prevBefore: StepView | undefined, view: StepView): StepView | undefined {
  if (view !== 'blocked') return undefined;
  return prevView === 'blocked' ? prevBefore : prevView;
}

/** How an edge between two step nodes is drawn. */
export type EdgeView = 'flow' | 'done' | 'none';

export function edgeView(from: StepView, to: StepView): EdgeView {
  if (from === 'done' && to === 'done') return 'done';
  if (from === 'done' && (to === 'active' || to === 'review')) return 'flow';
  return 'none';
}

/** Weights in tenths so the sum stays exact. */
const WEIGHT: Record<Exclude<StepView, 'blocked'>, number> = { pending: 0, active: 5, review: 8, done: 10 };

export interface ProgressItem {
  view: StepView;
  /** For a blocked step: the view it had before blocking (`carryBefore`). Absent counts as `pending`. */
  before?: StepView;
  /** Closed as abandoned (그만둠): leaves the denominator. */
  abandoned?: boolean;
}

export interface Progress {
  /** Counted steps (abandoned ones left out). */
  total: number;
  done: number;
  blocked: number;
  remaining: number;
  /** 0–100, rounded down: 100 only when every counted step is done. */
  percent: number;
}

export function progress(items: readonly ProgressItem[]): Progress {
  let total = 0;
  let done = 0;
  let blocked = 0;
  let sum = 0;
  for (const it of items) {
    if (it.abandoned) continue;
    total++;
    if (it.view === 'done') done++;
    if (it.view === 'blocked') blocked++;
    const v = it.view === 'blocked' ? (it.before && it.before !== 'blocked' ? it.before : 'pending') : it.view;
    sum += WEIGHT[v];
  }
  const percent = total === 0 ? 0 : Math.floor((sum * 10) / total);
  return { total, done, blocked, remaining: total - done, percent };
}

/** `5단계 중 2 완료 · 48% · 남은 3 (막힘 1)` */
export function progressLabel(p: Progress): string {
  const tail = p.blocked > 0 ? ` (막힘 ${p.blocked})` : '';
  return `${p.total}단계 중 ${p.done} 완료 · ${p.percent}% · 남은 ${p.remaining}${tail}`;
}
