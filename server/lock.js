// One-server locks (E13): a small JSON file { pid, port } that says which server owns a folder.
// `<workspace>/.drawing/server.lock` keeps two Drawing servers off one workspace;
// `<project>/.dispatch/drawing.lock` keeps two Dispatch modules off one project's `.dispatch/`.
// A lock whose owner is gone (dead pid, or its port no longer answers as that server) is stale and
// gets replaced, so a crash never blocks the next start.
import { readFileSync, unlinkSync } from 'node:fs';
import { link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

const HOST = '127.0.0.1';

/** True when a process with this pid exists (EPERM: it exists but belongs to someone else). */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** GET http://127.0.0.1:<port><path> as JSON, or null when nothing answers in time. Loopback only. */
export async function probe(port, path, timeoutMs = 800) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  try {
    const res = await fetch(`http://${HOST}:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** { raw, holder } for the lock at file; raw is null when there is no file, holder null when it is not ours to parse. */
async function readLock(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { raw: null, holder: null };
  }
  try {
    const h = JSON.parse(raw);
    return { raw, holder: h && typeof h === 'object' ? { pid: h.pid, port: h.port ?? null } : null };
  } catch {
    return { raw, holder: null };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Removes the lock at `file` only if it still reads `raw` (the content judged stale). Removal runs
 * under `<file>.break`, so two servers replacing the same stale lock cannot have the slower one
 * delete the lock the faster one just took. A break file whose pid is gone is cleared.
 */
async function removeIfUnchanged(file, raw) {
  const brk = `${file}.break`;
  const tmp = `${brk}.${process.pid}.tmp`;
  for (let i = 0; i < 200; i++) {
    await writeTemp(tmp, { pid: process.pid });
    let got = false;
    try {
      await link(tmp, brk);
      got = true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    } finally {
      await rm(tmp, { force: true });
    }
    if (!got) {
      const { raw: brkRaw, holder } = await readLock(brk);
      if (holder && !pidAlive(holder.pid)) await clearDeadBreak(brk, brkRaw);
      else await sleep(10);
      continue;
    }
    try {
      if ((await readLock(file)).raw === raw) await rm(file, { force: true });
      return;
    } finally {
      await rm(brk, { force: true });
    }
  }
  throw new LockBreakTimeoutError('lock break timed out');
}

export class LockBreakTimeoutError extends Error {
  name = 'LockBreakTimeoutError';
}

/**
 * Clears a `.break` file whose holder died. A plain rm could delete a `.break` that another waiter
 * took between our read and the rm, so move it aside first (rename is atomic: one waiter wins the
 * old file) and put it back when what we moved is not the dead holder's content.
 */
async function clearDeadBreak(brk, deadRaw) {
  const aside = `${brk}.${process.pid}.stale`;
  try {
    await rename(brk, aside);
  } catch {
    return; // someone else cleared or took it
  }
  try {
    if ((await readLock(aside)).raw !== deadRaw) await link(aside, brk).catch(() => {});
  } finally {
    await rm(aside, { force: true });
  }
}

export class LockPathError extends Error {
  name = 'LockPathError';
}

/** Writes a fresh temp file; `wx` never follows a link planted at that name. */
async function writeTemp(tmp, body) {
  await rm(tmp, { force: true });
  await writeFile(tmp, JSON.stringify(body), { flag: 'wx' });
}

/**
 * Makes sure `dir` (created when missing) is a real folder inside `root`: no symlink at `dir` or on
 * the way from `root`, so a committed link like `.drawing -> /elsewhere` cannot move our writes out.
 */
async function ensureDirInside(root, dir) {
  const realRoot = await realpath(root);
  const rel = relative(root, dir);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) throw new LockPathError('lock folder outside its root');
  let cur = root;
  for (const seg of rel.split(sep)) {
    cur = join(cur, seg);
    try {
      if (!(await lstat(cur)).isDirectory()) throw new LockPathError('lock folder is a symlink or not a folder');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await mkdir(cur);
    }
  }
  const real = await realpath(dir);
  if (real !== join(realRoot, rel)) throw new LockPathError('lock folder outside its root');
}

/**
 * Takes the lock at `file`, or reports who holds it. With `root`, the lock's folder must be a real
 * folder inside root (LockPathError otherwise).
 * `isLive(holder)` decides whether an existing holder { pid, port } still runs; a holder that is not
 * live is removed and the lock taken. Returns { ok: true, lock } or { ok: false, holder }.
 * lock.setPort(port) records the port once the server listens; lock.release() / releaseSync()
 * remove the file only while it is still ours.
 */
export async function claimLock(file, { isLive, root }) {
  if (root) await ensureDirInside(root, dirname(file));
  else await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Write a temp file, then hard-link it into place: link fails with EEXIST if someone holds the
    // lock, and readers never see a half-written file.
    await writeTemp(tmp, { pid: process.pid, port: null });
    try {
      await link(tmp, file);
      return { ok: true, lock: ownLock(file) };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    } finally {
      await rm(tmp, { force: true });
    }
    const { raw, holder } = await readLock(file);
    if (raw === null) continue; // released meanwhile
    if (holder && holder.pid !== process.pid && (await isLive(holder))) return { ok: false, holder };
    await removeIfUnchanged(file, raw);
  }
  return { ok: false, holder: (await readLock(file)).holder };
}

function ownLock(file) {
  const ours = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')).pid === process.pid;
    } catch {
      return false;
    }
  };
  return {
    file,
    async setPort(port) {
      if (!ours()) return;
      const tmp = `${file}.${process.pid}.tmp`;
      await writeTemp(tmp, { pid: process.pid, port });
      await rename(tmp, file);
    },
    async release() {
      if (ours()) await rm(file, { force: true });
    },
    releaseSync() {
      try {
        if (ours()) unlinkSync(file);
      } catch {
        /* already gone */
      }
    },
  };
}

/** Lock for one workspace folder: another Drawing server is live if its pid runs and its port
 *  (once known) answers /api/info with this workspace's folder name. */
export function claimWorkspace(workspaceDir) {
  const name = basename(workspaceDir);
  return claimLock(join(workspaceDir, '.drawing', 'server.lock'), {
    root: workspaceDir,
    isLive: async ({ pid, port }) => {
      if (!pidAlive(pid)) return false;
      if (port == null) return true; // still starting
      return (await probe(port, '/api/info'))?.workspace === name;
    },
  });
}
