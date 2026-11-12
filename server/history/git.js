// Read-only git history of one draw.io file in the main checkout.
// Only commit hash, commit time, subject and the file's path at that commit are
// read; the format string never asks for author/committer names or emails.
import { execFile } from 'node:child_process';
import { MAX_BYTES } from '../watch/parse.js';

export const GIT_LOG_LIMIT = 200;
const MAX_SUBJECT = 200;
const TIMEOUT_MS = 10_000;
const SHA = /^[0-9a-f]{40}$/;
const RS = '\x1e';
const US = '\x1f';

// Hash, committer time (unix seconds), subject. Nothing else.
const FORMAT = '%x1e%H%x1f%ct%x1f%s';

/** Arguments for `git log --follow` of `relPath` (relative to the git cwd). */
export function gitLogArgs(relPath, limit = GIT_LOG_LIMIT) {
  return [
    '--no-pager',
    '-c', 'color.ui=false',
    '-c', 'log.showSignature=false',
    '-c', 'core.quotepath=off',
    'log', '--follow', '-z', '--name-only', `--max-count=${limit}`, `--format=${FORMAT}`,
    '--', relPath,
  ];
}

const clean = (s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_SUBJECT);

/**
 * Parse `git log -z --name-only --format=FORMAT` output.
 * @returns Array<{ sha, at, subject, path }>  newest first; path is repo-root relative
 *   (null for a commit that lists no file, e.g. a merge).
 */
export function parseGitLog(out) {
  const commits = [];
  for (const chunk of out.split(RS)) {
    if (!chunk) continue;
    const nul = chunk.indexOf('\0');
    const head = nul === -1 ? chunk : chunk.slice(0, nul);
    const rest = nul === -1 ? '' : chunk.slice(nul + 1);
    const [sha, ct, ...subj] = head.split(US);
    if (!SHA.test(sha ?? '')) continue;
    const secs = Number(ct);
    const path = rest.split('\0').map((p) => p.replace(/^\n+/, '')).find(Boolean) ?? null;
    commits.push({ sha, at: Number.isFinite(secs) ? secs * 1000 : null, subject: clean(subj.join(' ')), path });
  }
  return commits;
}

function git(cwd, args, { maxBuffer = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer,
        timeout: TIMEOUT_MS,
        windowsHide: true,
        // Read-only: no optional index refresh/locks, never prompt.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' },
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/**
 * Git reader for one checkout. Caches each file's log per HEAD and a few blobs.
 * All failures (no git, not a repo, file never committed) read as "no history".
 */
export function createGitReader(dir) {
  const logs = new Map(); // relPath -> { head, commits }
  const blobs = new Map(); // `${sha}:${path}` -> text (small LRU)
  const BLOB_CACHE = 8;

  async function head() {
    try {
      return (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null;
    } catch {
      return null;
    }
  }

  /** @returns {Promise<{ available: boolean, commits: Array<{sha,at,subject,path}> }>} */
  async function log(relPath) {
    const h = await head();
    if (!h) return { available: false, commits: [] };
    const cached = logs.get(relPath);
    if (cached?.head === h) return { available: true, commits: cached.commits };
    let commits;
    try {
      commits = parseGitLog(await git(dir, gitLogArgs(relPath)));
    } catch {
      commits = [];
    }
    logs.set(relPath, { head: h, commits });
    return { available: true, commits };
  }

  /** File content at a commit. `sha` must come from log(); `path` is repo-root relative. */
  async function show(sha, path) {
    if (!SHA.test(sha) || !path) throw new Error('bad revision');
    const key = `${sha}:${path}`;
    if (blobs.has(key)) {
      const v = blobs.get(key);
      blobs.delete(key);
      blobs.set(key, v);
      return v;
    }
    // `rev:path` with a root-relative path; `--` is not allowed after a blob spec.
    const text = await git(dir, ['--no-pager', 'show', '--no-textconv', `${sha}:${path}`], { maxBuffer: MAX_BYTES });
    blobs.set(key, text);
    if (blobs.size > BLOB_CACHE) blobs.delete(blobs.keys().next().value);
    return text;
  }

  return { log, show };
}
