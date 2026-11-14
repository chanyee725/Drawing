// Task board numbers (E19b): tasks grouped by stage, time per stage from the stage history, the ETA line.
// Pure: node --test loads it directly. Inputs are the metadata the server keeps on a task; no transcript text.
import type { BoardTask, TaskStage } from '../types.ts';

export const STAGES: { id: TaskStage; label: string }[] = [
  { id: 'plan', label: '계획' },
  { id: 'impl', label: '구현' },
  { id: 'review', label: '리뷰' },
  { id: 'test', label: '테스트' },
  { id: 'merge', label: '병합' },
  { id: 'done', label: '완료' },
  { id: 'blocked', label: '막힘' },
];

export const stageLabel = (s: TaskStage) => STAGES.find(x => x.id === s)?.label ?? s;

/** Tasks per stage, in board column order; inside a stage the one that has stood longest comes first. */
export function groupByStage(tasks: readonly BoardTask[]): Record<TaskStage, BoardTask[]> {
  const out = Object.fromEntries(STAGES.map(s => [s.id, [] as BoardTask[]])) as Record<TaskStage, BoardTask[]>;
  for (const t of tasks) (out[t.stage] ?? out.plan).push(t);
  for (const list of Object.values(out)) list.sort((a, b) => a.stageAt - b.stageAt || a.id.localeCompare(b.id));
  // Finished work piles up: the newest finished first, so the column's top is what just landed.
  out.done.reverse();
  return out;
}

/** How many finished tasks the 완료 column shows before "N개 더 보기". */
export const DONE_LIMIT = 10;

/** The cards a column shows: every stage in full except 완료, which is capped unless `all`. `more` is how many are hidden. */
export function visibleTasks(stage: TaskStage, list: readonly BoardTask[], all: boolean, limit = DONE_LIMIT): { shown: BoardTask[]; more: number } {
  if (stage !== 'done' || all || list.length <= limit) return { shown: [...list], more: 0 };
  return { shown: list.slice(0, limit), more: list.length - limit };
}

/** Milliseconds spent in each stage, in history order (a stage visited twice sums up). The current stage runs to `now`. */
export function stageSpans(t: Pick<BoardTask, 'stage' | 'stageAt' | 'createdAt' | 'stages'>, now: number): { stage: TaskStage; ms: number }[] {
  const hist = t.stages?.length ? t.stages : [{ stage: t.stage, at: t.stageAt ?? t.createdAt }];
  const sums = new Map<TaskStage, number>();
  hist.forEach((h, i) => {
    const end = i + 1 < hist.length ? hist[i + 1]!.at : now;
    sums.set(h.stage, (sums.get(h.stage) ?? 0) + Math.max(0, end - h.at));
  });
  return [...sums].map(([stage, ms]) => ({ stage, ms }));
}

/** "5분", "1시간 12분", "2일"; "방금" under a minute. */
export function span(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return '방금';
  if (m >= 1440) return `${Math.floor(m / 1440)}일`;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${m}분`;
}

/** The ETA line of an open task: minutes left, or how far past it is; null when none was set or the task is done. */
export function etaLine(t: Pick<BoardTask, 'stage' | 'etaAt'>, now: number): { text: string; late: boolean } | null {
  if (t.stage === 'done' || t.etaAt == null) return null;
  const left = t.etaAt - now;
  return left >= 60_000
    ? { text: `${span(left)} 남음`, late: false }
    : left > -60_000 ? { text: '곧 끝나요', late: false } : { text: `${span(-left)} 지났어요`, late: true };
}
