// App shell navigation (design doc 6 §2.1, §5): which screen is shown, which sidebar rows are open, and the
// one-letter shortcuts. Pure, so it is tested without a browser.
import type { DocNode, Project, ProjectsView, TreeNode } from './api';

/** The main panel: a sidebar view, a project home, or the open document. 보관함 opens the trash dialog. */
export type Section = { kind: 'all' } | { kind: 'recent' } | { kind: 'project'; path: string } | { kind: 'doc' };

/** Project that holds `path` (a file path), or null for loose files. */
export function projectOf(view: ProjectsView | null, path: string | null): Project | null {
  if (!view || !path) return null;
  const top = path.split('/')[0];
  return path.includes('/') ? (view.projects.find((p) => p.path === top) ?? null) : null;
}

/** Rows to open so `path` is visible: its project and every document or group above it. */
export function openPathsFor(view: ProjectsView | null, path: string | null): string[] {
  const project = projectOf(view, path);
  if (!project || !path) return [];
  const out = [project.path];
  const walk = (nodes: DocNode[]): boolean => {
    for (const n of nodes) {
      if (n.path === path) return true;
      if (walk(n.children)) {
        out.push(n.path);
        return true;
      }
    }
    return false;
  };
  walk(project.docs);
  return out;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** One step of the open document's path (design doc 6 §2.4): its project, then the documents or groups above it. */
export type Crumb = { kind: 'project' | 'doc' | 'group'; path: string; label: string };

const docLabel = (n: DocNode) => (n.type === 'doc' && n.title) || n.name.replace(/\.dpx\.json$/, '');

/** The open document's node (its sub-documents) and the steps above it; node is null when the view does not have it yet. */
export function docPlace(view: ProjectsView | null, path: string | null): { trail: Crumb[]; node: DocNode | null } {
  if (!view || !path) return { trail: [], node: null };
  // A file opened right after it was made has no suffix in its path; the view's paths always have one.
  const want = subFolderOf(path);
  const project = projectOf(view, path);
  const trail: Crumb[] = project ? [{ kind: 'project', path: project.path, label: project.name }] : [];
  const walk = (nodes: DocNode[]): DocNode | null => {
    for (const n of nodes) {
      if (n.type === 'doc' && subFolderOf(n.path) === want) return n;
      trail.push({ kind: n.type, path: n.path, label: docLabel(n) });
      const hit = walk(n.children);
      if (hit) return hit;
      trail.pop();
    }
    return null;
  };
  const node = walk(project ? project.docs : view.loose);
  return { trail: node ? trail : project ? [trail[0]] : [], node };
}

/** The tree node the existing move / delete code works with. */
export function asTreeNode(n: DocNode | Project): TreeNode {
  if ('docs' in n || n.type === 'group') return { type: 'folder', name: baseName(n.path), path: n.path, children: [] };
  return { type: 'file', name: baseName(n.path), path: n.path, title: n.title ?? '', revision: n.revision ?? null };
}

/** Folder that holds a document's sub-documents (`a/X.dpx.json` → `a/X`). */
export const subFolderOf = (filePath: string) => filePath.replace(/\.dpx\.json$/, '');

/** Project the command menu is scoped to (its chip, its files first): the open file's project on the
 * document screen, the shown project on a project home, none elsewhere. Never a stale earlier one. */
export function paletteScope(section: Section, view: ProjectsView | null, openPath: string | null): { path: string; name: string } | null {
  const project =
    section.kind === 'doc' ? projectOf(view, openPath) : section.kind === 'project' ? (view?.projects.find((p) => p.path === section.path) ?? null) : null;
  if (project) return { path: project.path, name: project.name };
  return section.kind === 'project' ? { path: section.path, name: section.path } : null;
}

/** Folder new files go in: the project shown or the open file's project; '' = workspace root. */
export function newFileDir(section: Section, view: ProjectsView | null, openPath: string | null): string {
  if (section.kind === 'project') return section.path;
  if (section.kind === 'doc') return projectOf(view, openPath)?.path ?? '';
  return '';
}

export type ShellKey = 'all' | 'recent' | 'archive' | 'new' | 'settings';
const KEYS: Record<string, ShellKey> = { KeyA: 'all', KeyR: 'recent', KeyB: 'archive', KeyN: 'new', Comma: 'settings' };

// Where one-letter keys belong to something else: text fields, the editors, the canvas (its tool keys) and dialogs.
const OWNED = '.ProseMirror, input, textarea, select, .cm-editor, [contenteditable="true"], [contenteditable=""], .excalidraw, [role="dialog"], [role="menu"], [role="listbox"]';

type KeyLike = { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; repeat: boolean; defaultPrevented: boolean; target: EventTarget | null };

/** The shell action for a key press (A R B N ,), or null when the key is not one or belongs to something else. */
export function shellKey(e: KeyLike): ShellKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || e.repeat || e.defaultPrevented) return null;
  const k = KEYS[e.code];
  if (!k) return null;
  const t = e.target as { closest?: (s: string) => unknown } | null;
  if (t && typeof t.closest === 'function' && t.closest(OWNED)) return null;
  return k;
}

/** "42%" from a 0..1 fraction; null when unknown. */
export const percent = (used: number | null | undefined) => (used == null || !Number.isFinite(used) ? null : Math.max(0, Math.min(100, Math.round(used * 100))));
/** Above this a usage figure turns to the warning colour (doc 6 §2.1). */
export const WARN_PERCENT = 75;

export type ModelLine = { id: string; name: string; installed: boolean | null; connected: boolean; pct: number | null; reached: boolean };
export type ModelTone = 'ok' | 'warn' | 'off';
/**
 * One sidebar model row: the short visible text next to the name (never colour alone, doc 6 §6) and the dot tone
 * (--ok, --warn, --muted-foreground). `enabled` false: pipelines are off on this server, so every model reads 꺼짐.
 */
export function modelStatus(m: ModelLine, enabled: boolean): { text: string; long: string; tone: ModelTone } {
  if (!enabled) return { text: '꺼짐', long: '모델 연결 꺼짐', tone: 'off' };
  if (!m.connected) return { text: '연결 안 됨', long: '연결 안 됨', tone: 'off' };
  if (m.reached) return { text: '한도 도달', long: '사용 한도 도달', tone: 'warn' };
  if (m.pct == null) return { text: '연결됨', long: '연결됨', tone: 'ok' };
  return { text: `${m.pct}%`, long: `연결됨, 5시간 한도 ${m.pct}% 사용`, tone: m.pct > WARN_PERCENT ? 'warn' : 'ok' };
}
