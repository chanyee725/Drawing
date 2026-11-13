// Workspace module: HTTP API over the file store + SSE "workspace" events for outside changes.
import { createStore, StoreError } from './store.js';
import { listProjects } from './projects.js';
// The PR/CI switch lives with the Dispatch PR tracker (it reads the same settings.json), so the route reuses it.
import { readPrTracking, setPrTracking } from '../dispatch/pr-status.js';

const SETTINGS_BROKEN = '설정 파일을 읽을 수 없어요. 파일을 확인해 주세요.';
const MAX_BODY = 20 * 1024 * 1024;

async function readJson(req) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new StoreError(415, 'content-type must be application/json');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new StoreError(413, 'body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new StoreError(400, 'invalid JSON');
  }
}

// Filesystem errors that mean "your request does not fit the current tree" are client errors.
// Never forward err.message: it contains absolute paths.
const FS_CLIENT_ERRORS = {
  ENOTDIR: [400, 'a parent in the path is not a folder'],
  EISDIR: [400, 'path is a folder'],
  ENAMETOOLONG: [400, 'name too long'],
  EEXIST: [409, 'already exists'],
  ENOTEMPTY: [409, 'folder is not empty'],
};
function toStoreError(err) {
  if (err instanceof StoreError) return err;
  const hit = FS_CLIENT_ERRORS[err?.code];
  return hit ? new StoreError(hit[0], hit[1]) : err;
}

export async function setup(ctx) {
  if (!ctx.workspaceDir) return {};
  // In-process listeners for content changes of a file (API saves, plan patches, outside edits); the live agent
  // cursor (server/cursor/) diffs them. SSE clients still get only what they got before.
  const changeListeners = new Set();
  const changed = (path) => {
    for (const fn of changeListeners) fn(path);
  };
  const store = createStore(ctx.workspaceDir, {
    onExternalChange: (e) => {
      ctx.hub.broadcast('workspace', e);
      if (e.kind === 'change' || e.kind === 'create') changed(e.path);
    },
  });
  await store.startWatching();

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const route = (method, path, fn, okStatus = 200) => ({
    method,
    path,
    async handler(req, res, _ctx, _m, url) {
      try {
        const body = method === 'GET' || method === 'DELETE' ? null : await readJson(req);
        send(res, okStatus, await fn(url.searchParams.get('path'), body, url.searchParams));
      } catch (e) {
        const err = toStoreError(e);
        if (!(err instanceof StoreError)) throw err;
        const out = { error: err.message };
        if (err.revision !== undefined) out.revision = err.revision;
        send(res, err.status, out);
      }
    },
  });
  const need = (v, name) => {
    if (typeof v !== 'string') throw new StoreError(400, `${name} is required`);
    return v;
  };

  return {
    store,
    /** fn(path) on each content change of a file; returns an unsubscribe function. */
    onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
    close: () => store.close(),
    routes: [
      route('GET', '/api/tree', async () => ({ tree: await store.tree() })),
      // Projects view (top-level folders, nested sub-documents). Not /api/projects: Dispatch owns that path.
      route('GET', '/api/workspace/projects', () => listProjects(store)),
      // Per-workspace PR/CI tracking switch (E57 settings dialog); stored in <workspace>/.drawing/settings.json.
      route('GET', '/api/workspace/pr-tracking', async () => {
        try {
          return { on: await readPrTracking(ctx.workspaceDir) };
        } catch (e) {
          if (e?.code === 'ESETTINGS') throw new StoreError(409, SETTINGS_BROKEN);
          throw e;
        }
      }),
      route('POST', '/api/workspace/pr-tracking', async (_p, b) => {
        if (typeof b?.on !== 'boolean') throw new StoreError(400, 'on must be true or false');
        try {
          await setPrTracking(ctx.workspaceDir, b.on);
        } catch (e) {
          if (e?.code === 'ESETTINGS') throw new StoreError(409, SETTINGS_BROKEN);
          throw e;
        }
        return { on: b.on };
      }),
      route('GET', '/api/file', (p) => store.readFile(need(p, 'path'))),
      route('PUT', '/api/file', async (p, b) => {
        const r = await store.writeFile(need(p, 'path'), b);
        changed(r.path);
        return r;
      }),
      route('POST', '/api/file', async (_p, b) => {
        const r = await store.createFile(need(b?.path, 'path'), b);
        changed(r.path);
        return r;
      }, 201),
      // Step-level plan edit (agents): re-read under the store lock, then announced like an outside change so an
      // open, clean tab reloads and a dirty one gets the 409 choice on its next save.
      route('PATCH', '/api/file/plan', async (p, b) => {
        const r = await store.patchPlan(need(p, 'path'), b);
        ctx.hub.broadcast('workspace', { kind: 'change', path: r.path, revision: r.revision });
        changed(r.path);
        return r;
      }),
      // withSubdocs=1: the document's sub-documents folder goes to the trash with it.
      route('DELETE', '/api/file', (p, _b, sp) => store.removeFile(need(p, 'path'), { withSubdocs: sp.get('withSubdocs') === '1' })),
      route('POST', '/api/folder', (_p, b) => store.createFolder(need(b?.path, 'path')), 201),
      route('DELETE', '/api/folder', (p) => store.removeFolder(need(p, 'path'))),
      // Deleted files stay here for 30 days; restore puts one back at its old path (409 if the path is taken).
      route('GET', '/api/trash', () => store.trash()),
      route('POST', '/api/trash/restore', (_p, b) => store.restoreTrash(need(b?.id, 'id'))),
      route('GET', '/api/history', (p) => store.history(need(p, 'path'))),
      route('GET', '/api/history/version', (p, _b, q) => store.historyVersion(need(p, 'path'), q.get('id'))),
      // Snapshot the file as it is on disk now (before a restore); ignores the 5-minute interval.
      route('POST', '/api/history', (p) => store.historySnapshotNow(need(p, 'path'))),
      // body: {from, to, type?: 'file'|'folder', withSubdocs?: true}; without type a file wins over a same-named folder.
      // withSubdocs (type 'file' only): the document's sub-documents folder (`X/` next to `X.dpx.json`) moves along.
      route('POST', '/api/move', (_p, b) => store.move(need(b?.from, 'from'), need(b?.to, 'to'), b?.type, { withSubdocs: b?.withSubdocs === true })),
    ],
  };
}
