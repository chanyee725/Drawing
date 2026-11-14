// Command-line parsing for `npm start -- <workspace-dir>`.

/**
 * Returns { workspaceDir, projectMode } or throws an Error with a user-facing message.
 * --project-mode (or DRAW_MODE=project): the server runs for another git project, and the web app
 * opens only the Dispatch run screen. plugin/scripts/start.sh passes it.
 */
export function parseArgs(argv, env = process.env) {
  const opts = { workspaceDir: null, projectMode: env.DRAW_MODE === 'project' };
  for (const a of argv) {
    if (a === '--project-mode') {
      opts.projectMode = true;
      continue;
    }
    if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    if (opts.workspaceDir) throw new Error(`Unexpected argument: ${a}`);
    opts.workspaceDir = a;
  }
  if (!opts.workspaceDir) throw new Error('Missing <workspace-dir>');
  return opts;
}

export const USAGE = 'Usage: npm start -- [--project-mode] <workspace-dir>';
