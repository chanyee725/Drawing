// Dispatch module: agent sessions, task board and usage limits for the git project that holds the
// workspace (merged from the standalone Dispatch server, issue #87). See docs/design/dispatch-integration.md.
//
// Writes: <project>/.dispatch/ (state.json, session worktrees) and ~/.dispatch/limits.json (usage
// limits shared with other servers). Transcripts stay in memory. Off when the workspace is not in a
// git project: the drawing tool works on its own.
import path from "node:path";
import { runCli } from "./cli.js";
import { cancelLogin, login, logout, providerStatus, publicStatus } from "./auth.js";
import { Burn } from "./burn.js";
import { Store } from "./dispatch-store.js";
import { currentBranch } from "./git.js";
import { Hub } from "./hub.js";
import { SharedLimits } from "./limits.js";
import { codexModels, staticModels } from "./models.js";
import { PERMS, ROLES } from "./roles.js";
import { adapt, routeTable } from "./routes.js";
import { effectiveRoles, teamSettings } from "./settings.js";

/** Hub events forwarded to the shared SSE stream; none collides with Drawing's `workspace`. */
export const HUB_EVENTS = ["session", "message", "limits", "removed", "tasks", "tickets"];
const THEMES = ["system", "light", "dark", "monitor"];

/** The git top level that holds dir, or null when dir is not in a git work tree. */
export async function gitTop(dir) {
  try { return (await runCli("git", ["-C", dir, "rev-parse", "--show-toplevel"])).stdout.trim() || null; } catch { return null; }
}

/** Every provider "not checked yet": what the UI shows before a provider is connected. */
const UNCHECKED = Object.fromEntries(["gemini", "claude", "openai"].map(id => [id, { installed: null, connected: false, busy: false, url: null, error: null }]));

/**
 * Starts Dispatch for the project at `root`. `deps` replaces the parts that start CLIs or touch the
 * home folder, so tests run with fakes: { providerStatus, codexModels, limitsFile, login, logout, cancelLogin,
 * spawnCli } (spawnCli as in ./cli.js: the session runners start every agent CLI through it).
 */
