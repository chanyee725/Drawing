// The two requests behind the plan strip's 시작하기 (E20), outside React so tests drive them with a real FileSession:
// open (save first, then read what the server holds) and start (approve exactly the revision the dialog showed).
import type { FileSession } from '../fileSession';
import { startBody, type PipelineStatus, type PlanSnapshot } from './planStripModel.ts';

/** Shown when the person's edits did not reach the server, so the server's plan is not the one they see. */
export const SAVE_FIRST = '저장이 안 돼서 시작할 수 없어요. 잠시 뒤 다시 해 보세요.';

export type OpenResult = { kind: 'open'; status: PipelineStatus } | { kind: 'refuse'; message: string } | { kind: 'gone' };

/**
 * Save unsaved edits, then read the plan to confirm. flush() never throws: a 409, a refused or failed save, or a
 * running move (hold) leaves the edits unsaved, and the server's revision would then miss them. Refuse in that case.
 */
export async function openPlanConfirm(
  session: Pick<FileSession, 'flush' | 'isDirty' | 'getState'>,
  path: string,
  readStatus: (path: string) => Promise<PipelineStatus | null>,
): Promise<OpenResult> {
  await session.flush();
  if (session.isDirty() || session.getState().conflict) return { kind: 'refuse', message: SAVE_FIRST };
  const st = await readStatus(path);
  if (!st || st.state !== 'plan') return { kind: 'gone' };
  return { kind: 'open', status: st };
}

export async function requestStart(path: string, shown: PlanSnapshot, fetchFn: typeof fetch = fetch) {
  const res = await fetchFn('/api/pipeline/start', {
    method: 'POST',
    headers: { 'x-drawing': '1', 'content-type': 'application/json' },
    body: JSON.stringify(startBody(path, shown)),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; blockers?: string[]; revision?: number };
  return { res, body };
}
