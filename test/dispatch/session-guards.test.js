// Review fixes for E11 (#106): modes and efforts are checked on create, agy never runs looser than
// the chosen mode, and limit tickets keep reply clips out of state.json.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkEffort, checkPerm, Hub } from "../../server/dispatch/hub.js";
import { diskView, Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const MODELS = [
  { id: "claude-haiku-5-5", provider: "claude", efforts: ["low", "medium", "high"], contextWindow: 200000 },
  { id: "gemini-3.8-flash-low", provider: "gemini", efforts: ["low", "high"], contextWindow: 1000000 },
  { id: "gpt-x", provider: "openai", efforts: ["low", "high"], contextWindow: 200000 },
];
const ROLES = [{ id: "impl", name: "구현자", model: "claude-haiku-5-5", perm: "auto", prompt: "" }];

async function makeHub() {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-dispatch-guard-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  const limits = new SharedLimits(path.join(root, "limits.json"));
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits });
  return { root, store, hub };
}

test("checkPerm refuses unknown modes and the modes agy cannot honour", () => {
  for (const p of ["manual", "acceptEdits", "auto", "plan"]) assert.equal(checkPerm("claude", p), p);
  for (const bad of ["bypassPermissions", "", undefined, "dontAsk"]) {
    assert.throws(() => checkPerm("claude", bad), e => e.status === 400);
  }
  assert.equal(checkPerm("gemini", "plan"), "plan");
  assert.equal(checkPerm("gemini", "auto"), "auto");
  assert.throws(() => checkPerm("gemini", "manual"), e => e.status === 400);
  assert.throws(() => checkPerm("gemini", "acceptEdits"), e => e.status === 400);
});

test("checkEffort only passes the model's own plain effort words", () => {
  const m = { efforts: ["low", "high"] };
  assert.equal(checkEffort(m, null), null);
  assert.equal(checkEffort(m, ""), null);
  assert.equal(checkEffort(m, "high"), "high");
  assert.throws(() => checkEffort(m, "max"), e => e.status === 400);
  assert.throws(() => checkEffort(m, 'high"\nsandbox_mode="danger-full-access'), e => e.status === 400);
  // A catalog value that is not a plain word is never trusted.
  assert.throws(() => checkEffort({ efforts: ['x"y'] }, 'x"y'), e => e.status === 400);
});

test("create refuses a bad perm or effort before making any session", async () => {
  const { store, hub } = await makeHub();
  const cases = [
    [{ role: "impl", perm: "bypassPermissions" }],
    [{ role: "impl", effort: "ultra" }],
    [{ role: "impl", model: "gemini-3.8-flash-low", perm: "manual" }],
    [{ role: "impl", model: "gpt-x", effort: 'high"\nsandbox_mode="danger-full-access' }],
    // One good item and one bad one: nothing is made.
    [{ role: "impl" }, { role: "impl", perm: "bypassPermissions" }],
  ];
  for (const items of cases) {
    await assert.rejects(hub.create({ items, commonPrompt: "hi", worktree: false }), e => e.status === 400, JSON.stringify(items));
  }
  assert.deepEqual(store.data.sessions, {});
  assert.equal(store.data.seq, 0);
});

// A fake `agy` on a PATH that holds nothing else, so no real CLI can start.
function fakeBin() {
  const bin = mkdtempSync(path.join(tmpdir(), "drawing-fake-bin-"));
  dirs.push(bin);
  const log = path.join(bin, "args.json");
  const script = `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`;
  writeFileSync(path.join(bin, "agy"), script);
  chmodSync(path.join(bin, "agy"), 0o755);
  return { bin, log };
}

async function waitFor(file) {
  for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise(r => setTimeout(r, 20));
  return JSON.parse(readFileSync(file, "utf8"));
}

function geminiSession(root, perm) {
  return {
    id: `g-${perm}`, n: 1, name: "Gem", role: "impl", provider: "gemini", model: "gemini-3.8-flash-low",
    effort: null, perm, prompt: "", canSpawn: false, cwd: root, status: "idle", startedAt: 0, updatedAt: 0,
    last: "", turns: 0, ctx: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerSessionId: null,
  };
}

test("agy gets --mode <perm> and never the skip flag", async () => {
  const { root, store, hub } = await makeHub();
  const oldPath = process.env.PATH;
  try {
    for (const perm of ["auto", "plan"]) {
      const { bin, log } = fakeBin();
      process.env.PATH = bin;
      const s = geminiSession(root, perm);
      store.data.sessions[s.id] = s;
      hub.start(s, "hi");
      const args = await waitFor(log);
      assert.equal(args[args.indexOf("--mode") + 1], perm);
      assert.equal(args.includes("--dangerously-skip-permissions"), false, perm);
    }
  } finally {
    process.env.PATH = oldPath;
  }
});

test("a saved gemini session in manual is stopped, not started looser", async () => {
  const { root, store, hub } = await makeHub();
  const oldPath = process.env.PATH;
  const { bin, log } = fakeBin();
  try {
    process.env.PATH = bin;
    const s = geminiSession(root, "manual");
    store.data.sessions[s.id] = s;
    hub.start(s, "hi");
    await new Promise(r => setTimeout(r, 150));
    assert.equal(existsSync(log), false);
    assert.equal(s.status, "error");
  } finally {
    process.env.PATH = oldPath;
  }
  assert.throws(() => hub.setPerm("g-manual", "acceptEdits"), e => e.status === 400);
  assert.throws(() => hub.setPerm("g-manual", "bypassPermissions"), e => e.status === 400);
});

test("limit tickets keep leadLast and team[].last in memory only", async () => {
  const { root, store } = await makeHub();
  store.data.tickets = {
    t1: {
      id: "t1", lead: "a", status: "open", reason: "5시간 한도", items: [{ title: "x", stage: "doing" }],
      leadLast: "secret lead reply", team: [{ name: "Juno", status: "running", branch: "feat/x", last: "secret team reply" }],
    },
  };
  const view = diskView(store.data);
  assert.equal("leadLast" in view.tickets.t1, false);
  assert.deepEqual(view.tickets.t1.team, [{ name: "Juno", status: "running", branch: "feat/x" }]);
  // Memory still has them for the resume message.
  assert.equal(store.data.tickets.t1.leadLast, "secret lead reply");
  await store.flush();
  const disk = readFileSync(path.join(root, ".dispatch", "state.json"), "utf8");
  assert.doesNotMatch(disk, /secret/);
  assert.equal(JSON.parse(disk).tickets.t1.team[0].branch, "feat/x");
});
