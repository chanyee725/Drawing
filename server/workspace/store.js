// Workspace file store: one `*.dpx.json` per diagram file, sub-folders = folders.
// Writes are atomic (temp file in the same dir + rename) and serialized; stale writes are refused by revision.
import { watch } from 'node:fs';
import { link, mkdir, readdir, readFile, rename, rm, stat, lstat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { createResolver, parseRelPath, PathError } from './paths.js';
import { FILE_EXT, FORMAT_VERSION, newFile, normalizeContent, parseStored, ValidationError } from './model.js';

export class StoreError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const sha = (text) => createHash('sha256').update(text).digest('hex');
const MAX_TOMBSTONES = 1000;
const isDpx = (name) => name.endsWith(FILE_EXT) && name.length > FILE_EXT.length;

// Version history: snapshots of saved files live in a hidden folder inside the workspace (never listed in the tree).
export const HISTORY_DIR = ['.drawing', 'history'];
export const HISTORY_INTERVAL_MS = 5 * 60 * 1000;
export const HISTORY_MAX = 50;
const SNAPSHOT_ID = /^\d{13}$/;
// Deleted files keep their version history (and last content) in `.drawing/trash/<id>/` for 30 days.
export const TRASH_DIR = ['.drawing', 'trash'];
export const TRASH_DAYS = 30;
export const TRASH_MAX = 200;
const TRASH_ID = /^\d{13}-[0-9a-f]{8}$/;

export function createStore(
  workspaceDir,
  { onExternalChange, watchDebounceMs = 60, watchFn = watch, now = Date.now, historyIntervalMs = HISTORY_INTERVAL_MS, historyMax = HISTORY_MAX } = {},
) {
  const fsr = createResolver(workspaceDir);
  const known = new Map(); // rel file path -> { hash, revision } of the content we last wrote or saw
  const knownDirs = new Set();
  // rel file path -> last revision seen before the file was deleted or moved away, so a file that
  // reappears at that path starts above it and clients holding the old revision get 409.
  const tombstones = new Map();
  let queue = Promise.resolve();
  let watcher = null;
  const timers = new Map();

  // Serialize every mutation so revision check + rename is one step.
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  const wrapPath = async (rel) => {
    try {
      return await fsr.resolve(rel);
    } catch (err) {
      if (err instanceof PathError) throw new StoreError(400, err.message);
      throw err;
    }
  };

  const fileRel = (rel) => {
    parseRelPath(rel);
    if (isDpx(rel)) return rel;
    // A typed `.dpx` suffix is dropped like in the web UI: `demo.dpx` is the file `demo.dpx.json`, not `demo.dpx.dpx.json`.
    const stem = rel.replace(/\.dpx$/i, '');
    return (stem === '' || stem.endsWith('/') ? rel : stem) + FILE_EXT;
  };
  // A folder named like a file (`x.dpx.json/`) would be confused with a file, so no path may contain one.
  const checkFolderNames = (segs) => {
    if (segs.some(isDpx)) throw new StoreError(400, `folder names cannot end with ${FILE_EXT}`);
  };
  const checkedFileRel = (rel) => {
    try {
      return fileRel(rel);
    } catch (err) {
      if (err instanceof PathError) throw new StoreError(400, err.message);
      throw err;
    }
  };

  async function atomicWrite(abs, text, { exclusive = false } = {}) {
    const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(tmp, text, { mode: 0o644 });
    try {
      if (exclusive) await link(tmp, abs); // fails with EEXIST instead of overwriting
      else await rename(tmp, abs);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      if (err.code === 'EEXIST') throw new StoreError(409, 'already exists');
      throw err;
    }
    if (exclusive) await unlink(tmp).catch(() => {});
  }

  async function statOrNull(abs) {
    try {
      return await lstat(abs);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async function ensureParent(abs) {
    await mkdir(dirname(abs), { recursive: true });
  }

  async function loadStored(abs) {
    let text;
    try {
      text = await readFile(abs, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(404, 'file not found');
      if (err.code === 'EISDIR') throw new StoreError(400, 'not a file');
      throw err;
    }
    try {
      return { text, file: parseStored(text) };
    } catch (err) {
      if (err instanceof ValidationError) throw new StoreError(422, `unreadable file: ${err.message}`);
      throw err;
    }
  }

  const serialize = (file) => JSON.stringify(file, null, 2) + '\n';

  // ---- version history ----
  // `.drawing/history/<file path>/<ms timestamp>.json` holds the file as it was on disk just before a save
  // overwrote it (the timestamp is that save's time), so the end of each edit session is kept.
  // History is a convenience: a failure here never fails the save, delete or move it belongs to.
  const historyDirOf = async (rel) => {
    try {
      return await fsr.resolveInternal(...HISTORY_DIR, ...rel.split('/'));
    } catch (err) {
      if (err instanceof PathError) throw new StoreError(400, err.message);
      throw err;
    }
  };

  async function snapshotIds(dir) {
    try {
      return (await readdir(dir)).filter((n) => n.endsWith('.json') && SNAPSHOT_ID.test(n.slice(0, -5))).map((n) => n.slice(0, -5)).sort();
    } catch {
      return [];
    }
  }

  const sameContent = (a, b) => {
    try {
      const { revision: _a, ...x } = parseStored(a);
      const { revision: _b, ...y } = parseStored(b);
      return JSON.stringify(x) === JSON.stringify(y);
    } catch {
      return false;
    }
  };

  // Keep `text` as a snapshot of `rel` unless the newest one is younger than the interval (or `force`) or has the same content.
  async function snapshot(rel, text, { force = false } = {}) {
    const dir = await historyDirOf(rel);
    const ids = await snapshotIds(dir);
    const last = ids[ids.length - 1];
    if (last !== undefined) {
      if (!force && now() - Number(last) < historyIntervalMs) return null;
      try {
        if (sameContent(await readFile(join(dir, `${last}.json`), 'utf8'), text)) return last;
      } catch {}
    }
    let id = Math.max(now(), last === undefined ? 0 : Number(last) + 1);
    id = String(id).padStart(13, '0');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.json`), text, { mode: 0o644 });
    ids.push(id);
    for (const old of ids.slice(0, Math.max(0, ids.length - historyMax))) await unlink(join(dir, `${old}.json`)).catch(() => {});
    return id;
  }

  const snapshotQuietly = (rel, text) => snapshot(rel, text).catch(() => null);

  async function history(rel) {
    rel = checkedFileRel(rel);
    await wrapPath(rel);
    const dir = await historyDirOf(rel);
    const versions = [];
    for (const id of (await snapshotIds(dir)).reverse()) {
      try {
        const st = await lstat(join(dir, `${id}.json`));
        if (st.isFile()) versions.push({ id, time: Number(id), bytes: st.size });
      } catch {}
    }
    return { path: rel, versions };
  }

  async function historyVersion(rel, id) {
    rel = checkedFileRel(rel);
    await wrapPath(rel);
    if (typeof id !== 'string' || !SNAPSHOT_ID.test(id)) throw new StoreError(400, 'invalid version id');
    const dir = await historyDirOf(rel);
    let text;
    try {
      // The snapshot itself must be a plain file: a link there could point at anything the server can read.
      const st = await lstat(join(dir, `${id}.json`));
      if (!st.isFile()) throw new StoreError(404, 'version not found');
      text = await readFile(join(dir, `${id}.json`), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(404, 'version not found');
      throw err;
    }
    try {
      return { path: rel, id, time: Number(id), ...parseStored(text) };
    } catch (err) {
      if (err instanceof ValidationError) throw new StoreError(422, `unreadable version: ${err.message}`);
      throw err;
    }
  }

  // Snapshot what is on disk now, ignoring the interval (before a restore).
  async function historySnapshotNow(rel) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const { text } = await loadStored(abs);
      return { path: rel, id: await snapshot(rel, text, { force: true }) };
    });
  }

  // A file or folder moved: its history moves with it (best effort); one deleted: its history goes too.
  async function moveHistory(from, to) {
    try {
      const fromDir = await historyDirOf(from);
      if (!(await statOrNull(fromDir))) return;
      const toDir = await historyDirOf(to);
      await rm(toDir, { recursive: true, force: true });
      await mkdir(dirname(toDir), { recursive: true });
      await rename(fromDir, toDir);
    } catch {}
  }
  const dropHistory = (rel) => historyDirOf(rel).then((d) => rm(d, { recursive: true, force: true })).catch(() => {});

  // ---- trash: deleted files stay restorable for TRASH_DAYS ----
  // `.drawing/trash/<ms>-<hex>/` holds `meta.json` {path, deletedAt}, `file.json` (the content when we saw it go)
  // and `history/` (the file's snapshots). Like history, trash is best effort and never fails a delete.
  const trashRoot = () => fsr.resolveInternal(...TRASH_DIR);
  const entryDir = async (id) => {
    if (typeof id !== 'string' || !TRASH_ID.test(id)) throw new StoreError(400, 'invalid trash id');
    return fsr.resolveInternal(...TRASH_DIR, id);
  };
  const plainFile = async (abs) => (await statOrNull(abs))?.isFile() === true;

  // Move `rel`'s history (and `text`, if known) into a new trash entry. Without text, the newest snapshot stands in on restore.
  // Returns the new entry's id (or null). Pass `purge: false` when deleting many files at once and call
  // `purgeTrash(keepIds)` once afterwards, so the entries just made are never the ones dropped.
  async function trashQuietly(rel, text, { purge = true } = {}) {
    try {
      const histDir = await historyDirOf(rel);
      const hasHistory = (await snapshotIds(histDir)).length > 0;
      if (text == null && !hasHistory) return null;
      const t = now();
      const id = `${String(t).padStart(13, '0')}-${randomBytes(4).toString('hex')}`;
      const dir = join(await trashRoot(), id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ path: rel, deletedAt: t }) + '\n', { mode: 0o644 });
      if (text != null) await writeFile(join(dir, 'file.json'), text, { mode: 0o644 });
      if (hasHistory) await rename(histDir, join(dir, 'history'));
      await rm(histDir, { recursive: true, force: true });
      if (purge) await purgeTrash([id]);
      return id;
    } catch {
      return null;
    }
  }

  // Trash every file of one delete, then purge once, sparing what this delete just made.
  async function trashMany(items) {
    const ids = [];
    for (const [rel, text] of items) ids.push(await trashQuietly(rel, text, { purge: false }));
    await purgeTrash(ids.filter(Boolean)).catch(() => {});
  }

  async function readEntry(root, id) {
    const dir = join(root, id);
    try {
      if (!(await lstat(dir)).isDirectory() || !(await plainFile(join(dir, 'meta.json')))) return null;
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
      if (typeof meta?.path !== 'string' || !Number.isFinite(meta.deletedAt)) return null;
      parseRelPath(meta.path);
      return { id, dir, path: meta.path, deletedAt: meta.deletedAt };
    } catch {
      return null;
    }
  }

  async function trashEntries() {
    let root;
    try {
      root = await trashRoot();
    } catch {
      return [];
    }
    let names;
    try {
      names = (await readdir(root)).filter((n) => TRASH_ID.test(n)).sort();
    } catch {
      return [];
    }
    const out = [];
    for (const id of names) {
      const e = await readEntry(root, id);
      if (e) out.push(e);
      else await rm(join(root, id), { recursive: true, force: true }).catch(() => {}); // not ours or damaged
    }
    return out;
  }

  // Drop entries older than 30 days, and the oldest beyond TRASH_MAX. Ids in `spare` (made by the delete in
  // progress) are never dropped, even past the cap; the next ordinary purge trims the excess.
  async function purgeTrash(spare = [], { cap = true } = {}) {
    const entries = await trashEntries();
    const cutoff = now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
    const keep = entries.filter((e) => e.deletedAt >= cutoff);
    const spared = new Set(spare);
    const droppable = keep.filter((e) => !spared.has(e.id));
    const drop = [...entries.filter((e) => e.deletedAt < cutoff && !spared.has(e.id)), ...droppable.slice(0, Math.max(0, cap ? keep.length - TRASH_MAX : 0))];
    for (const e of drop) await rm(e.dir, { recursive: true, force: true }).catch(() => {});
  }

  async function trash() {
    return serial(async () => {
      await purgeTrash([], { cap: false }).catch(() => {}); // listing only ages entries out; the cap is enforced when something is deleted
      const items = (await trashEntries()).map((e) => ({ id: e.id, path: e.path, deletedAt: e.deletedAt })).reverse();
      return { items };
    });
  }

  async function restoreTrash(id) {
    return serial(async () => {
      const dir = await entryDir(id);
      const entry = await readEntry(join(dir, '..'), id);
      if (!entry) throw new StoreError(404, 'not in the trash');
      const rel = entry.path;
      if (!isDpx(rel)) throw new StoreError(404, 'not in the trash');
      checkFolderNames(rel.split('/').slice(0, -1));
      const abs = await wrapPath(rel);
      if (await statOrNull(abs)) throw new StoreError(409, 'a file already exists at that path');
      const histDir = join(dir, 'history');
      const hasHist = (await statOrNull(histDir))?.isDirectory() === true;
      let text = null;
      if (await plainFile(join(dir, 'file.json'))) text = await readFile(join(dir, 'file.json'), 'utf8');
      else if (hasHist) {
        const ids = await snapshotIds(histDir);
        for (const sid of ids.reverse()) {
          if (await plainFile(join(histDir, `${sid}.json`))) {
            text = await readFile(join(histDir, `${sid}.json`), 'utf8');
            break;
          }
        }
      }
      if (text == null) throw new StoreError(422, 'nothing left to restore');
      let file;
      try {
        file = parseStored(text);
      } catch (err) {
        if (err instanceof ValidationError) throw new StoreError(422, `unreadable file: ${err.message}`);
        throw err;
      }
      await ensureParent(abs);
      // Start above the revision the path had when it was deleted, so a stale tab cannot overwrite the restored file.
      const floor = tombstones.get(rel) ?? 0;
      if (file.revision <= floor && file.version <= FORMAT_VERSION) text = serialize({ ...file, revision: floor + 1 });
      await atomicWrite(abs, text, { exclusive: true });
      await adopt(rel, abs);
      if (hasHist) await mergeHistory(histDir, await historyDirOf(rel));
      await rm(dir, { recursive: true, force: true });
      for (let d = dirname(rel); d !== '.'; d = dirname(d)) knownDirs.add(d);
      onExternalChange?.({ kind: 'tree', path: rel });
      return { path: rel };
    });
  }

  // Put trashed snapshots back; ids that are taken (a new file got history at that path) move to the next free id.
  async function mergeHistory(fromDir, toDir) {
    await mkdir(toDir, { recursive: true });
    const taken = new Set(await snapshotIds(toDir));
    for (const id of await snapshotIds(fromDir)) {
      if (!(await plainFile(join(fromDir, `${id}.json`)))) continue;
      let next = id;
      while (taken.has(next)) next = String(Number(next) + 1).padStart(13, '0');
      taken.add(next);
      await rename(join(fromDir, `${id}.json`), join(toDir, `${next}.json`)).catch(() => {});
    }
  }

  // Every diagram file under a folder (rel path + content), read before the folder goes away.
  async function collectFiles(absDir, relDir) {
    const out = [];
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const rel = `${relDir}/${e.name}`;
      if (e.isDirectory()) out.push(...(await collectFiles(join(absDir, e.name), rel)));
      else if (e.isFile() && isDpx(e.name)) out.push({ rel, text: await readFile(join(absDir, e.name), 'utf8').catch(() => null) });
    }
    return out;
  }

  // ---- tree ----
  async function walk(absDir, relDir) {
    const out = [];
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return out;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ type: 'folder', name: e.name, path: rel, children: await walk(join(absDir, e.name), rel) });
      } else if (e.isFile() && isDpx(e.name)) {
        let title = '';
        let revision = null;
        try {
          const f = parseStored(await readFile(join(absDir, e.name), 'utf8'));
          title = f.title;
          revision = f.revision;
        } catch {
          // unreadable file still shows up so it can be renamed or deleted
        }
        let st;
        try {
          st = await stat(join(absDir, e.name));
        } catch {
          continue; // removed or unreadable between readdir and stat
        }
        out.push({ type: 'file', name: e.name, path: rel, title, revision, mtime: st.mtime.toISOString() });
      }
    }
    // folders first
    return out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1));
  }

  const tree = () => walk(fsr.root, '');

  // ---- file operations ----
  async function createFile(rel, { title } = {}) {
    rel = checkedFileRel(rel);
    checkFolderNames(rel.split('/').slice(0, -1));
    const abs = await wrapPath(rel);
    const fresh = newFile({ title: typeof title === 'string' ? title : basename(rel, FILE_EXT) });
    return serial(async () => {
      await ensureParent(abs);
      const file = { ...fresh, revision: Math.max(fresh.revision, (tombstones.get(rel) ?? 0) + 1) };
      const text = serialize(file);
      await atomicWrite(abs, text, { exclusive: true });
      known.set(rel, { hash: sha(text), revision: file.revision });
      tombstones.delete(rel);
      return { path: rel, ...file };
    });
  }

  async function readFileAt(rel) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const { file } = await syncExternal(rel, await loadStored(abs), abs);
      return { path: rel, ...file };
    });
  }

  // If the file was edited outside without raising its revision, raise it here so a client that
  // loaded the old content cannot overwrite the outside edit with a "current" revision.
  async function syncExternal(rel, loaded, abs) {
    const k = known.get(rel) ?? (tombstones.has(rel) ? { hash: null, revision: tombstones.get(rel) } : null);
    const h = sha(loaded.text);
    if (!k || k.hash === h) return loaded;
    // A newer format than this server knows is read-only: rewriting it would store it back as ours.
    if (loaded.file.version > FORMAT_VERSION) return loaded;
    let file = loaded.file;
    let text = loaded.text;
    if (file.revision <= k.revision) {
      file = { ...file, revision: k.revision + 1 };
      text = serialize(file);
      await atomicWrite(abs, text);
    }
    known.set(rel, { hash: sha(text), revision: file.revision });
    tombstones.delete(rel);
    return { text, file };
  }

  async function writeFileAt(rel, body) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    const base = body?.revision;
    if (!Number.isInteger(base) || base < 1) throw new StoreError(400, 'revision (the revision you loaded) is required');
    let content;
    try {
      content = normalizeContent(body);
    } catch (err) {
      if (err instanceof ValidationError) throw new StoreError(400, err.message);
      throw err;
    }
    return serial(async () => {
      const { file: current, text: before } = await syncExternal(rel, await loadStored(abs), abs);
      // A newer format than this server knows: writing would store it back as ours and drop what it added.
      if (current.version > FORMAT_VERSION) throw new StoreError(422, '더 새 버전에서 만든 파일이라 저장하지 않았어요');
      if (current.revision !== base) {
        throw new StoreError(409, 'stale write', { revision: current.revision });
      }
      const next = { ...content, revision: current.revision + 1 };
      const text = serialize(next);
      // Keep what is on disk before overwriting it, so the end state of an edit session stays reachable.
      await snapshotQuietly(rel, before);
      await atomicWrite(abs, text);
      known.set(rel, { hash: sha(text), revision: next.revision });
      return { path: rel, revision: next.revision };
    });
  }

  async function createFolder(rel) {
    parseOrThrow(rel);
    checkFolderNames(rel.split('/'));
    const abs = await wrapPath(rel);
    return serial(async () => {
      if (await statOrNull(abs)) throw new StoreError(409, 'already exists');
      await mkdir(abs, { recursive: true });
      knownDirs.add(rel);
      return { path: rel };
    });
  }

  function parseOrThrow(rel) {
    try {
      parseRelPath(rel);
    } catch (err) {
      if (err instanceof PathError) throw new StoreError(400, err.message);
      throw err;
    }
  }

  /**
   * Rename and move are the same operation: `to` is the full new path.
   * `type` is 'file' | 'folder'. Without it a file wins: `from` is tried as a file
   * (extension optional) first, then as a folder.
   */
  async function move(from, to, type) {
    parseOrThrow(from);
    parseOrThrow(to);
    if (type !== undefined && type !== 'file' && type !== 'folder') throw new StoreError(400, 'type must be "file" or "folder"');
    return serial(async () => {
      if (type !== 'folder') {
        const fileFrom = checkedFileRel(from);
        const fromAbs = await wrapPath(fileFrom);
        const st = await statOrNull(fromAbs);
        if (st?.isFile()) return moved(from, await moveFile(fileFrom, fromAbs, checkedFileRel(to)));
        if (type === 'file') throw new StoreError(404, 'not found');
      }
      const fromAbs = await wrapPath(from);
      const st = await statOrNull(fromAbs);
      if (!st?.isDirectory()) throw new StoreError(404, 'not found');
      return moved(from, await moveFolder(from, fromAbs, to));
    });
  }

  // A move or rename through the API tells other tabs where the thing went; `from` is the path as the caller wrote it.
  function moved(from, result) {
    onExternalChange?.({ kind: 'tree', path: result.path, from });
    return result;
  }

  async function moveFile(from, fromAbs, toRel) {
    checkFolderNames(toRel.split('/').slice(0, -1));
    const toAbs = await wrapPath(toRel);
    if (await statOrNull(toAbs)) throw new StoreError(409, 'target already exists');
    await mkdir(dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
    forget(from, false);
    await adopt(toRel, toAbs);
    await moveHistory(from, toRel);
    return { path: toRel };
  }

  async function moveFolder(from, fromAbs, toRel) {
    checkFolderNames(toRel.split('/'));
    if (toRel === from || toRel.startsWith(from + '/')) throw new StoreError(400, 'cannot move a folder into itself');
    const toAbs = await wrapPath(toRel);
    if (await statOrNull(toAbs)) throw new StoreError(409, 'target already exists');
    await mkdir(dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
    forget(from, true);
    knownDirs.add(toRel);
    await scan(toAbs, toRel);
    await moveHistory(from, toRel);
    return { path: toRel };
  }

  async function knownEntry(abs) {
    const text = await readFile(abs, 'utf8');
    let revision = 0;
    try {
      revision = parseStored(text).revision;
    } catch {}
    return { hash: sha(text), revision };
  }

  // Record a file that arrived at `rel` by a move; raise its revision above a tombstone there.
  async function adopt(rel, abs) {
    const entry = await knownEntry(abs);
    const floor = tombstones.get(rel);
    if (floor !== undefined && entry.revision > 0 && entry.revision <= floor) {
      const file = { ...parseStored(await readFile(abs, 'utf8')), revision: floor + 1 };
      const text = serialize(file);
      await atomicWrite(abs, text);
      known.set(rel, { hash: sha(text), revision: file.revision });
    } else {
      known.set(rel, floor !== undefined && entry.revision === 0 ? { ...entry, revision: floor } : entry);
    }
    tombstones.delete(rel);
  }

  async function removeFile(rel) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const st = await statOrNull(abs);
      if (!st?.isFile()) throw new StoreError(404, 'file not found');
      const text = await readFile(abs, 'utf8').catch(() => null);
      await unlink(abs);
      forget(rel, false);
      await trashQuietly(rel, text);
      onExternalChange?.({ kind: 'delete', path: rel }); // other tabs learn about it (our own saves stay silent)
      return { path: rel };
    });
  }

  async function removeFolder(rel) {
    parseOrThrow(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const st = await statOrNull(abs);
      if (!st?.isDirectory()) throw new StoreError(404, 'folder not found');
      const files = await collectFiles(abs, rel);
      await rm(abs, { recursive: true });
      forget(rel, true);
      await trashMany(files.map((f) => [f.rel, f.text]));
      await dropHistory(rel); // what is left belongs to files that were already gone
      // `from`: other tabs with a file under this folder open must close it (same shape as a folder move).
      onExternalChange?.({ kind: 'tree', path: rel, from: rel });
      return { path: rel };
    });
  }

  function forget(rel, isDir) {
    const bury = (k) => {
      const e = known.get(k);
      if (!e) return;
      const floor = Math.max(e.revision, tombstones.get(k) ?? 0);
      tombstones.delete(k); // re-insert so the newest burials are the last to go
      tombstones.set(k, floor);
      // Bounded: only the most recent deletions keep a revision floor.
      if (tombstones.size > MAX_TOMBSTONES) tombstones.delete(tombstones.keys().next().value);
      known.delete(k);
    };
    if (!isDir) return void bury(rel);
    knownDirs.delete(rel);
    for (const k of [...known.keys()]) if (k.startsWith(rel + '/')) bury(k);
    for (const k of [...knownDirs]) if (k.startsWith(rel + '/')) knownDirs.delete(k);
  }

  // ---- watching ----
  async function scan(absDir, relDir) {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        knownDirs.add(rel);
        await scan(join(absDir, e.name), rel);
      } else if (e.isFile() && isDpx(e.name)) {
        try {
          await adopt(rel, join(absDir, e.name));
        } catch {}
      }
    }
  }

  // Compare disk with what we know; only differences (= outside changes) are reported.
  const reconcile = (rel) => serial(() => reconcileNow(rel));
  async function reconcileNow(rel) {
    let segs;
    try {
      segs = parseRelPath(rel);
    } catch {
      return; // hidden / temp names
    }
    const abs = join(fsr.root, ...segs);
    const st = await statOrNull(abs);
    if (st?.isSymbolicLink()) return;
    if (!st) {
      if (known.has(rel)) {
        forget(rel, false);
        await trashQuietly(rel, null); // deleted outside: keep its history out of reach of a new file at this path
        onExternalChange?.({ kind: 'delete', path: rel });
      } else if (knownDirs.has(rel)) {
        const gone = [...known.keys()].filter((k) => k.startsWith(rel + '/'));
        forget(rel, true);
        await trashMany(gone.map((k) => [k, null]));
        onExternalChange?.({ kind: 'tree', path: rel, from: rel });
      }
      return;
    }
    if (st.isDirectory()) {
      if (!knownDirs.has(rel)) {
        knownDirs.add(rel);
        onExternalChange?.({ kind: 'tree', path: rel });
      }
      return;
    }
    if (!st.isFile() || !isDpx(rel)) return;
    let loaded;
    try {
      const text = await readFile(abs, 'utf8');
      try {
        loaded = { text, file: parseStored(text) };
      } catch {
        loaded = { text, file: null };
      }
    } catch {
      return;
    }
    const prev = known.get(rel);
    if (prev?.hash === sha(loaded.text)) return; // our own write
    const floor = prev?.revision ?? tombstones.get(rel);
    if (!loaded.file || floor === undefined) {
      known.set(rel, { hash: sha(loaded.text), revision: loaded.file?.revision ?? floor ?? 0 });
      tombstones.delete(rel);
      onExternalChange?.({ kind: prev ? 'change' : 'create', path: rel, revision: loaded.file?.revision ?? null });
      return;
    }
    const { file } = await syncExternal(rel, loaded, abs); // raises the revision if the editor did not
    onExternalChange?.({ kind: prev ? 'change' : 'create', path: rel, revision: file.revision });
  }

  async function startWatching() {
    await scan(fsr.root, '');
    try {
      watcher = watchFn(fsr.root, { recursive: true }, (_ev, filename) => {
        if (!filename) return;
        const rel = String(filename).split('\\').join('/');
        clearTimeout(timers.get(rel));
        timers.set(rel, setTimeout(() => {
          timers.delete(rel);
          reconcile(rel).catch(() => {});
        }, watchDebounceMs));
      });
      // Errors after start (the root removed, watch limit hit, ...) arrive here. Log the code once, no path.
      let warned = false;
      watcher.on('error', (err) => {
        if (warned) return;
        warned = true;
        console.warn(`workspace: watching for outside changes failed (${err?.code ?? 'error'})`);
      });
    } catch (err) {
      // EACCES, ENOSPC (watch limit), ...: the app still works, outside edits are just not noticed until a file is read or saved. No path in the log.
      console.warn(`workspace: not watching for outside changes (${err?.code ?? 'error'})`);
    }
  }

  function close() {
    watcher?.close();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    return queue;
  }

  return { root: fsr.root, tree, createFile, readFile: readFileAt, writeFile: writeFileAt, createFolder, move, removeFile, removeFolder, trash, restoreTrash, history, historyVersion, historySnapshotNow, startWatching, close };
}
