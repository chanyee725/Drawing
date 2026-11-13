// The run strip's 멈추기 · 이어서 하기 · 계획 다시 열기 (E27, docs/design/dispatch-integration/3-ux-flow.md §4):
// which buttons a run state shows and the POST behind each. Pure apart from the injected fetch, so tests drive it.
import type { RunState } from './runModel.ts';

export type RunAction = 'stop' | 'resume' | 'reopen';

export const ACTION_LABEL: Record<RunAction, string> = { stop: '멈추기', resume: '이어서 하기', reopen: '계획 다시 열기' };

/** Running: 멈추기. Paused: 이어서 하기 and 계획 다시 열기. Finished runs have none. */
export function actionsFor(state: RunState | undefined): RunAction[] {
  if (state === 'running') return ['stop'];
  if (state === 'paused') return ['resume', 'reopen'];
  return [];
}

type Body = { error?: string; blockers?: string[] };

/** What a refused request says: the first blocker (e.g. the limit's reset time), else the server's message. */
export function actionError(action: RunAction, status: number, body: Body): string {
  if (body.blockers?.length) return body.blockers[0]!;
  return body.error ?? `${ACTION_LABEL[action]}를 하지 못했어요 (HTTP ${status})`;
}

/** POST /api/pipeline/<action> for the pipeline file at `path`; null when it worked, else the text to show. */
export async function requestAction(action: RunAction, path: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchFn(`/api/pipeline/${action}`, {
      method: 'POST',
      headers: { 'x-drawing': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  } catch {
    return `${ACTION_LABEL[action]}를 하지 못했어요. 서버에 닿지 않아요`;
  }
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as Body;
  return actionError(action, res.status, body);
}

export const DUPLICATE_LABEL = '복제해서 새 계획';

/** Done runs (E28) offer 복제해서 새 계획: a done plan is a record and cannot start again. */
export const canDuplicate = (state: RunState | undefined) => state === 'done';

/**
 * POST /api/pipeline/duplicate for the done plan at `path`: `{ path }` of the new draft when it worked, else
 * `{ error }` with the text to show.
 */
export async function requestDuplicate(path: string, fetchFn: typeof fetch = fetch): Promise<{ path: string } | { error: string }> {
  let res: Response;
  try {
    res = await fetchFn('/api/pipeline/duplicate', {
      method: 'POST',
      headers: { 'x-drawing': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  } catch {
    return { error: '복제하지 못했어요. 서버에 닿지 않아요' };
  }
  const body = (await res.json().catch(() => ({}))) as Body & { path?: unknown };
  if (res.ok && typeof body.path === 'string') return { path: body.path };
  return { error: body.error ?? `복제하지 못했어요 (HTTP ${res.status})` };
}
