/**
 * A failed save is worth retrying unless the server refused the request itself (4xx):
 * resending the same body cannot succeed. 408 (timeout) and 429 (rate limit) are the exceptions: they say "try later". Takes any error carrying a numeric `status` (ApiError).
 */
export function isRetryableSaveError(e: unknown): boolean {
  const status = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined;
  if (status === 408 || status === 429) return true;
  return !(typeof status === 'number' && status >= 400 && status < 500);
}

export const RELOAD_STOPPED = '저장하지 못해서 새로고침을 멈추었어요';

/** The notice for a failed save: the "reload stopped" notice stays until a save succeeds, so a retry message never replaces it. */
export function saveProblemText(text: string, reloadStopped: boolean): string {
  return reloadStopped ? RELOAD_STOPPED : text;
}
