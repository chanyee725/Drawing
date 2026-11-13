// PR and CI tracking through `gh` (E23). Metadata only: PR number, PR state and a CI rollup state.
// No title, body, author, branch text or check names are kept. `gh` starts only through cli.js.
//
// Per-workspace switch: <workspace>/.drawing/settings.json { "prStatus": false } turns it off
// (default on). Off, or a missing gh, never throws: the result says why.
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { runCli } from "./cli.js";
import { ensureDirInside } from "../lock.js";

export const PR_DEFAULTS = { timeoutMs: 8000, cacheMs: 30000, minGapMs: 1000 };

const settingsFile = workspaceDir => path.join(workspaceDir, ".drawing", "settings.json");

const isPlainObject = v => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Reads settings.json as a plain object. A missing file is {}. Bad JSON or anything that is not a
 * plain object (array, string, null) throws, so a writer never replaces the user's file with a stub.
 */
async function readSettings(workspaceDir) {
  let text;
  try { text = await readFile(settingsFile(workspaceDir), "utf8"); } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  let value;
  try { value = JSON.parse(text); } catch {
    throw Object.assign(new Error("settings.json is not valid JSON"), { code: "ESETTINGS" });
  }
  if (!isPlainObject(value)) throw Object.assign(new Error("settings.json is not a JSON object"), { code: "ESETTINGS" });
  return value;
}

/** Whether PR tracking is on for a workspace folder (default true; an unreadable file counts as default). */
export async function prTrackingEnabled(workspaceDir) {
  try { return (await readSettings(workspaceDir)).prStatus !== false; } catch { return true; }
}

/** Like prTrackingEnabled, but throws (code ESETTINGS) when settings.json is not a valid JSON object. */
export async function readPrTracking(workspaceDir) {
  return (await readSettings(workspaceDir)).prStatus !== false;
}

/**
 * Turns PR tracking on or off for a workspace folder; other settings in the file stay.
 * Refuses (throws, code ESETTINGS) when settings.json is not a valid JSON object, instead of overwriting it.
 */
export async function setPrTracking(workspaceDir, on) {
  const cur = await readSettings(workspaceDir);
  const file = settingsFile(workspaceDir);
  // .drawing must be a real folder inside the workspace; settings.json must not be a symlink.
  await ensureDirInside(workspaceDir, path.dirname(file));
  try {
    if (!(await lstat(file)).isFile()) throw new Error("settings.json is not a regular file");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ ...cur, prStatus: !!on }, null, 2) + "\n", { flag: "wx" });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return !!on;
}

const STATES = new Set(["open", "closed", "merged"]);
const CI = new Set(["success", "failure", "pending"]);

/** Collapses gh's statusCheckRollup (check runs and commit statuses) into success | failure | pending | none. */
export function rollupCi(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return "none";
  let pending = false;
  for (const c of rollup) {
    const raw = String(c?.conclusion || c?.state || c?.status || "").toUpperCase();
    if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(raw)) return "failure";
    if (!["SUCCESS", "NEUTRAL", "SKIPPED"].includes(raw)) pending = true;
  }
  return pending ? "pending" : "success";
}

function classify(err) {
  const text = `${err?.stderr ?? ""}\n${err?.message ?? ""}`.toLowerCase();
  if (err?.code === "ENOENT") return "gh-missing";
  if (err?.killed || err?.code === "ETIMEDOUT") return "timeout";
  if (/no pull requests? found|could not resolve to a pullrequest/.test(text)) return "no-pr";
  if (/gh auth login|not logged in|authentication|gh_token|http 401/.test(text)) return "not-logged-in";
  return "error";
}

/** A git branch name only: ref characters, no "..", not starting with "-" or "/", not all digits (gh would read a PR number). */
export function validBranch(branch) {
  return typeof branch === "string" && branch.length > 0 && branch.length <= 255
    && /^[A-Za-z0-9._/-]+$/.test(branch) && !/^[-/]/.test(branch) && !branch.includes("..") && !/^\d+$/.test(branch);
}

/**
 * Makes `prStatus(branch)`. Resolves to one of
 *   { ok: true, pr: { number, state: "open"|"closed"|"merged", ci: "success"|"failure"|"pending"|"none" } }
 *   { ok: false, reason: "disabled"|"gh-missing"|"not-logged-in"|"no-pr"|"timeout"|"invalid-branch"|"error" }
 * and never throws. Answers are cached per branch (cacheMs, `force: true` skips the cache) and gh
 * starts at most once per minGapMs, so a run watching many steps does not hammer GitHub.
 * `cwd` (required) is the git project folder (gh reads the repo from it); `env` is for tests (fake gh on PATH).
 */
export function createPrStatus({ workspaceDir, cwd, env, run = runCli, now = Date.now, timeoutMs = PR_DEFAULTS.timeoutMs, cacheMs = PR_DEFAULTS.cacheMs, minGapMs = PR_DEFAULTS.minGapMs } = {}) {
  const cache = new Map(); // branch -> { at, result }
  const inflight = new Map();
  let lastStart = 0;

  async function fetchOne(branch) {
    // Reserve this call's start slot before waiting, so overlapping calls queue up minGapMs apart.
    const start = Math.max(now(), lastStart + minGapMs);
    lastStart = start;
    const wait = start - now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      const { stdout } = await run("gh", ["pr", "view", "--json", "number,state,statusCheckRollup", "--", branch], { cwd, env, timeout: timeoutMs, maxBuffer: 1 << 20 });
      const j = JSON.parse(stdout);
      const state = String(j.state || "").toLowerCase();
      const number = Number(j.number);
      if (!STATES.has(state) || !Number.isInteger(number)) return { ok: false, reason: "error" };
      const ci = rollupCi(j.statusCheckRollup);
      return { ok: true, pr: { number, state, ci: CI.has(ci) ? ci : "none" } };
    } catch (e) {
      return { ok: false, reason: classify(e) };
    }
  }

  return async function prStatus(branch, { force = false } = {}) {
    if (workspaceDir && !(await prTrackingEnabled(workspaceDir))) return { ok: false, reason: "disabled" };
    if (!validBranch(branch)) return { ok: false, reason: "invalid-branch" };
    // gh reads the repo from cwd; without it gh would ask about whatever repo the server runs in.
    if (typeof cwd !== "string" || !cwd) return { ok: false, reason: "error" };
    const hit = cache.get(branch);
    if (!force && hit && now() - hit.at < cacheMs) return hit.result;
    if (inflight.has(branch)) return inflight.get(branch);
    const p = fetchOne(branch).then(result => {
      const at = now();
      for (const [b, e] of cache) if (at - e.at >= cacheMs) cache.delete(b); // drop expired answers
      cache.set(branch, { at, result });
      return result;
    }).finally(() => inflight.delete(branch));
    inflight.set(branch, p);
    return p;
  };
}
