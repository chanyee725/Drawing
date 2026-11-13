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
