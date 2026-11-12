// Command-line parsing for `npm start -- <workspace-dir>`.

/** Returns { workspaceDir } or throws an Error with a user-facing message. */
export function parseArgs(argv) {
  const opts = { workspaceDir: null };
  for (const a of argv) {
    if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    if (opts.workspaceDir) throw new Error(`Unexpected argument: ${a}`);
    opts.workspaceDir = a;
  }
  if (!opts.workspaceDir) throw new Error('Missing <workspace-dir>');
  return opts;
}

export const USAGE = 'Usage: npm start -- <workspace-dir>';
