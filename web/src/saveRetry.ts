/**
 * A failed save is worth retrying unless the server refused the request itself (4xx):
 * resending the same body cannot succeed. Takes any error carrying a numeric `status` (ApiError).
 */
export function isRetryableSaveError(e: unknown): boolean {
  const status = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined;
  return !(typeof status === 'number' && status >= 400 && status < 500);
}
