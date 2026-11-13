// Dispatch HTTP API as Drawing module routes. Paths are the ones the standalone Dispatch server had
// (so mcp.js, the skills and the hook keep working); only /api/events is shared, see index.js.
import { branchGraph, diff } from "./git.js";
import { ROLES } from "./roles.js";
import { patchTeam, teamSettings } from "./settings.js";

const MAX_BODY = 1e6;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Message text must say something: an empty send used to wake a session with a blank turn. */
const required = text => {
  const t = String(text ?? "").trim();
  if (!t) throw fail(400, "text가 비어 있어요");
  return t;
};

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw fail(413, "body too large");
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw fail(400, "invalid JSON"); }
}

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

/**
 * Writes need a custom header: a browser can't send it cross-origin without a preflight we never
 * approve. x-drawing: 1 is Drawing's own; x-dispatch: 1 is accepted for the plugin's hook.
 */
export const writeAllowed = headers => headers["x-drawing"] === "1" || headers["x-dispatch"] === "1";

/**
 * Wraps a Dispatch table entry [method, RegExp, fn(params, body)] as a Drawing route. Errors are
 * answered as { error } with e.status || 400, like the standalone server; a thrown error never
 * reaches the app's 500 handler, so one failing Dispatch call can't affect drawing routes.
 */
export function adapt([method, path, fn]) {
  return {
    method,
    path,
    async handler(req, res, _ctx, match) {
      try {
        if (method !== "GET" && !writeAllowed(req.headers)) return send(res, 403, { error: "forbidden" });
        const body = method === "GET" ? {} : await readBody(req);
        send(res, 200, await fn(match.slice(1), body ?? {}));
      } catch (e) {
        if (!res.headersSent) send(res, e.status || 400, { error: e.message });
        else res.end();
      }
    },
  };
}

/**
 * The route table. `d` is the running Dispatch instance from index.js:
 * { root, store, hub, models, broadcast, snapshot, usage, projects, readPrefs, writePrefs,
 *   providers(), refreshProviders, setEnabled, login, cancelLogin, logout }
 */
export function routeTable(d) {
  const { root, store, hub, models, broadcast } = d;
  const session = id => {
    const s = hub.get(id);
    if (!s) throw fail(404, "세션이 없어요");
    return s;
  };
  return [
    ["GET", /^\/api\/state$/, async () => d.snapshot()],
    ["GET", /^\/api\/usage$/, async () => d.usage()],
    // Other projects are no longer probed over the network: this server's own usage only.
    ["GET", /^\/api\/usage\/all$/, async () => ({ projects: (await d.projects()).map(p => ({ ...p, ...d.usage() })) })],
    ["GET", /^\/api\/prefs$/, async () => d.readPrefs()],
    ["POST", /^\/api\/prefs$/, async (_, b) => d.writePrefs(b || {})],
    ["GET", /^\/api\/projects$/, async () => ({ projects: await d.projects() })],
    ["POST", /^\/api\/settings$/, async (_, b) => {
      if (b.guard) store.data.settings.guard = { ...store.data.settings.guard, ...b.guard };
      if (b.team) patchTeam(store, b.team, { roles: ROLES, models });
      store.save();
      const settings = { ...store.data.settings, team: teamSettings(store) };
      broadcast("settings", settings);
      // Role default models live in the snapshot's roles, so a model change re-sends the snapshot.
      if (b.team?.roleModels) broadcast("snapshot", await d.snapshot());
      return settings;
    }],
    ["POST", /^\/api\/sessions$/, async (_, b) => ({
      sessions: await hub.create({ items: b.items || [], commonPrompt: b.commonPrompt || "", worktree: b.worktree !== false, parent: b.parent || null }),
    })],
    ["GET", /^\/api\/sessions\/([\w-]+)\/messages$/, async ([id]) => ({ session: hub.publicSession(session(id)), messages: hub.transcript(id) })],
    ["GET", /^\/api\/sessions\/([\w-]+)\/diff$/, async ([id]) => diff(session(id).cwd, root)],
    ["POST", /^\/api\/sessions\/([\w-]+)\/message$/, async ([id], b) => { hub.send(id, required(b?.text)); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/interrupt$/, async ([id]) => { hub.interrupt(id); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/kill$/, async ([id]) => { hub.kill(id); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/remove$/, async ([id]) => { hub.remove(id); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/clear$/, async () => ({ removed: hub.clearAll() })],
    ["POST", /^\/api\/sessions\/clear-done$/, async () => ({ removed: hub.clearDone() })],
    ["GET", /^\/api\/limits$/, async () => hub.providerLimits()],
    ["GET", /^\/api\/timeline$/, async () => hub.timeline()],
    ["GET", /^\/api\/tasks$/, async () => ({ tasks: hub.tasks })],
    ["GET", /^\/api\/branches$/, async () => branchGraph(root, { active: hub.sessions.filter(x => x.status !== "done" && x.branch).map(x => x.branch) })],
    ["GET", /^\/api\/tickets$/, async () => ({ tickets: hub.tickets })],
    ["POST", /^\/api\/tickets\/([\w-]+)\/resume$/, async ([id]) => ({ ok: hub.resumeTicket(id) })],
    ["POST", /^\/api\/tickets\/([\w-]+)\/close$/, async ([id]) => { hub.closeTicket(id); return { ok: true }; }],
    ["POST", /^\/api\/tasks$/, async (_, b) => {
      const isNew = !b?.id;
      const t = await hub.setTask(b?.lead || null, b || {});
      // Creating by title: show the lead what is already open so a renamed copy of the same work stands out.
      return isNew && t.lead ? { ...t, open: hub.openTasks(t.lead, t.id) } : t;
    }],
    ["POST", /^\/api\/tasks\/([\w-]+)\/remove$/, async ([id]) => { hub.removeTask(id); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/to-lead$/, async ([id], b) => { hub.messageLead(id, required(b?.text)); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/parent$/, async ([id], b) => { hub.setParent(id, b.parent ? String(b.parent) : null); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/perm$/, async ([id], b) => { hub.setPerm(id, String(b.perm || "")); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/permission$/, async ([id], b) => {
      hub.respondPermission(id, b.requestId, b.behavior === "allow" ? "allow" : "deny", !!b.always);
      return { ok: true };
    }],
    // Already logged in on this machine → just connect; otherwise run the CLI's browser login first.
    ["POST", /^\/api\/providers\/(claude|openai|gemini)\/login$/, async ([id]) => {
      if (!d.providers()[id]?.cliLoggedIn) await d.refreshProviders();
      if (d.providers()[id]?.cliLoggedIn) { d.setEnabled(id, true); await d.refreshProviders(); return { ok: true, connected: true }; }
      d.login(id, d.refreshProviders, ok => ok && d.setEnabled(id, true));
      return { ok: true, connected: false };
    }],
    ["POST", /^\/api\/providers\/(claude|openai|gemini)\/cancel$/, async ([id]) => { d.cancelLogin(id); return { ok: true }; }],
    // Disconnects from Drawing only; the CLI stays logged in unless `cli: true` is passed.
    ["POST", /^\/api\/providers\/(claude|openai|gemini)\/logout$/, async ([id], b) => {
      d.setEnabled(id, false);
      if (b.cli) await d.logout(id);
      await d.refreshProviders();
      return { ok: true };
    }],
    // No API-key route: a key would pass through this server. Use `codex login --with-api-key` in a terminal.
    ["POST", /^\/api\/providers\/refresh$/, async () => { await d.refreshProviders(); return d.providers(); }],
  ];
}
