// Moving documents and groups in the app sidebar (E44b): where a drop lands, and the folders the
// "옮기기" menu offers. Pure, so it is tested without a browser.
// Drop targets are projects and groups (folders). A document carries its sub-documents folder along;
// nothing moves to the workspace root from the sidebar (loose files are not shown there).
import type { DocNode, ProjectsView } from './api';
import { baseName, parentPath } from './movePaths.ts';
import { subFolderOf } from './projectNav.ts';

export type MoveItem = { kind: 'doc' | 'group'; path: string; label: string; subdocs: boolean };
export type MoveDestination = { path: string; label: string };

const docLabel = (n: DocNode) => (n.type === 'doc' ? n.title || n.name : n.name);

export function moveItemOf(n: DocNode): MoveItem {
  return { kind: n.type, path: n.path, label: docLabel(n), subdocs: n.type === 'doc' && n.children.length > 0 };
}

const within = (dir: string, folder: string) => dir === folder || dir.startsWith(`${folder}/`);

/** New path of `item` dropped into folder `dir`; null when that is a no-op or impossible (refused drops move nothing). */
export function moveTarget(item: MoveItem, dir: string): string | null {
  if (!dir) return null;
  const own = item.kind === 'group' ? item.path : subFolderOf(item.path);
  if (within(dir, own)) return null;
  if (parentPath(item.path) === dir) return null;
  return `${dir}/${baseName(item.path)}`;
}

/** The sub-documents folder that moves with a document, or null when there is none. */
export function subdocsMove(item: MoveItem, to: string): { from: string; to: string } | null {
  return item.kind === 'doc' && item.subdocs ? { from: subFolderOf(item.path), to: subFolderOf(to) } : null;
}

/** Projects and groups `item` can move into, in sidebar order, labelled "Project / group". */
export function moveDestinations(view: ProjectsView | null, item: MoveItem): MoveDestination[] {
  const out: MoveDestination[] = [];
  const add = (path: string, label: string) => {
    if (moveTarget(item, path)) out.push({ path, label });
  };
  const walk = (nodes: DocNode[], trail: string) => {
    for (const n of nodes) {
      const label = `${trail} / ${docLabel(n)}`;
      if (n.type === 'group') add(n.path, label);
      walk(n.children, label);
    }
  };
  for (const p of view?.projects ?? []) {
    add(p.path, p.name);
    walk(p.docs, p.name);
  }
  return out;
}
