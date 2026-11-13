// Pure data helpers for the dashboard and project home (no React).
import type { ProjectDoc, ProjectInfo, RecentFile } from '../api';

export type DashTab = 'all' | 'recent' | 'projects' | 'unfiled';

/** Real documents below `d` (bundles are folders, not documents, so they are not counted). */
export const subCount = (d: ProjectDoc): number => d.children.reduce((n, c) => n + (c.bundle ? 0 : 1) + subCount(c), 0);

export type Placed = { doc: ProjectDoc; project: ProjectInfo | null; /** Title of the document (or bundle) right above, if any. */ parent: string | null };

/** Every real document (bundles skipped), depth first, with the project and parent it sits in. */
export function allDocs(projects: ProjectInfo[], unfiled: ProjectDoc[]): Placed[] {
  const walk = (docs: ProjectDoc[], project: ProjectInfo | null, parent: string | null): Placed[] =>
    docs.flatMap((d) => [...(d.bundle ? [] : [{ doc: d, project, parent }]), ...walk(d.children, project, d.title)]);
  return [...projects.flatMap((p) => walk(p.docs, p, null)), ...walk(unfiled, null, null)];
}

/** Where a file sits, for the 위치 column: "프로젝트 / 상위 문서", or 미분류 at the workspace root. */
export const locationOf = (p: { project: string | null; parent: string | null }) => [p.project, p.parent].filter(Boolean).join(' / ') || '미분류';

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

/** Every document as a flat row, newest edit first (the 전체 tab; 고친 때 is the default sort). */
export function flatFiles(projects: ProjectInfo[], unfiled: ProjectDoc[]): RecentFile[] {
  return allDocs(projects, unfiled)
    .map(({ doc, project, parent }) => ({ path: doc.path, title: doc.title, project: project?.name ?? null, parent, createdAt: doc.createdAt, modifiedAt: doc.modifiedAt }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** Newest-edited documents first (computed here: the server has no recent-files route). */
export const RECENT_LIMIT = 20;
export const recentFiles = (projects: ProjectInfo[], unfiled: ProjectDoc[], limit = RECENT_LIMIT): RecentFile[] => flatFiles(projects, unfiled).slice(0, limit);

/** First letter of a project for its badge (the meta icon when it has one). */
export const badgeOf = (p: { icon: string; name: string }) => p.icon || [...p.name][0] || '?';

/** Files with a run going now that sit in `project` (its folder or any sub-folder). */
export const runningIn = (project: Pick<ProjectInfo, 'path'>, running: ReadonlySet<string>) =>
  [...running].filter((f) => f.startsWith(`${project.path}/`)).length;

/** True when a file below `doc` (any level, not `doc` itself) has a run going now: a folded parent shows it. */
export const runningBelow = (doc: ProjectDoc, running: ReadonlySet<string>): boolean => doc.children.some((c) => running.has(c.path) || runningBelow(c, running));

type VisibilityDoc = { visibilityState: string; addEventListener: (t: 'visibilitychange', fn: () => void) => void; removeEventListener: (t: 'visibilitychange', fn: () => void) => void };
type Timers = { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (t: unknown) => void };
const realTimers: Timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (t) => clearInterval(t as number) };

/**
 * Calls `load` now and every `ms` while the page is visible. A hidden page stops the timer; showing it again
 * loads at once and restarts the timer. Returns a stop function.
 */
export function pollWhileVisible(load: () => void, ms: number, doc: VisibilityDoc = document, timers: Timers = realTimers): () => void {
  let timer: unknown = null;
  const start = () => {
    if (timer === null) timer = timers.setInterval(load, ms);
  };
  const stop = () => {
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
  };
  const onChange = () => {
    if (doc.visibilityState === 'visible') {
      load();
      start();
    } else stop();
  };
  if (doc.visibilityState === 'visible') {
    load();
    start();
  }
  doc.addEventListener('visibilitychange', onChange);
  return () => {
    stop();
    doc.removeEventListener('visibilitychange', onChange);
  };
}
