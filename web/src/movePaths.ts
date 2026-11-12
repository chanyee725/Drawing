// Pure path rules for moving and renaming in the sidebar (tested without a browser).
import type { TreeNode } from './api.ts';

const EXT = /\.dpx(\.json)?$/i;
/** `a/b`, `a/b.dpx` and `a/b.dpx.json` are the same file. */
export const stem = (p: string) => p.replace(EXT, '');
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const parentPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Where `node` lands when dropped on folder `dir` ('' = the workspace root); null when that is a no-op or impossible. */
export function dropTarget(node: Pick<TreeNode, 'type' | 'path'>, dir: string): string | null {
  if (node.type === 'folder' && (dir === node.path || dir.startsWith(`${node.path}/`))) return null;
  if (parentPath(node.path) === dir) return null;
  return join(dir, baseName(node.path));
}

/** New full path for renaming `node` to the typed `name` (same folder); null when empty, unchanged or containing a slash. */
export function renameTarget(node: Pick<TreeNode, 'type' | 'path'>, name: string): string | null {
  const raw = name.trim();
  const bare = node.type === 'file' ? stem(raw) : raw;
  if (!bare || bare === '.' || bare === '..' || /[\\/]/.test(bare)) return null;
  const ext = node.type === 'file' ? (node.path.match(EXT)?.[0] ?? '') : '';
  const next = join(parentPath(node.path), bare + ext);
  return next === node.path ? null : next;
}

/** The open file's path after `from` moved to `to`, or null when the move does not touch it. */
export function pathAfterMove(open: string | null, from: string, to: string, type: 'file' | 'folder'): string | null {
  if (!open) return null;
  if (type === 'file') return stem(open) === stem(from) ? to : null;
  return open.startsWith(`${from}/`) ? to + open.slice(from.length) : null;
}
