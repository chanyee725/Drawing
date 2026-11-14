// Client for the E1 workspace API (docs/workspace-api.md).
// Node position overrides for a block (docs/design/block-drag-edit.md §2.1). Keys of `items` are node or empty-group names.
export type { BlockLayout } from '../../shared/render/block-layout.ts';
import type { BlockLayout } from '../../shared/render/block-layout.ts';
// Newest file format this web build understands; a 422 on a file above it means a newer app wrote it.
export const FILE_FORMAT_VERSION = 4;
// Pipeline steps (format v4). The web only carries it through saves for now; docs/workspace-api.md "Pipeline `plan`".
export type { Plan, PlanStep } from '../../shared/dispatch/plan.ts';
import type { Plan } from '../../shared/dispatch/plan.ts';
export type Block = { id: string; type: string; code: string; x: number; y: number; w: number; h: number; layout?: BlockLayout; frameId?: string };
export type DpxFile = {
  version: number;
  title: string;
  document: unknown;
  canvas: unknown;
  blocks: Block[];
  /** Present only in pipeline files. Saves send it back unchanged. */
  plan?: Plan;
  revision: number;
};
export type TreeNode =
  | { type: 'folder'; name: string; path: string; children: TreeNode[] }
  | { type: 'file'; name: string; path: string; title: string; revision: number | null; mtime?: string; created?: string; pipeline?: PipelineMark };
/** Tree mark of a pipeline file: draft (`plan`), a run in progress, the newest run stopped or failed (`paused`), or done. */
export type PipelineMark = { state: 'plan' | 'running' | 'paused' | 'done' };

/** Projects view (GET /api/workspace/projects, docs/workspace-api.md). Times are ISO strings. */
export type DocNode = {
  type: 'doc' | 'group';
  path: string;
  name: string;
  title?: string;
  revision?: number | null;
  /** Set on a pipeline file (E18). */
  pipeline?: PipelineMark;
  created: string | null;
  modified: string | null;
  /** Documents below this one. */
  count: number;
  children: DocNode[];
};
export type Project = { path: string; name: string; icon: string | null; description: string; created: string | null; modified: string | null; count: number; docs: DocNode[] };
export type ProjectsView = { projects: Project[]; loose: DocNode[] };

/** Model connection summary for the sidebar (Dispatch routes; GET only, nothing here starts a CLI). */
export type DispatchStatus = { enabled: boolean; reason?: string; message?: string };
export type ProviderState = { installed: boolean | null; connected: boolean; busy?: boolean; url?: string | null; error?: string | null };
export type LimitWindow = { label: string; used: number | null; reset: number | null };
export type ProviderLimits = {
  claude?: { windows: LimitWindow[] } | null;
  openai?: { windows: LimitWindow[] } | null;
  gemini?: { reached: boolean; reset: number | null } | null;
};

export type ProviderInfo = { installed?: boolean | null; connected?: boolean; busy?: boolean; url?: string | null; error?: string | null };
export type DispatchSettings = { guard: { enabled: boolean; five: number; seven: number }; team: { ctxHandoff?: number; handoffMTokens?: number } & Record<string, unknown> };

export type VersionLabel = 'draft' | 'approved' | 'done';
export type HistoryEntry = { id: string; /** ms since epoch */ time: number; bytes: number; /** Pipeline milestones this version stands for (E28). */ labels?: VersionLabel[] };
export type TrashItem = { id: string; path: string; /** ms since epoch */ deletedAt: number; /** Deleted outside the app: restoring brings back the newest saved snapshot. */ fromSnapshot?: boolean };
export type HistoryVersion = DpxFile & { id: string; time: number };

export class ApiError extends Error {
  status: number;
  revision?: number;
  constructor(status: number, message: string, revision?: number) {
    super(message);
    this.status = status;
    this.revision = revision;
  }
}

