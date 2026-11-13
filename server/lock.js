// One-server locks (E13): a small JSON file { pid, port } that says which server owns a folder.
// `<workspace>/.drawing/server.lock` keeps two Drawing servers off one workspace;
// `<project>/.dispatch/drawing.lock` keeps two Dispatch modules off one project's `.dispatch/`.
// A lock whose owner is gone (dead pid, or its port no longer answers as that server) is stale and
// gets replaced, so a crash never blocks the next start.
import { readFileSync, unlinkSync } from 'node:fs';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

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

async function readHolder(file) {
  try {
    const h = JSON.parse(await readFile(file, 'utf8'));
    return h && typeof h === 'object' ? { pid: h.pid, port: h.port ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Takes the lock at `file`, or reports who holds it.
 * `isLive(holder)` decides whether an existing holder { pid, port } still runs; a holder that is not
 * live is removed and the lock taken. Returns { ok: true, lock } or { ok: false, holder }.
 * lock.setPort(port) records the port once the server listens; lock.release() / releaseSync()
 * remove the file only while it is still ours.
 */
export async function claimLock(file, { isLive }) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Write a temp file, then hard-link it into place: link fails with EEXIST if someone holds the
    // lock, and readers never see a half-written file.
    await writeFile(tmp, JSON.stringify({ pid: process.pid, port: null }));
    try {
      await link(tmp, file);
      return { ok: true, lock: ownLock(file) };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    } finally {
      await rm(tmp, { force: true });
    }
    const holder = await readHolder(file);
    if (holder && holder.pid !== process.pid && (await isLive(holder))) return { ok: false, holder };
    await rm(file, { force: true });
  }
  return { ok: false, holder: await readHolder(file) };
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
      await writeFile(tmp, JSON.stringify({ pid: process.pid, port }));
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
    isLive: async ({ pid, port }) => {
      if (!pidAlive(pid)) return false;
      if (port == null) return true; // still starting
      return (await probe(port, '/api/info'))?.workspace === name;
    },
  });
}
