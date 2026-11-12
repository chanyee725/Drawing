// T4: Dispatch agents feed (read-only).
// - Follows the project's Dispatch server (GET /api/state + SSE /api/events).
// - Maps each session to its worktree folder and attributes watch changes to it.
// - Pushes `agents` events on the hub and serves GET /api/agents.
// Stores only names, roles, status, one activity line and what changed.
import { resolveDispatchUrl, followDispatch } from './dispatch.js';
import { createAgentStore } from './model.js';

const BROADCAST_MS = 50;

/** @param {{ projectDir: string, dispatch: string | null, hub: { broadcast(event: string, data: unknown): void }, modules: object }} ctx */
export async function setup(ctx, { fetchImpl } = {}) {
  const dispatch = { url: await resolveDispatchUrl(ctx.projectDir, ctx.dispatch), connected: false };
  let timer = null;

  const payload = () => ({ dispatch: { ...dispatch }, agents: store.list() });
  const scheduleBroadcast = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      ctx.hub.broadcast('agents', payload());
    }, BROADCAST_MS);
  };
  const store = createAgentStore(ctx.projectDir, scheduleBroadcast);

  const unsubscribe = ctx.modules.watch?.api?.onChange?.((change) => store.attribute(change));

  const follower = dispatch.url
    ? followDispatch(
        dispatch.url,
        {
          onSessions: (list) => store.replaceAll(list),
          onSession: (s) => store.upsert(s),
          onRemoved: (id) => store.remove(id),
          onStatus: (ok) => {
            if (dispatch.connected === ok) return;
            dispatch.connected = ok;
            if (ok) console.log(`agents: following Dispatch at ${dispatch.url}`);
            else console.log(`agents: Dispatch at ${dispatch.url} not reachable, retrying`);
            scheduleBroadcast();
          },
        },
        fetchImpl ? { fetchImpl } : undefined,
      )
    : null;

  return {
    api: { list: store.list, agentForDir: store.agentForDir, attribute: store.attribute },
    routes: [{ method: 'GET', path: '/api/agents', handler: (req, res) => sendJson(res, payload()) }],
    close() {
      clearTimeout(timer);
      unsubscribe?.();
      follower?.close();
    },
  };
}

function sendJson(res, body) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
