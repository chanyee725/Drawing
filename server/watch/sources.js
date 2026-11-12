// Sources to watch: the project dir itself ("main") and the same sub-path inside
// each Dispatch worktree (<dispatch-root>/.dispatch/wt/<name>/<sub-path>).
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.dispatch', '.playwright-mcp']);

export function isDrawio(name) {
  return name.endsWith('.drawio') || name.endsWith('.drawio.xml');
}

/** Walk up from dir to the first folder holding .dispatch/wt. */
export function findDispatchRoot(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, '.dispatch', 'wt'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** @returns Array<{ key, kind, label, dir, folder? }> */
export async function listSources(projectDir) {
  const main = { key: 'main', kind: 'main', label: 'main', dir: resolve(projectDir) };
  const out = [main];
  const root = findDispatchRoot(projectDir);
  if (!root) return out;
  const sub = relative(root, main.dir);
  // A project dir inside a worktree is itself a copy; don't nest further.
  if (sub.split(sep).includes('.dispatch')) return out;
  let names = [];
  try {
    names = (await readdir(join(root, '.dispatch', 'wt'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    const wtRoot = join(root, '.dispatch', 'wt', name);
    const dir = join(wtRoot, sub);
    if (!existsSync(dir)) continue;
    out.push({ key: `wt/${name}`, kind: 'worktree', label: name, folder: name, root: wtRoot, dir });
  }
  return out;
}

/** Recursive list of draw.io files (paths relative to dir, '/' separated). */
export async function scanDrawio(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(d, e.name));
      } else if (e.isFile() && isDrawio(e.name)) {
        out.push(relative(dir, join(d, e.name)).split(sep).join('/'));
      }
    }
  }
  await walk(dir);
  return out.sort();
}

export async function fileStamp(path) {
  try {
    const s = await stat(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
}

/**
 * Map worktree folder -> Dispatch session name, read-only GET of <dispatch>/api/state.
 * Matches a session whose cwd is (inside) the worktree root. Returns {} on any failure.
 */
export async function fetchSessionLabels(dispatchUrl, sources, { timeoutMs = 2000 } = {}) {
  if (!dispatchUrl) return {};
  try {
    const res = await fetch(new URL('/api/state', dispatchUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return {};
    const state = await res.json();
    const sessions = Array.isArray(state.sessions) ? state.sessions : Object.values(state.sessions ?? {});
    const labels = {};
    for (const src of sources) {
      if (src.kind !== 'worktree') continue;
      const s = sessions.find((x) => typeof x?.cwd === 'string' && (resolve(x.cwd) === src.root || resolve(x.cwd).startsWith(src.root + sep)));
      if (s && typeof s.name === 'string' && s.name) labels[src.folder] = s.name;
    }
    return labels;
  } catch {
    return {};
  }
}

