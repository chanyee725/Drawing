// Task board stages (used by the task board, PR 2 of E19). Pure.
import type { TaskStage } from '../types';

/** Board stages in order; `done` and `blocked` are states, not cells. */
export const STEPS: { id: TaskStage; label: string }[] = [
  { id: 'plan', label: '계획' },
  { id: 'impl', label: '구현' },
  { id: 'review', label: '리뷰' },
  { id: 'test', label: '테스트' },
  { id: 'merge', label: '병합' },
];
export const stepIndex = (s: TaskStage) => STEPS.findIndex(x => x.id === s);

type StageTask = { stage: TaskStage; stages?: { stage: TaskStage; at: number }[] };

/** The stage a blocked task was in before it got stuck. */
export function lastStep(t: StageTask): TaskStage {
  if (t.stage !== 'blocked') return t.stage;
  return [...(t.stages ?? [])].reverse().find(e => e.stage !== 'blocked')?.stage ?? 'plan';
}

export type StepState = 'done' | 'current' | 'blocked' | 'skipped' | 'todo';

/** Each stage's state for the progress bar: done, current, blocked, skipped (jumped past) or todo. */
export function stepStates(t: StageTask): StepState[] {
  const finished = t.stage === 'done';
  const at = stepIndex(lastStep(t));
  const known = (t.stages?.length ?? 0) > 0;
  const seen = new Set((t.stages ?? []).map(e => e.stage));
  return STEPS.map((s, i) => {
    const went = !known || seen.has(s.id);
    if (finished) return went ? 'done' : 'skipped';
    if (i === at) return t.stage === 'blocked' ? 'blocked' : 'current';
    if (i < at) return went ? 'done' : 'skipped';
    return 'todo';
  });
}
