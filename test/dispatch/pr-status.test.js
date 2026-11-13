import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, symlinkSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPrStatus, prTrackingEnabled, rollupCi, setPrTracking } from "../../server/dispatch/pr-status.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), "drawing-pr-")); dirs.push(d); return d; };

function fakeGh(scenario, extra = {}) {
  const bin = tmp(), ws = tmp();
  const file = path.join(bin, "gh");
  writeFileSync(file, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(path.join(HERE, "../fixtures/fake-cli/gh.mjs")).href)});\n`);
  chmodSync(file, 0o755);
  const sc = path.join(bin, "scenario.json");
  writeFileSync(sc, JSON.stringify(scenario));
  const log = path.join(bin, "calls.jsonl");
  const env = { PATH: bin, FAKE_GH_SCENARIO: sc, FAKE_CLI_LOG: log, ...extra };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0);
  return { bin, ws, env, calls };
}

const OK = { number: 88, state: "OPEN", title: "secret title", author: { login: "x" }, statusCheckRollup: [{ conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: "SKIPPED" }] };

test("returns number, state and ci only", async () => {
  const f = fakeGh({ "feat/a": OK });
  const get = createPrStatus({ workspaceDir: f.ws, env: f.env, minGapMs: 0 });
  assert.deepEqual(await get("feat/a"), { ok: true, pr: { number: 88, state: "open", ci: "success" } });
});

test("ci rollup states", () => {
  assert.equal(rollupCi([]), "none");
  assert.equal(rollupCi([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]), "failure");
  assert.equal(rollupCi([{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: "" }]), "pending");
  assert.equal(rollupCi([{ state: "SUCCESS" }]), "success");
});

test("no pr, not logged in, gh missing, timeout, bad branch", async () => {
  const f = fakeGh({ "b/auth": { error: "To get started with GitHub CLI, please run:  gh auth login" } });
  const get = createPrStatus({ workspaceDir: f.ws, env: f.env, minGapMs: 0 });
  assert.deepEqual(await get("b/none"), { ok: false, reason: "no-pr" });
  assert.deepEqual(await get("b/auth"), { ok: false, reason: "not-logged-in" });
  assert.deepEqual(await get("--web"), { ok: false, reason: "invalid-branch" });
  const missing = createPrStatus({ workspaceDir: f.ws, env: { PATH: tmp() }, minGapMs: 0 });
  assert.deepEqual(await missing("b/x"), { ok: false, reason: "gh-missing" });
  const slow = fakeGh({ "b/s": OK }, { FAKE_GH_SLOW: "2000" });
  const t = createPrStatus({ workspaceDir: slow.ws, env: slow.env, minGapMs: 0, timeoutMs: 100 });
  assert.deepEqual(await t("b/s"), { ok: false, reason: "timeout" });
});

test("caches per branch and force skips the cache", async () => {
  const f = fakeGh({ "feat/a": OK });
  const get = createPrStatus({ workspaceDir: f.ws, env: f.env, minGapMs: 0 });
  await get("feat/a"); await get("feat/a");
  assert.equal(f.calls(), 1);
  await get("feat/a", { force: true });
  assert.equal(f.calls(), 2);
});

test("per-workspace switch: default on, off never starts gh", async () => {
  const f = fakeGh({ "feat/a": OK });
  assert.equal(await prTrackingEnabled(f.ws), true);
  await setPrTracking(f.ws, false);
  assert.equal(await prTrackingEnabled(f.ws), false);
  const get = createPrStatus({ workspaceDir: f.ws, env: f.env, minGapMs: 0 });
  assert.deepEqual(await get("feat/a"), { ok: false, reason: "disabled" });
  assert.equal(f.calls(), 0);
  await setPrTracking(f.ws, true);
  assert.equal((await get("feat/a")).ok, true);
});

test("setPrTracking never writes outside the workspace through symlinks", async () => {
  // symlinked .drawing
  const a = fakeGh({}), outA = tmp();
  symlinkSync(outA, path.join(a.ws, ".drawing"));
  await assert.rejects(setPrTracking(a.ws, false));
  assert.deepEqual(readdirSync(outA), []);
  // symlinked settings.json
  const b = fakeGh({}), outB = tmp();
  const target = path.join(outB, "victim.json");
  writeFileSync(target, "{}");
  mkdirSync(path.join(b.ws, ".drawing"));
  symlinkSync(target, path.join(b.ws, ".drawing", "settings.json"));
  await assert.rejects(setPrTracking(b.ws, false));
  assert.equal(readFileSync(target, "utf8"), "{}");
  assert.deepEqual(readdirSync(outB), ["victim.json"]);
  assert.deepEqual(readdirSync(path.join(b.ws, ".drawing")), ["settings.json"]);
});
