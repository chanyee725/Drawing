// Pure parts of the plan strip (E20): the GET /api/pipeline shape, the asks without an answer, and the
// limit line in the start confirm. See docs/design/dispatch-integration/3-ux-flow.md §3.

export type PipelineStatus = {
  path: string;
  revision: number;
  state: 'plan' | 'running' | 'paused' | null;
  /** While paused (E27): why, when, and when the limit window clears. */
  pause?: { by: 'limit' | 'stop'; at: number; resetAt?: number } | null;
  lead: string | null;
  draftRevision: number | null;
  approvedRevision: number | null;
  approvedAt: number | null;
  runId: string | null;
  /** Why it cannot start now; empty when it can. */
  blockers: string[];
  /** What the person changed since the lead's last write_plan. */
  changes: string[];
  /** Sessions the plan would start. */
  sessions: number;
  limits: { five: number | null; seven: number | null; fiveReset: number | null; sevenReset: number | null } | null;
};

/** The heading write_plan puts above the lead's open questions (shared/dispatch/plan-write.ts). */
export const ASKS_HEADING = '사용자에게 물어볼 것';

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

const textOf = (n: Node | undefined): string => (n ? (n.text ?? '') + (n.content ?? []).map(textOf).join('') : '');

/**
 * Asks in the document's "사용자에게 물어볼 것" section that nobody answered. An item counts as answered when it
 * has more than its question line (a nested list or a second paragraph) or its line carries "답:" or "→".
 */
export function unansweredAsks(document: unknown): number {
  const content = (document as Node | null)?.content;
  if (!Array.isArray(content)) return 0;
  const at = content.findIndex((n) => n?.type === 'heading' && textOf(n).trim() === ASKS_HEADING);
  if (at < 0) return 0;
  let count = 0;
  for (let i = at + 1; i < content.length; i++) {
    const n = content[i];
    if (n?.type === 'heading') break;
    if (n?.type !== 'bulletList' && n?.type !== 'orderedList') continue;
    for (const item of n.content ?? []) {
      const parts = item.content ?? [];
      const line = textOf(parts[0]);
      if (!line.trim()) continue;
      if (parts.length > 1 || /답\s*:|→/.test(line)) continue;
      count++;
    }
  }
  return count;
}

/** "Claude 5시간 한도 62% 사용 중" (or the weekly one when it is higher), or null when nothing is known. */
export function limitLine(limits: PipelineStatus['limits']): string | null {
  if (!limits) return null;
  const five = typeof limits.five === 'number' ? limits.five : null;
  const seven = typeof limits.seven === 'number' ? limits.seven : null;
  if (five === null && seven === null) return null;
  if (seven !== null && (five === null || seven > five)) return `Claude 주간 한도 ${Math.round(seven)}% 사용 중`;
  return `Claude 5시간 한도 ${Math.round(five as number)}% 사용 중`;
}

/** What a failed start says: the server's blockers, else its message. */
export function startError(status: number, body: { error?: string; blockers?: string[]; revision?: number }): string {
  if (body.blockers?.length) return body.blockers.join(' · ');
  if (status === 409 && body.revision !== undefined) return `${body.error ?? '계획이 바뀌었어요'} (지금 rev ${body.revision})`;
  return body.error ?? `시작하지 못했어요 (HTTP ${status})`;
}

/** What the confirm dialog showed: 시작하기 approves exactly this revision, whatever the file is by then. */
export type PlanSnapshot = Pick<PipelineStatus, 'revision' | 'sessions' | 'changes' | 'limits'>;

export function confirmSnapshot(status: PlanSnapshot): PlanSnapshot {
  return { revision: status.revision, sessions: status.sessions, changes: [...status.changes], limits: status.limits };
}

/** The start request for the plan the person saw. */
export function startBody(path: string, shown: PlanSnapshot): { path: string; revision: number } {
  return { path, revision: shown.revision };
}

/** The server refused because the plan moved on since the dialog opened (409 with the current revision). */
export function isPlanChanged(status: number, body: { blockers?: string[]; revision?: number }): boolean {
  return status === 409 && !body.blockers?.length && body.revision !== undefined;
}

export const PLAN_CHANGED_NOTICE = '계획이 바뀌었어요. 새 계획을 확인하고 다시 시작해 주세요.';
