// Command-line parsing for `npm start -- <project-dir> [--dispatch <url>]`.

/** Returns { projectDir, dispatch } or throws an Error with a user-facing message. */
export function parseArgs(argv) {
  const opts = { projectDir: null, dispatch: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dispatch') {
      const v = argv[++i];
      if (!v || v.startsWith('-')) throw new Error('--dispatch needs a URL, e.g. --dispatch http://127.0.0.1:4318');
      opts.dispatch = v;
    } else if (a.startsWith('--dispatch=')) {
      const v = a.slice('--dispatch='.length);
      if (!v) throw new Error('--dispatch needs a URL, e.g. --dispatch http://127.0.0.1:4318');
      opts.dispatch = v;
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown option: ${a}`);
    } else if (!opts.projectDir) {
      opts.projectDir = a;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  if (!opts.projectDir) throw new Error('Missing <project-dir>');
  return opts;
}

export const USAGE = 'Usage: npm start -- <project-dir> [--dispatch <url>]';
