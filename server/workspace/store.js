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

export function createStore(workspaceDir, { onExternalChange, watchDebounceMs = 60 } = {}) {
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
      const { file: current } = await syncExternal(rel, await loadStored(abs), abs);
      // A newer format than this server knows: writing would store it back as ours and drop what it added.
      if (current.version > FORMAT_VERSION) throw new StoreError(422, '더 새 버전에서 만든 파일이라 저장하지 않았어요');
      if (current.revision !== base) {
        throw new StoreError(409, 'stale write', { revision: current.revision });
      }
      const next = { ...content, revision: current.revision + 1 };
      const text = serialize(next);
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
      await unlink(abs);
      forget(rel, false);
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
      await rm(abs, { recursive: true });
      forget(rel, true);
      onExternalChange?.({ kind: 'tree', path: rel });
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
        onExternalChange?.({ kind: 'delete', path: rel });
      } else if (knownDirs.has(rel)) {
        forget(rel, true);
        onExternalChange?.({ kind: 'tree', path: rel });
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
      watcher = watch(fsr.root, { recursive: true }, (_ev, filename) => {
        if (!filename) return;
        const rel = String(filename).split('\\').join('/');
        clearTimeout(timers.get(rel));
        timers.set(rel, setTimeout(() => {
          timers.delete(rel);
          reconcile(rel).catch(() => {});
        }, watchDebounceMs));
      });
      watcher.on('error', () => {});
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

  return { root: fsr.root, tree, createFile, readFile: readFileAt, writeFile: writeFileAt, createFolder, move, removeFile, removeFolder, startWatching, close };
}
