// T4: Dispatch agents feed (read-only).
// - Follows the project's Dispatch server (GET /api/state + SSE /api/events).
// - Maps each session to its worktree folder and attributes watch changes to it.
// - Pushes `agents` events on the hub and serves GET /api/agents.
// Stores only names, roles, status, one activity line and what changed.
// The activity line comes from the session's conversation, so it is sent only to clients
// that opt in with `?activity=1` (GET /api/agents and SSE /api/events).
import { resolveDispatchUrl, followDispatch } from './dispatch.js';
import { createAgentStore } from './model.js';
import { clientOptions } from '../events.js';

const BROADCAST_MS = 50;

/** @param {{ projectDir: string, dispatch: string | null, hub: { broadcast(event: string, data: unknown): void }, modules: object }} ctx */
export async function setup(ctx, { fetchImpl } = {}) {
  const dispatch = { url: await resolveDispatchUrl(ctx.projectDir, ctx.dispatch), connected: false };
  let timer = null;

  const payload = ({ activity = false } = {}) => ({
    dispatch: { ...dispatch },
    agents: activity ? store.list() : store.list().map(withoutActivity),
  });
  const scheduleBroadcast = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      ctx.hub.broadcast('agents', payload);
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
    routes: [{ method: 'GET', path: '/api/agents', handler: (req, res, _ctx, _match, url) => sendJson(res, payload(clientOptions(url))) }],
    close() {
      clearTimeout(timer);
      unsubscribe?.();
      follower?.close();
    },
  };
}

/** Drop the conversation-derived line; names, roles, status and changes stay. */
export function withoutActivity({ activity, activityAt, ...a }) {
  return a;
}

function sendJson(res, body) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