export async function createDispatch({ root, broadcast, port, deps = {} }) {
  const dep = { providerStatus, codexModels, login, logout, cancelLogin, ...deps };
  const store = new Store(root);
  await store.load();
  const models = staticModels();
  // Claude limits and the Gemini quota live in ~/.dispatch/limits.json, shared by every server.
  const limits = new SharedLimits(...(dep.limitsFile ? [dep.limitsFile] : []));
  await limits.load({ claude: store.data.limits, gemini: store.data.geminiQuota }).catch(e => console.error("dispatch limits:", e.code ?? e.name));
  if ("limits" in store.data || "geminiQuota" in store.data) { delete store.data.limits; delete store.data.geminiQuota; store.save(); }
  const hub = new Hub({ root, store, models, roles: ROLES, port, limits, spawnCli: dep.spawnCli });

  // A provider counts as connected only after the user connects it here, even if its CLI is already
  // logged in on this machine (`cliLoggedIn` keeps the CLI's own state). Until one is connected no
  // CLI is started at all, not even for a status check.
  const enabled = () => store.data.settings.enabled || {};
  const anyEnabled = () => Object.values(enabled()).some(Boolean);
  const decorate = raw => {
    const out = {};
    for (const [id, p] of Object.entries(publicStatus(raw))) out[id] = { ...p, cliLoggedIn: p.connected, connected: p.connected && !!enabled()[id] };
    return out;
  };
  let providers = decorate(UNCHECKED);
  let codexLoaded = false;
  async function refreshProviders() {
    providers = decorate(await dep.providerStatus());
    if (enabled().openai && !codexLoaded) {
      codexLoaded = true;
      for (const m of await dep.codexModels()) if (!models.some(x => x.id === m.id)) models.push(m);
    }
    broadcast("providers", providers);
  }
  const setEnabled = (id, on) => {
    store.data.settings.enabled = { ...enabled(), [id]: on };
    store.save();
  };
  hub.isConnected = provider => !!providers[provider]?.connected;
  hub.burn = new Burn(store); // $/h per session and the burnWarn flag, on every session object

  for (const ev of HUB_EVENTS) hub.on(ev, data => broadcast(ev, data));

  // UI preferences, kept in the project's state.json (no file in the home folder).
  const readPrefs = async () => ({ theme: THEMES.includes(store.data.prefs?.theme) ? store.data.prefs.theme : "system" });
  async function writePrefs(patch) {
    const next = await readPrefs();
    if (THEMES.includes(patch.theme)) next.theme = patch.theme;
    store.data.prefs = next;
    store.save();
    broadcast("prefs", next);
    return next;
  }

  const tilde = p => (process.env.HOME ? p.replace(process.env.HOME, "~") : p);
  async function snapshot() {
    return {
      project: { name: path.basename(root), path: tilde(root), branch: await currentBranch(root) },
      roles: effectiveRoles(ROLES, store), perms: PERMS, models, providers,
      limits: hub.currentLimits(), settings: { ...store.data.settings, team: teamSettings(store) },
      sessions: hub.sessions.map(s => hub.publicSession(s)),
      prefs: await readPrefs(),
      tasks: hub.tasks,
      tickets: hub.tickets,
    };
  }

  function usage() {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 864e5).toLocaleDateString("sv-SE");
      days.push({ day, ...(store.data.daily[day] || { cost: 0, models: {}, roles: {} }) });
    }
    return { days };
  }

  // Only this project: other servers are no longer found by registry files or port scans.
  const projects = async () => [{ port: hub.port, name: path.basename(root), path: tilde(root), current: true }];

  const d = {
    root, store, hub, models, broadcast, snapshot, usage, projects, readPrefs, writePrefs,
    providers: () => providers, refreshProviders, setEnabled,
    login: dep.login, logout: dep.logout, cancelLogin: dep.cancelLogin,
  };

  const timers = [];
  // Each timer is guarded on its own: a Hub error must not stop the server or the drawing routes.
  const every = (ms, name, fn) => timers.push(setInterval(async () => {
    try { await fn(); } catch (e) { console.error(`dispatch ${name}:`, e.code ?? e.name); }
  }, ms));

  return {
    ...d,
    routes: routeTable(d).map(adapt),
    /** Runs once the server listens (the Hub needs the port for MCP and hook URLs). */
    async listening() {
      every(30_000, "teams", () => hub.checkTeams());
      // Burn rates are per 30 minutes of wall time; recompute them even when no session event arrives.
      every(60_000, "burn", () => hub.refreshBurn());
      // Another server may have written newer limits; the Hub broadcasts a "limits" event when it did.
      every(5_000, "limits", () => limits.refresh());
      if (anyEnabled()) await refreshProviders().catch(e => console.error("dispatch providers:", e.code ?? e.name));
      try { hub.resumeInterrupted(); } catch (e) { console.error("dispatch resume:", e.code ?? e.name); }
    },
    async close() {
      for (const t of timers) clearInterval(t);
      hub.stopAll();
      await store.flush().catch(() => {});
    },
  };
}

/** Drawing module entry (server/modules.js). `deps` is for tests; ctx.spawnCli replaces the CLI seam. */
export async function setup(ctx, deps = {}) {
  if (!ctx.workspaceDir) return {};
  const root = await gitTop(ctx.workspaceDir);
  if (!root) return {};
  const d = await createDispatch({ root, broadcast: ctx.hub.broadcast, port: () => ctx.port, deps: { ...(ctx.spawnCli && { spawnCli: ctx.spawnCli }), ...deps } });
  // Each new SSE client gets the Dispatch snapshot first, as the standalone server sent it.
  ctx.hub.onAttach(async sendTo => sendTo("snapshot", await d.snapshot()));
  return d;
}
