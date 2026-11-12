// Strict path handling: every API path is a relative, "/"-separated path inside the workspace.
import { realpathSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { join, sep, dirname } from 'node:path';

// A drive path (`C:/x`). On Windows `C:x` is drive-relative, so any `X:` start is refused there; elsewhere `a:memo` is a fine name.
const DRIVE = process.platform === 'win32' ? /^[a-zA-Z]:/ : /^[a-zA-Z]:(\/|$)/;

export class PathError extends Error {}

/** Validate an API path and return its segments. Throws PathError. */
export function parseRelPath(p) {
  if (typeof p !== 'string' || p === '') throw new PathError('path is required');
  if (p.length > 1024) throw new PathError('path too long');
  if (p.includes('\0') || p.includes('\\')) throw new PathError('invalid path');
  if (p.startsWith('/') || DRIVE.test(p)) throw new PathError('absolute paths are not allowed');
  const segs = p.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') throw new PathError('invalid path segment');
    if (s.startsWith('.')) throw new PathError('hidden names are not allowed');
    if (s.length > 200) throw new PathError('name too long');
  }
  return segs;
}

export function createResolver(rootDir) {
  const root = realpathSync(rootDir);

  /** Absolute path for a relative API path; refuses symlink escapes. `segs` must come from parseRelPath. */
  async function resolve(relPath) {
    const segs = parseRelPath(relPath);
    const abs = join(root, ...segs);
    await assertInside(abs);
    return abs;
  }

  async function assertInside(abs) {
    // Walk up to the deepest existing ancestor and make sure its real location is inside root.
    let cur = abs;
    for (;;) {
      try {
        await lstat(cur);
        break;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        const up = dirname(cur);
        if (up === cur) throw new PathError('path outside workspace');
        cur = up;
      }
    }
    const real = await realpath(cur);
    if (real !== root && !real.startsWith(root + sep)) throw new PathError('path outside workspace');
    // The target itself must not be a symlink (a link inside the workspace could still point elsewhere).
    try {
      if ((await lstat(abs)).isSymbolicLink()) throw new PathError('symlinks are not allowed');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  const toRel = (abs) => abs.slice(root.length + 1).split(sep).join('/');
  return { root, resolve, toRel };
}
