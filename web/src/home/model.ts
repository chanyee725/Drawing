// Pure data helpers for the dashboard and project home (no React).
import type { ProjectDoc, ProjectInfo } from '../api';

export type DashTab = 'all' | 'recent' | 'projects' | 'unfiled';
export type Row = { doc: ProjectDoc; depth: number; /** Number of sub-docs below (all levels). */ subs: number; expandable: boolean; expanded: boolean };

const subCount = (d: ProjectDoc): number => d.children.reduce((n, c) => n + 1 + subCount(c), 0);

/** Visible rows of a nested doc list: children only under an expanded parent. `collapsed` holds the closed paths (open by default). */
export function flattenRows(docs: ProjectDoc[], collapsed: ReadonlySet<string>, depth = 0): Row[] {
  return docs.flatMap((doc) => {
    const expandable = doc.children.length > 0;
    const expanded = expandable && !collapsed.has(doc.path);
    return [{ doc, depth, subs: subCount(doc), expandable, expanded }, ...(expanded ? flattenRows(doc.children, collapsed, depth + 1) : [])];
  });
}

/** Every real document (bundles skipped), depth first, with the project it sits in. */
export function allDocs(projects: ProjectInfo[], unfiled: ProjectDoc[]): { doc: ProjectDoc; project: ProjectInfo | null }[] {
  const walk = (docs: ProjectDoc[], project: ProjectInfo | null): { doc: ProjectDoc; project: ProjectInfo | null }[] =>
    docs.flatMap((d) => [...(d.bundle ? [] : [{ doc: d, project }]), ...walk(d.children, project)]);
  return [...projects.flatMap((p) => walk(p.docs, p)), ...walk(unfiled, null)];
}

/** Docs whose title contains the query (case-insensitive); an empty query keeps everything. */
export const matchesQuery = (title: string, query: string) => !query.trim() || title.toLowerCase().includes(query.trim().toLowerCase());

/** Keeps a doc if it or any sub-doc matches; a matching parent keeps its whole subtree. */
export function filterDocs(docs: ProjectDoc[], query: string): ProjectDoc[] {
  if (!query.trim()) return docs;
  return docs.flatMap((d) => {
    if (matchesQuery(d.title, query)) return [d];
    const kids = filterDocs(d.children, query);
    return kids.length ? [{ ...d, children: kids }] : [];
  });
}

const MIN = 60_000;
/** "방금", "5분 전", "3시간 전", "2일 전", then a date. */
export function relativeTime(ms: number, now = Date.now()): string {
  if (!ms) return '-';
  const d = Math.max(0, now - ms);
  if (d < MIN) return '방금';
  if (d < 60 * MIN) return `${Math.floor(d / MIN)}분 전`;
  if (d < 24 * 60 * MIN) return `${Math.floor(d / (60 * MIN))}시간 전`;
  if (d < 30 * 24 * 60 * MIN) return `${Math.floor(d / (24 * 60 * MIN))}일 전`;
  const x = new Date(ms);
  return `${x.getFullYear()}.${x.getMonth() + 1}.${x.getDate()}`;
}

/** Folder to create new files in, from a project id (null = workspace root). */
export const folderPrefix = (project: string | null) => (project ? `${project}/` : '');

/** Time of the last plain `G` keydown; `G` then `P` within a second opens the project menu (the dashboard's `P` skips then). */
export const chord = { g: 0 };
export const CHORD_MS = 1000;

/** Spec: rows are 41px tall, sub-docs indent 24px per level. */
export const ROW_HEIGHT = 41;
export const INDENT = 24;
