// Workspace file store: one `*.dpx.json` per diagram file, sub-folders = folders.
// Writes are atomic (temp file in the same dir + rename) and serialized; stale writes are refused by revision.
import { watch } from 'node:fs';
import { link, mkdir, readdir, readFile, rename, rm, stat, lstat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { createResolver, parseRelPath, PathError } from './paths.js';
import { FILE_EXT, newFile, normalizeContent, parseStored, ValidationError } from './model.js';

export class StoreError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const sha = (text) => createHash('sha256').update(text).digest('hex');
const isDpx = (name) => name.endsWith(FILE_EXT) && name.length > FILE_EXT.length;

export function createStore(workspaceDir, { onExternalChange, watchDebounceMs = 60 } = {}) {
  const fsr = createResolver(workspaceDir);
  const known = new Map(); // rel file path -> sha of the content we last wrote or saw
  const knownDirs = new Set();
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
    return isDpx(rel) ? rel : rel + FILE_EXT;
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
        const st = await stat(join(absDir, e.name));
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
    const abs = await wrapPath(rel);
    const file = newFile({ title: typeof title === 'string' ? title : basename(rel, FILE_EXT) });
    return serial(async () => {
      await ensureParent(abs);
      const text = serialize(file);
      await atomicWrite(abs, text, { exclusive: true });
      known.set(rel, sha(text));
      return { path: rel, ...file };
    });
  }

  async function readFileAt(rel) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    const { file } = await loadStored(abs);
    return { path: rel, ...file };
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
      const { file: current } = await loadStored(abs);
      if (current.revision !== base) {
        throw new StoreError(409, 'stale write', { revision: current.revision });
      }
      const next = { ...content, revision: current.revision + 1 };
      const text = serialize(next);
      await atomicWrite(abs, text);
      known.set(rel, sha(text));
      return { path: rel, revision: next.revision };
    });
  }

  async function createFolder(rel) {
    parseOrThrow(rel);
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

  /** Rename and move are the same operation: `to` is the full new path. */
  async function move(from, to) {
    parseOrThrow(from);
    parseOrThrow(to);
    let fromAbs = await wrapPath(from);
    const st = await statOrNull(fromAbs);
    if (!st) {
      // allow passing a file path without the extension
      from = checkedFileRel(from);
      fromAbs = await wrapPath(from);
    }
    return serial(async () => {
      const fst = await statOrNull(fromAbs);
      if (!fst) throw new StoreError(404, 'not found');
      const isDir = fst.isDirectory();
      if (!isDir && !isDpx(from)) throw new StoreError(400, 'not a workspace file');
      const toRel = isDir ? to : checkedFileRel(to);
      if (isDir && (toRel === from || toRel.startsWith(from + '/'))) throw new StoreError(400, 'cannot move a folder into itself');
      const toAbs = await wrapPath(toRel);
      if (await statOrNull(toAbs)) throw new StoreError(409, 'target already exists');
      await mkdir(dirname(toAbs), { recursive: true });
      await rename(fromAbs, toAbs);
      forget(from, isDir);
      if (isDir) {
        knownDirs.add(toRel);
        await scan(toAbs, toRel);
      } else {
        known.set(toRel, sha(await readFile(toAbs, 'utf8')));
      }
      return { path: toRel };
    });
  }

  async function remove(rel) {
    parseOrThrow(rel);
    let abs = await wrapPath(rel);
    if (!(await statOrNull(abs))) {
      rel = checkedFileRel(rel);
      abs = await wrapPath(rel);
    }
    return serial(async () => {
      const st = await statOrNull(abs);
      if (!st) throw new StoreError(404, 'not found');
      if (st.isDirectory()) await rm(abs, { recursive: true });
      else if (isDpx(rel)) await unlink(abs);
      else throw new StoreError(400, 'not a workspace file');
      forget(rel, st.isDirectory());
      return { path: rel };
    });
  }

  function forget(rel, isDir) {
    if (!isDir) return void known.delete(rel);
    knownDirs.delete(rel);
    for (const k of [...known.keys()]) if (k.startsWith(rel + '/')) known.delete(k);
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
          known.set(rel, sha(await readFile(join(absDir, e.name), 'utf8')));
        } catch {}
      }
    }
  }

  // Compare disk with what we know; only differences (= outside changes) are reported.
  async function reconcile(rel) {
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
        known.delete(rel);
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
    let text;
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      return;
    }
    const h = sha(text);
    if (known.get(rel) === h) return; // our own write
    const isNew = !known.has(rel);
    known.set(rel, h);
    let revision = null;
    try {
      revision = parseStored(text).revision;
    } catch {}
    onExternalChange?.({ kind: isNew ? 'create' : 'change', path: rel, revision });
  }

  async function startWatching() {
    await scan(fsr.root, '');
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
  }

  function close() {
    watcher?.close();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    return queue;
  }

  return { root: fsr.root, tree, createFile, readFile: readFileAt, writeFile: writeFileAt, createFolder, move, remove, startWatching, close };
}
