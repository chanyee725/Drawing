// Pure path rules for moving and renaming in the sidebar (tested without a browser).
import type { TreeNode } from './api.ts';

const EXT = /\.dpx(\.json)?$/i;
/** `a/b`, `a/b.dpx` and `a/b.dpx.json` are the same file. */
export const stem = (p: string) => p.replace(EXT, '');
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const parentPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** What the rename field starts with: the file name without its extension (the title is not the name), or the folder name. */
export const renameInitial = (node: Pick<TreeNode, 'type' | 'name'>): string => (node.type === 'file' ? stem(node.name) : node.name);

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

/** Why a typed name cannot be used (Korean, for the sidebar), or null when it is fine to try. */
export function nameProblem(node: Pick<TreeNode, 'type'>, name: string): string | null {
  const raw = name.trim();
  const bare = node.type === 'file' ? stem(raw) : raw;
  if (!bare) return null;
  if (bare === '.' || bare === '..') return '이름을 . 이나 ..로 할 수 없어요.';
  if (/[\\/]/.test(bare)) return '이름에 / 나 \\를 넣을 수 없어요.';
  if (bare.startsWith('.')) return '점(.)으로 시작하는 이름은 쓸 수 없어요.';
  if (bare.length > 200) return '이름이 너무 길어요.';
  if (node.type === 'folder' && /\.dpx(\.json)?$/i.test(bare)) return '폴더 이름은 .dpx로 끝날 수 없어요.';
  return null;
}

const SERVER_TEXT: [RegExp, string][] = [
  [/hidden names/, '점(.)으로 시작하는 이름은 쓸 수 없어요.'],
  [/cannot end with/, '폴더 이름은 .dpx로 끝날 수 없어요.'],
  [/invalid path|invalid path segment/, '쓸 수 없는 이름이에요.'],
  [/name too long|path too long/, '이름이 너무 길어요.'],
  [/into itself/, '폴더를 자기 안으로 옮길 수 없어요.'],
  [/outside workspace|symlink|absolute/, '이 위치로는 옮길 수 없어요.'],
  [/not found/, '옮길 항목을 찾지 못했어요. 목록을 새로 고쳐 보세요.'],
];
/** Korean text for a failed move or rename (server messages are English). */
export function moveErrorText(status: number | undefined, message: string): string {
  if (status === 409 && /target already exists|already exists/.test(message)) return '같은 이름이 이미 있어요.';
  for (const [re, text] of SERVER_TEXT) if (re.test(message)) return text;
  return '옮기지 못했어요. 잠시 뒤 다시 해 보세요.';
}
