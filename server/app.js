// HTTP app: API routes from feature modules, SSE hub, static files from public/.
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
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
 * ctx = { workspaceDir, projectMode, hub, modules, port } where modules holds each module's
 * setup() result by name, so later modules can use earlier ones; port is the listening port
 * (0 before listen).
 */
// Project mode serves the run screen only. Document/file writes of the editor stay closed; the /dispatch UI never
// calls them. Kept open: /api/pipeline/* (plan, start, stop, ...), PATCH /api/file/plan (agents' step edits), /api/sessions/*.
const PROJECT_MODE_BLOCKED = [
  ['PUT', /^\/api\/file$/],
  ['POST', /^\/api\/file$/],
  ['DELETE', /^\/api\/file$/],
  ['POST', /^\/api\/folder$/],
  ['DELETE', /^\/api\/folder$/],
  ['POST', /^\/api\/move$/],
  ['POST', /^\/api\/trash\/restore$/],
  ['POST', /^\/api\/history$/],
  ['POST', /^\/api\/workspace\/pr-tracking$/],
];

/**
 * True for a path the SPA entry answers (index.html fallback): not /dispatch, not /api, and not a real asset.
 * A real asset is an existing file in publicDir (other than index.html) or anything under /assets/; a dotted
 * path such as /notes.v2 is just an editor route.
 */
export async function isEditorEntry(pathname, publicDir = PUBLIC_DIR) {
  if (/^\/(dispatch|api)(\/|$)/.test(pathname)) return false;
  if (pathname === '/index.html') return true;
  if (pathname.startsWith('/assets/')) return false;
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return true;
  }
  const root = publicDir.endsWith(sep) ? publicDir : publicDir + sep;
  const file = join(publicDir, rel);
  if (!file.startsWith(root)) return true;
  const st = await stat(file).catch(() => null);
  return !(st && st.isFile());
}

export async function createApp(opts = {}, { publicDir = PUBLIC_DIR, moduleList = modules } = {}) {
  const hub = createHub();
  let server = null;
  const ctx = {
    workspaceDir: opts.workspaceDir,
    projectMode: !!opts.projectMode,
    hub,
    modules: {},
    get port() {
      return server?.address()?.port ?? 0;
    },
  };
  const routes = [
    { method: 'GET', path: '/api/events', handler: (req, res) => hub.attach(req, res) },
    // Folder name only, never the full path.
    { method: 'GET', path: '/api/info', handler: (req, res) => sendJson(res, 200, { workspace: basename(ctx.workspaceDir ?? ''), mode: ctx.projectMode ? 'project' : 'drawing' }) },
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
        if (ctx.projectMode && PROJECT_MODE_BLOCKED.some(([m, re]) => m === req.method && re.test(url.pathname))) {
          return sendJson(res, 403, { error: 'project mode: documents are read-only here' });
        }
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const match = r.path instanceof RegExp ? url.pathname.match(r.path) : r.path === url.pathname ? [url.pathname] : null;
          if (match) return await r.handler(req, res, ctx, match, url);
        }
        return sendJson(res, 404, { error: 'not found' });
      }
      if (ctx.projectMode && (req.method === 'GET' || req.method === 'HEAD') && (await isEditorEntry(url.pathname, publicDir))) {
        res.writeHead(302, { location: '/dispatch', 'cache-control': 'no-store' });
        return res.end();
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