async function call<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  const res = await fetch(url, {
    method,
    keepalive,
    // Every non-GET /api request needs x-drawing: 1 (server/app.js); a cross-site page can't send it.
    headers: {
      ...(method === 'GET' ? {} : { 'x-drawing': '1' }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.revision);
  return data as T;
}

const q = (p: string) => `?path=${encodeURIComponent(p)}`;

export const api = {
  info: () => call<{ workspace: string; mode?: 'drawing' | 'project' }>('GET', '/api/info'),
  tree: () => call<{ tree: TreeNode[] }>('GET', '/api/tree').then((r) => r.tree),
  projects: () => call<ProjectsView>('GET', '/api/workspace/projects'),
  dispatch: () => call<DispatchStatus>('GET', '/api/dispatch'),
  providers: () => call<{ providers: Record<string, ProviderState> }>('GET', '/api/state').then((r) => r.providers ?? {}),
  limits: () => call<ProviderLimits>('GET', '/api/limits'),
  /** Settings dialog (E57): full provider status, Dispatch settings, connect/disconnect. Login runs the user's own CLI. */
  dispatchState: () => call<{ providers?: Record<string, ProviderInfo>; settings?: DispatchSettings }>('GET', '/api/state'),
  providerLogin: (id: string) => call<{ ok: boolean; connected: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/login`, {}),
  providerCancel: (id: string) => call<{ ok: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/cancel`, {}),
  /** Disconnects from Drawing only; the CLI's own login stays. */
  providerLogout: (id: string) => call<{ ok: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/logout`, {}),
  providerRefresh: () => call<Record<string, ProviderInfo>>('POST', '/api/providers/refresh', {}),
  saveDispatchSettings: (patch: { guard?: Partial<DispatchSettings['guard']>; team?: Partial<DispatchSettings['team']> }) =>
    call<DispatchSettings>('POST', '/api/settings', patch),
  prTracking: () => call<{ on: boolean }>('GET', '/api/workspace/pr-tracking'),
  setPrTracking: (on: boolean) => call<{ on: boolean }>('POST', '/api/workspace/pr-tracking', { on }),
  readFile: (path: string) => call<DpxFile>('GET', `/api/file${q(path)}`),
  /** `content`: starting document, canvas, blocks and plan (a template); defaults to an empty file. */
  createFile: (path: string, title: string, content?: Partial<Pick<DpxFile, 'document' | 'canvas' | 'blocks' | 'plan'>>) =>
    call<DpxFile>('POST', '/api/file', { ...content, path, title }),
  saveFile: (path: string, f: Pick<DpxFile, 'revision' | 'title' | 'document' | 'canvas' | 'blocks' | 'plan'>, keepalive = false) =>
    call<DpxFile>('PUT', `/api/file${q(path)}`, f, keepalive),
  /** `withSubdocs`: the document's sub-documents folder (`X/` next to `X.dpx.json`) goes to the trash with it. */
  removeFile: (path: string, withSubdocs = false) => call<unknown>('DELETE', `/api/file${q(path)}${withSubdocs ? '&withSubdocs=1' : ''}`),
  createFolder: (path: string) => call<unknown>('POST', '/api/folder', { path }),
  removeFolder: (path: string) => call<unknown>('DELETE', `/api/folder${q(path)}`),
  history: (path: string) => call<{ versions: HistoryEntry[] }>('GET', `/api/history${q(path)}`).then((r) => r.versions),
  historyVersion: (path: string, id: string) => call<HistoryVersion>('GET', `/api/history/version${q(path)}&id=${encodeURIComponent(id)}`),
  /** Keep the file as it is on disk now as a version (before a restore). */
  historySnapshot: (path: string) => call<{ id: string | null }>('POST', `/api/history${q(path)}`, {}),
  trash: () => call<{ items: TrashItem[] }>('GET', '/api/trash').then((r) => r.items),
  restoreTrash: (id: string) => call<{ path: string }>('POST', '/api/trash/restore', { id }),
  /** `withSubdocs`: a document's sub-documents folder (`X/` next to `X.dpx.json`) moves along (type 'file' only). */
  move: (from: string, to: string, type: 'file' | 'folder', withSubdocs = false) =>
    call<unknown>('POST', '/api/move', withSubdocs ? { from, to, type, withSubdocs } : { from, to, type }),
};

// Project view: GET /api/workspace/projects (docs/workspace-api.md "Projects view"), mapped to the shapes the screens use.
type DocNodeDto = { type: 'doc' | 'group'; path: string; name: string; title?: string; created: string | null; modified: string | null; children: DocNodeDto[] };
type ProjectDto = { path: string; name: string; icon: string | null; description: string; created: string | null; modified: string | null; count: number; docs: DocNodeDto[] };
export type ProjectDoc = {
  path: string;
  name: string;
  title: string;
  /** A folder without a same-named file: a parent without a document of its own. */
  bundle: boolean;
  /** ms since epoch (0 = unknown) */
  createdAt: number;
  modifiedAt: number;
  children: ProjectDoc[];
};
export type ProjectInfo = {
  /** The project folder's path (its unique id). */
  id: string;
  path: string;
  name: string;
  icon: string;
  description: string;
  docCount: number;
  createdAt: number;
  modifiedAt: number;
  docs: ProjectDoc[];
};
export type ProjectsResponse = { projects: ProjectInfo[]; unfiled: ProjectDoc[] };
export type RecentFile = { path: string; title: string; project: string | null; parent: string | null; createdAt: number; modifiedAt: number };
const time = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
const toDoc = (n: DocNodeDto): ProjectDoc => ({
  path: n.path,
  name: n.name,
  title: n.title || n.name,
  bundle: n.type === 'group',
  createdAt: time(n.created),
  modifiedAt: time(n.modified),
  children: n.children.map(toDoc),
});
export const projectsApi = {
  /** Files with a run going now (GET /api/runs/active). */
  running: () => call<{ files: string[] }>('GET', '/api/runs/active').then((r) => r.files),
  projects: () =>
    call<{ projects: ProjectDto[]; loose: DocNodeDto[] }>('GET', '/api/workspace/projects').then(
      (r): ProjectsResponse => ({
        projects: r.projects.map((p) => ({
          id: p.path,
          path: p.path,
          name: p.name,
          icon: p.icon ?? [...p.name][0] ?? '',
          description: p.description,
          docCount: p.count,
          createdAt: time(p.created),
          modifiedAt: time(p.modified),
          docs: p.docs.map(toDoc),
        })),
        unfiled: r.loose.map(toDoc),
      }),
    ),
};
