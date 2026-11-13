// HTTP app: API routes from feature modules, SSE hub, static files from public/.
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub } from './events.js';
import { serveStatic } from './static.js';
import { modules } from './modules.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * Feature module contract (see server/modules.js):
 *   export async function setup(ctx) -> { routes?: Route[], close?: () => any }
 *   Route = { method: 'GET', path: '/api/x' | RegExp, handler(req, res, ctx, match, url) }
 *   match is the RegExp match (or [pathname] for a string path); url is the parsed URL.
 * Modules are closed in reverse setup order.
 * A module may also return listening(): run once the server listens (ctx.port is known then).
 * ctx = { workspaceDir, hub, modules, port } where modules holds each module's
 * setup() result by name, so later modules can use earlier ones; port is the listening port
 * (0 before listen).
 */
export async function createApp(opts = {}, { publicDir = PUBLIC_DIR, moduleList = modules } = {}) {
  const hub = createHub();
  let server = null;
  const ctx = {
    workspaceDir: opts.workspaceDir,
    hub,
    modules: {},
    get port() {
      return server?.address()?.port ?? 0;
    },
  };
  const routes = [
    { method: 'GET', path: '/api/events', handler: (req, res) => hub.attach(req, res) },
    // Folder name only, never the full path.
    { method: 'GET', path: '/api/info', handler: (req, res) => sendJson(res, 200, { workspace: basename(ctx.workspaceDir ?? '') }) },
  ];
  const closers = [];
  const listeners = [];

  for (const { name, setup } of moduleList) {
    const m = (await setup(ctx)) ?? {};
    ctx.modules[name] = m;
    if (m.routes) routes.push(...m.routes);
    if (m.close) closers.push(m.close);
    if (m.listening) listeners.push([name, m.listening]);
  }

  server = createServer(async (req, res) => {
    // DNS rebinding guard: only answer requests addressed to this loopback port.
    if (!isAllowedHost(req.headers.host, server.address()?.port)) {
      return sendJson(res, 403, { error: 'forbidden host' });
    }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD' && !writeAllowed(req.headers)) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const match = r.path instanceof RegExp ? url.pathname.match(r.path) : r.path === url.pathname ? [url.pathname] : null;
          if (match) return await r.handler(req, res, ctx, match, url);
        }
        return sendJson(res, 404, { error: 'not found' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
      return await serveStatic(req, res, url.pathname, publicDir);
    } catch (err) {
      // err.message can hold absolute paths; log only the error kind.
      console.error('request failed:', err.code ?? err.name);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    }
  });

  server.on('listening', async () => {
    for (const [name, fn] of listeners) {
      try {
        await fn();
      } catch (err) {
        console.error(`${name} start failed:`, err?.code ?? err?.name);
      }
    }
  });

  async function close() {
    hub.closeAll();
    for (const c of [...closers].reverse()) await c();
    const closed = new Promise((r) => server.close(r));
    server.closeAllConnections(); // don't wait for idle keep-alive sockets
    await closed;
  }

  return { server, ctx, close };
}

/**
 * Every non-GET /api request needs a custom header: a browser can't send it cross-origin without a
 * preflight this server never approves, so another site can't write here. x-drawing: 1 is
 * Drawing's own; x-dispatch: 1 is accepted for the Dispatch plugin.
 */
export function writeAllowed(headers) {
  return headers['x-drawing'] === '1' || headers['x-dispatch'] === '1';
}

export function isAllowedHost(host, port) {
  if (!host || !port) return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}
