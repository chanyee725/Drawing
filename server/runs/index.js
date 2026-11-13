// Runs module: the run recorder plus a read-only API over run records. Writes stay server-internal:
// run control (E20/E27) uses ctx.modules.runs.recorder.
import { StoreError } from '../workspace/store.js';
import { createRecorder } from './recorder.js';

export async function setup(ctx) {
  const store = ctx.modules.workspace?.store;
  if (!store) return {};
  const recorder = createRecorder({ runs: store.runs, hub: ctx.hub });

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const route = (method, path, fn) => ({
    method,
    path,
    async handler(req, res, _ctx, _m, url) {
      try {
        const p = url.searchParams.get('path');
        if (typeof p !== 'string') throw new StoreError(400, 'path is required');
        send(res, 200, await fn(p, url.searchParams));
      } catch (err) {
        if (!(err instanceof StoreError)) throw err;
        send(res, err.status, { error: err.message });
      }
    },
  });

  return {
    recorder,
    close: () => recorder.close(),
    routes: [
      // Files with a run going now, for "실행 중" counts on the project home (no path needed).
      {
        method: 'GET',
        path: '/api/runs/active',
        handler(_req, res) {
          send(res, 200, { files: recorder.runningFiles() });
        },
      },
      route('GET', '/api/runs', (p) => recorder.list(p)),
      route('GET', '/api/runs/run', (p, q) => recorder.read(p, q.get('id'))),
      // Starting a run from the file's plan needs the plan/approval flow (E20).
      route('POST', '/api/runs', async () => {
        throw new StoreError(501, 'run control is not available yet');
      }),
    ],
  };
}
