// What the web does with a server `workspace` SSE event (pure, so it can be tested).

export type WorkspaceEvent = { kind: 'create' | 'change' | 'delete' | 'tree'; path: string; from?: string; revision?: number | null };

/** `a/b`, `a/b.dpx` and `a/b.dpx.json` are the same file. */
const stem = (p: string) => p.replace(/\.dpx(\.json)?$/i, '');
const same = (a: string, b: string) => stem(a) === stem(b);

/**
 * - `close`: the open file was deleted or moved away, so its pending save must not run.
 * - `reload`: the open file changed on disk and there is nothing unsaved to lose.
 * - `refresh`: only the file list needs updating (also when the open file changed but has unsaved edits:
 *   its next save gets the 409 choice).
 */
export function externalAction(e: WorkspaceEvent, openPath: string | null, dirty: boolean): 'close' | 'reload' | 'refresh' {
  if (!openPath) return 'refresh';
  if (e.kind === 'delete' && same(e.path, openPath)) return 'close';
  if (e.kind === 'tree' && e.from !== undefined && (same(e.from, openPath) || openPath.startsWith(e.from + '/'))) return 'close';
  if (e.kind === 'change' && same(e.path, openPath)) return dirty ? 'refresh' : 'reload';
  return 'refresh';
}
