// Workspace module: HTTP API over the file store + SSE "workspace" events for outside changes.
import { createStore, StoreError } from './store.js';

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

export async function setup(ctx) {
  if (!ctx.workspaceDir) return {};
  const store = createStore(ctx.workspaceDir, {
    onExternalChange: (e) => ctx.hub.broadcast('workspace', e),
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
        send(res, okStatus, await fn(url.searchParams.get('path'), body));
      } catch (err) {
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
    close: () => store.close(),
    routes: [
      route('GET', '/api/tree', async () => ({ tree: await store.tree() })),
      route('GET', '/api/file', (p) => store.readFile(need(p, 'path'))),
      route('PUT', '/api/file', (p, b) => store.writeFile(need(p, 'path'), b)),
      route('POST', '/api/file', (_p, b) => store.createFile(need(b?.path, 'path'), b), 201),
      route('DELETE', '/api/file', (p) => store.remove(need(p, 'path'))),
      route('POST', '/api/folder', (_p, b) => store.createFolder(need(b?.path, 'path')), 201),
      route('DELETE', '/api/folder', (p) => store.remove(need(p, 'path'))),
      route('POST', '/api/move', (_p, b) => store.move(need(b?.from, 'from'), need(b?.to, 'to'))),
    ],
  };
}
