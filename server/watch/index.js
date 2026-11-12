// T2: file watcher and change feed.
//   GET /api/files            -> [{ id, path, source:{kind,label}, pages:[{id,name}] }]
//   GET /api/files/<id>       -> { id, path, source, pages:[{id,name,xml}] }
//   GET /api/history?file=<id> -> change[] (oldest first, last 500)
//   SSE `file` (list entry) and `change` via ctx.hub.
// api (for agents/T4): onChange(fn) -> unsubscribe, listSources().
import { createWatcher } from './watcher.js';
import { sendJson } from '../app.js';

/** @param {{ projectDir: string, dispatch?: string|null, hub: { broadcast(event: string, data: unknown): void } }} ctx */
export async function setup(ctx, overrides = {}) {
  const watcher = createWatcher({
    projectDir: ctx.projectDir,
    dispatch: ctx.dispatch ?? null,
    ...overrides,
    onFile: (e) => ctx.hub.broadcast('file', e),
    onChange: (c) => ctx.hub.broadcast('change', c),
  });
  await watcher.start();

  const routes = [
    { method: 'GET', path: '/api/files', handler: (req, res) => sendJson(res, 200, watcher.listFiles()) },
    {
      method: 'GET',
      path: /^\/api\/files\/([0-9a-f]{12})$/,
      handler: (req, res, _ctx, m) => {
        const f = watcher.getFile(m[1]);
        return f ? sendJson(res, 200, f) : sendJson(res, 404, { error: 'not found' });
      },
    },
    {
      method: 'GET',
      path: '/api/history',
      handler: (req, res, _ctx, _m, url) => {
        const h = watcher.history(url.searchParams.get('file') ?? '');
        return h ? sendJson(res, 200, h) : sendJson(res, 404, { error: 'not found' });
      },
    },
  ];

  return {
    routes,
    api: { onChange: watcher.onChange, listSources: watcher.listSources },
    watcher,
    close: () => watcher.stop(),
  };
}
