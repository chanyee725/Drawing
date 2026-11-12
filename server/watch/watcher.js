// Watches draw.io files across sources by polling stat (mtime+size). Polling is
// portable, needs no dependency and avoids recursive inotify over large trees.
// A file is processed only after its stamp has been stable for `quietMs` and it
// parses cleanly, so a script writing in pieces yields one change.
// Read-only: never writes to watched files. Logs no file content.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseDrawio } from './parse.js';
import { diffFiles } from './diff.js';
import { listSources, scanDrawio, fileStamp, fetchSessionLabels } from './sources.js';

export const HISTORY_LIMIT = 500;
const GIVE_UP_MS = 10_000; // stop retrying a file that stays unparseable

export function fileId(sourceKey, path) {
  return createHash('sha1').update(`${sourceKey}\0${path}`).digest('hex').slice(0, 12);
}

/**
 * @param {{ projectDir: string, dispatch?: string|null, pollMs?: number, quietMs?: number,
 *           rescanMs?: number, labelMs?: number, now?: () => number,
 *           onFile?: (entry) => void, onChange?: (change) => void }} opts
 */
export function createWatcher(opts) {
  const { projectDir, dispatch = null, pollMs = 250, quietMs = 300, rescanMs = 3000, labelMs = 10_000 } = opts;
  const now = opts.now ?? Date.now;
  const sources = new Map(); // key -> source
  const files = new Map(); // id -> record
  const listeners = new Set();
  const fileListeners = new Set();
  if (opts.onChange) listeners.add(opts.onChange);
  if (opts.onFile) fileListeners.add(opts.onFile);
  let timers = [];
  let busy = false;
  let lastRescan = 0;

  function entry(f) {
    return {
      id: f.id,
      path: f.path,
      source: { kind: f.source.kind, label: f.source.label },
      pages: (f.parsed?.pages ?? []).map((p) => ({ id: p.id, name: p.name })),
      ...(f.deleted ? { deleted: true } : {}),
    };
  }

  async function rescan(initial) {
    lastRescan = now();
    const list = await listSources(projectDir);
    const keys = new Set(list.map((s) => s.key));
    for (const s of list) {
      const cur = sources.get(s.key);
      if (cur) Object.assign(cur, { dir: s.dir, root: s.root });
      else sources.set(s.key, s);
    }
    for (const k of [...sources.keys()]) if (!keys.has(k)) sources.delete(k);

    const seen = new Set();
    for (const src of sources.values()) {
      for (const path of await scanDrawio(src.dir)) {
        const id = fileId(src.key, path);
        seen.add(id);
        if (files.has(id) && !files.get(id).deleted) continue;
        const f = { id, path, source: src, abs: join(src.dir, path), stamp: null, parsed: null, history: files.get(id)?.history ?? [], pending: null };
        files.set(id, f);
        if (initial) {
          await loadInitial(f);
        } else {
          f.pending = { stamp: await fileStamp(f.abs), since: now() };
        }
      }
    }
    for (const f of files.values()) {
      if (seen.has(f.id) || f.deleted) continue;
      if (!sources.has(f.source.key) || (await fileStamp(f.abs)) === null) await markDeleted(f);
    }
  }

  async function loadInitial(f) {
    f.stamp = await fileStamp(f.abs);
    try {
      f.parsed = parseDrawio(await readFile(f.abs, 'utf8'));
    } catch {
      f.parsed = null; // retried on next stamp change
      f.pending = { stamp: f.stamp, since: now() };
    }
  }

  async function markDeleted(f) {
    const before = f.parsed;
    f.deleted = true;
    f.parsed = null;
    f.stamp = null;
    f.pending = null;
    emitFile(f);
    record(f, diffFiles(before, null));
  }

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      if (now() - lastRescan >= rescanMs) await rescan(false);
      for (const f of files.values()) {
        if (f.deleted) continue;
        const stamp = await fileStamp(f.abs);
        if (stamp === null) continue; // rescan handles removal
        if (stamp !== f.stamp && (!f.pending || f.pending.stamp !== stamp)) {
          f.pending = { stamp, since: now() };
          continue;
        }
        if (f.pending && now() - f.pending.since >= quietMs) await processFile(f);
      }
    } finally {
      busy = false;
    }
  }

  async function processFile(f) {
    const { stamp, since } = f.pending;
    let parsed;
    try {
      parsed = parseDrawio(await readFile(f.abs, 'utf8'));
    } catch {
      // Half-written or broken: wait for the next write, give up after a while.
      if (now() - since >= GIVE_UP_MS) {
        f.stamp = stamp;
        f.pending = null;
      }
      return;
    }
    // Re-check that nothing changed while reading.
    if ((await fileStamp(f.abs)) !== stamp) return;
    const before = f.parsed;
    const isNew = f.stamp === null && before === null;
    f.stamp = stamp;
    f.parsed = parsed;
    f.pending = null;
    if (isNew) emitFile(f);
    const pagesChanged = !before || before.pages.map((p) => `${p.id}\0${p.name}`).join() !== parsed.pages.map((p) => `${p.id}\0${p.name}`).join();
    if (pagesChanged && !isNew) emitFile(f);
    record(f, diffFiles(before, parsed));
  }

  function record(f, diffs) {
    const at = now();
    for (const d of diffs) {
      const change = {
        fileId: f.id,
        path: f.path,
        relPath: f.path,
        source: { kind: f.source.kind, label: f.source.label, dir: f.source.dir },
        page: d.page,
        kinds: d.kinds,
        cellIds: d.cellIds,
        bbox: d.bbox,
        summary: d.summary,
        at,
      };
      f.history.push(change);
      if (f.history.length > HISTORY_LIMIT) f.history.splice(0, f.history.length - HISTORY_LIMIT);
      for (const fn of listeners) {
        try {
          fn(change);
        } catch (err) {
          console.error('watch: change listener failed:', err.message);
        }
      }
    }
  }

  function emitFile(f) {
    const e = entry(f);
    for (const fn of fileListeners) {
      try {
        fn(e);
      } catch (err) {
        console.error('watch: file listener failed:', err.message);
      }
    }
  }

  async function refreshLabels() {
    const labels = await fetchSessionLabels(dispatch, [...sources.values()]);
    for (const s of sources.values()) {
      if (s.kind !== 'worktree') continue;
      const label = labels[s.folder] ?? s.folder;
      if (label === s.label) continue;
      s.label = label;
      for (const f of files.values()) if (f.source === s && !f.deleted) emitFile(f);
    }
  }

  return {
    async start() {
      await rescan(true);
      await refreshLabels();
      timers.push(setInterval(() => poll().catch((e) => console.error('watch: poll failed:', e.message)), pollMs));
      if (dispatch) timers.push(setInterval(() => refreshLabels().catch(() => {}), labelMs));
      for (const t of timers) t.unref?.();
    },
    poll,
    stop() {
      for (const t of timers) clearInterval(t);
      timers = [];
    },
    listFiles: () => [...files.values()].filter((f) => !f.deleted).map(entry),
    getFile(id) {
      const f = files.get(id);
      if (!f || f.deleted) return null;
      return { ...entry(f), pages: (f.parsed?.pages ?? []).map((p) => ({ id: p.id, name: p.name, xml: p.xml })) };
    },
    getParsed: (id) => files.get(id)?.parsed ?? null,
    history: (id) => (files.has(id) ? files.get(id).history.slice() : null),
    listSources: () => [...sources.values()].map((s) => ({ kind: s.kind, label: s.label, dir: s.dir })),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onFile(fn) {
      fileListeners.add(fn);
      return () => fileListeners.delete(fn);
    },
  };
}
