// Client for the E1 workspace API (docs/workspace-api.md).
// Node position overrides for a block (docs/design/block-drag-edit.md §2.1). Keys of `items` are node or empty-group names.
export type { BlockLayout } from '../../shared/render/block-layout.ts';
import type { BlockLayout } from '../../shared/render/block-layout.ts';
// Newest file format this web build understands; a 422 on a file above it means a newer app wrote it.
export const FILE_FORMAT_VERSION = 3;
export type Block = { id: string; type: string; code: string; x: number; y: number; w: number; h: number; layout?: BlockLayout };
export type DpxFile = {
  version: number;
  title: string;
  document: unknown;
  canvas: unknown;
  blocks: Block[];
  revision: number;
};
export type TreeNode =
  | { type: 'folder'; name: string; path: string; children: TreeNode[] }
  | { type: 'file'; name: string; path: string; title: string; revision: number | null; mtime?: string; created?: string };

/** Projects view (GET /api/workspace/projects, docs/workspace-api.md). Times are ISO strings. */
export type DocNode = {
  type: 'doc' | 'group';
  path: string;
  name: string;
  title?: string;
  revision?: number | null;
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
export type ProviderState = { installed: boolean | null; connected: boolean };
export type LimitWindow = { label: string; used: number | null; reset: number | null };
export type ProviderLimits = {
  claude?: { windows: LimitWindow[] } | null;
  openai?: { windows: LimitWindow[] } | null;
  gemini?: { reached: boolean; reset: number | null } | null;
};

export type HistoryEntry = { id: string; /** ms since epoch */ time: number; bytes: number };
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
  info: () => call<{ workspace: string }>('GET', '/api/info'),
  tree: () => call<{ tree: TreeNode[] }>('GET', '/api/tree').then((r) => r.tree),
  projects: () => call<ProjectsView>('GET', '/api/workspace/projects'),
  dispatch: () => call<DispatchStatus>('GET', '/api/dispatch'),
  providers: () => call<{ providers: Record<string, ProviderState> }>('GET', '/api/state').then((r) => r.providers ?? {}),
  limits: () => call<ProviderLimits>('GET', '/api/limits'),
  readFile: (path: string) => call<DpxFile>('GET', `/api/file${q(path)}`),
  createFile: (path: string, title: string) => call<DpxFile>('POST', '/api/file', { path, title }),
  saveFile: (path: string, f: Pick<DpxFile, 'revision' | 'title' | 'document' | 'canvas' | 'blocks'>, keepalive = false) =>
    call<DpxFile>('PUT', `/api/file${q(path)}`, f, keepalive),
  removeFile: (path: string) => call<unknown>('DELETE', `/api/file${q(path)}`),
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
