// Agent model: whitelist Dispatch session fields, map sessions to worktree folders,
// and attribute file changes to agents. Pure functions plus a small store.
// Paths are computed from the Dispatch root (where `.dispatch/` lives), which may be
// an ancestor of the project dir given on the command line.
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { findDispatchRoot } from './root.js';

const MAX_ACTIVITY = 140;
const MAX_CELL_IDS = 50;

/** One short line of what the session is doing: the live tool label, else the first line of its last message. */
export function activityLine(s) {
  const label = typeof s.activity?.label === 'string' ? s.activity.label : '';
  const text = label || (typeof s.last === 'string' ? s.last : '');
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const flat = first.replace(/\s+/g, ' ');
  return flat.length > MAX_ACTIVITY ? `${flat.slice(0, MAX_ACTIVITY - 1)}…` : flat;
}

/**
 * Folder whose files this session edits, relative to the Dispatch root `root`:
 * 1. the session's cwd when inside the root (worktree or main checkout);
 * 2. the session's `worktree` field when it names a folder (path inside the root, or a folder name);
 * 3. `<root>/.dispatch/wt/<x>` guessed from a `dispatch/<x>` branch; else null.
 */
export function worktreeDirFor(s, root) {
  root = resolve(root);
  if (typeof s.cwd === 'string' && s.cwd && isAbsolute(s.cwd)) {
    const cwd = resolve(s.cwd);
    if (isInside(cwd, root)) return cwd;
  }
  const wt = typeof s.worktree === 'string' ? s.worktree : '';
  if (wt && isAbsolute(wt)) {
    const dir = resolve(wt);
    if (isInside(dir, root)) return dir;
  } else if (SAFE_NAME.test(wt)) {
    return join(root, '.dispatch', 'wt', wt);
  }
  const m = typeof s.branch === 'string' && s.branch.match(/^dispatch\/(.+)$/);
  if (m && SAFE_NAME.test(m[1])) return join(root, '.dispatch', 'wt', m[1]);
  return null;
}

// A single folder name: no separators, not `.` or `..`.
const SAFE_NAME = /^\w[\w.-]*$/;

/** Keep only names, roles, status and activity. Never prompts, transcripts, usage, cost or ids of provider sessions. */
export function toAgent(s, root) {
  return {
    id: String(s.id),
    name: String(s.name ?? ''),
    role: String(s.role ?? ''),
    roleName: String(s.roleName ?? s.role ?? ''),
    model: String(s.modelLabel ?? s.model ?? ''),
    status: String(s.status ?? ''),
    state: String(s.state ?? ''),
    branch: String(s.branch ?? ''),
    dir: worktreeDirFor(s, root), // internal only; list() leaves it out
    activity: activityLine(s),
    activityAt: Number(s.activity?.since ?? s.updatedAt ?? 0) || null,
  };
}

export function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(sep));
}

/**
 * Agent store. Holds agents by id plus each agent's last change.
 * onUpdate() is called whenever something visible changed.
 */
export function createAgentStore(projectDir, onUpdate = () => {}, { root = findDispatchRoot(projectDir) ?? resolve(projectDir) } = {}) {
  const agents = new Map(); // id -> agent
  const lastChange = new Map(); // id -> change summary (survives session refreshes)

  function list() {
    // Absolute folders stay server-side; the web only needs names and status.
    return [...agents.values()].map(({ dir, ...a }) => ({ ...a, lastChange: lastChange.get(a.id) ?? null }));
  }

  function replaceAll(sessions) {
    agents.clear();
    for (const s of sessions ?? []) if (s && s.id != null) agents.set(String(s.id), toAgent(s, root));
    for (const id of lastChange.keys()) if (!agents.has(id)) lastChange.delete(id);
    onUpdate();
  }

  function upsert(s) {
    if (!s || s.id == null) return;
    agents.set(String(s.id), toAgent(s, root));
    onUpdate();
  }

  function remove(id) {
    agents.delete(String(id));
    lastChange.delete(String(id));
    onUpdate();
  }

  /**
   * Which agent edits files under `dir`. The deepest matching folder wins, so a worktree
   * under `.dispatch/wt/` beats a session working in the project root. Returns null if none,
   * or if several sessions share the winning folder (ambiguous).
   */
  function agentForDir(dir) {
    if (!dir) return null;
    const target = resolve(dir);
    let best = null;
    let bestLen = -1;
    let tie = false;
    for (const a of agents.values()) {
      if (!a.dir || !isInside(target, a.dir)) continue;
      if (a.dir.length > bestLen) {
        best = a;
        bestLen = a.dir.length;
        tie = false;
      } else if (a.dir.length === bestLen) {
        // Prefer a live session over a finished one sharing the folder.
        const live = (x) => x.status === 'running' || x.status === 'waiting' || x.status === 'starting';
        if (live(a) && !live(best)) best = a;
        else if (live(a) === live(best)) tie = true;
      }
    }
    return tie ? null : best;
  }

  /** Attribute a watch change to an agent. Returns the agent id or null. */
  function attribute(change) {
    const a = agentForDir(change?.source?.dir);
    if (!a) return null;
    lastChange.set(a.id, {
      fileId: change.fileId ?? null,
      relPath: change.relPath ?? null,
      source: change.source?.label ?? null,
      page: change.page ? { id: change.page.id ?? null, name: change.page.name ?? null } : null,
      kinds: Array.isArray(change.kinds) ? change.kinds.slice(0, 10) : [],
      cellIds: Array.isArray(change.cellIds) ? change.cellIds.slice(0, MAX_CELL_IDS) : [],
      bbox: change.bbox ?? null,
      summary: typeof change.summary === 'string' ? change.summary.slice(0, 200) : '',
      at: change.at ?? Date.now(),
    });
    onUpdate();
    return a.id;
  }

  return { root, list, replaceAll, upsert, remove, agentForDir, attribute };
}
