// Read-only Dispatch client: GET /api/state and the GET /api/events SSE stream.
// This module only ever issues GET requests; it never posts to Dispatch.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSseParser } from './sse.js';

/** Dispatch base URL from --dispatch, else `<project>/.dispatch/server.port`, else null. */
export async function resolveDispatchUrl(projectDir, override) {
  if (override) return override.replace(/\/+$/, '');
  try {
    const port = Number((await readFile(join(projectDir, '.dispatch', 'server.port'), 'utf8')).trim());
    if (Number.isInteger(port) && port > 0 && port < 65536) return `http://127.0.0.1:${port}`;
  } catch {}
  return null;
}

/**
 * Follow a Dispatch server. Calls handlers.onSessions(list) for a full state,
 * onSession(s) for one update, onRemoved(id), onStatus(connected).
 * Reconnects with backoff. Returns { close() }.
 */
export function followDispatch(baseUrl, handlers, { fetchImpl = fetch, retryMs = 1000, maxRetryMs = 30_000 } = {}) {
  let closed = false;
  let ctrl = null;
  let timer = null;
  let delay = retryMs;
  const get = (path, signal) => fetchImpl(`${baseUrl}${path}`, { method: 'GET', signal, headers: { accept: path === '/api/events' ? 'text/event-stream' : 'application/json' } });

  function onEvent(name, data) {
    // `message` events carry transcript entries; never parse them.
    if (name !== 'snapshot' && name !== 'session' && name !== 'removed') return;
    let d;
    try {
      d = JSON.parse(data);
    } catch {
      return;
    }
    if (name === 'snapshot') handlers.onSessions?.(Array.isArray(d?.sessions) ? d.sessions : []);
    else if (name === 'session') handlers.onSession?.(d);
    else if (name === 'removed' && d?.id != null) handlers.onRemoved?.(d.id);
  }

  async function run() {
    ctrl = new AbortController();
    try {
      const st = await get('/api/state', ctrl.signal);
      if (!st.ok) throw new Error(`state ${st.status}`);
      const state = await st.json();
      handlers.onSessions?.(Array.isArray(state?.sessions) ? state.sessions : []);

      const res = await get('/api/events', ctrl.signal);
      if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
      handlers.onStatus?.(true);
      delay = retryMs;
      const parser = createSseParser(onEvent);
      const decoder = new TextDecoder();
      for await (const chunk of res.body) parser.feed(decoder.decode(chunk, { stream: true }));
      throw new Error('events stream ended');
    } catch (err) {
      if (closed) return;
      handlers.onStatus?.(false, err.message);
      timer = setTimeout(run, delay);
      delay = Math.min(delay * 2, maxRetryMs);
    }
  }

  run();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      ctrl?.abort();
    },
  };
}
