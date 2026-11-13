// Key- and email-shaped text is masked before it reaches memory, the UI or disk, and state.json
// keeps metadata only (no prompt, CLI error, task note or ticket item note).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MASK, redact } from "../../server/dispatch/redact.js";
import { Hub } from "../../server/dispatch/hub.js";
import { diskView, Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// Built from parts so this file holds no key-shaped literal of its own.
const KEY = ["sk", "ant", "api03", "x".repeat(24)].join("-");
const GH = "ghp_" + "a1".repeat(15);
const MAIL = ["someone", "example.com"].join("@");

test("redact masks emails, provider keys, JWTs and secret assignments", () => {
  const cases = [
    [`write to ${MAIL} please`, `write to ${MASK} please`],
    [`key ${KEY} end`, `key ${MASK} end`],
    [`token ${GH}`, `token ${MASK}`],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", `Authorization: Bearer ${MASK}`],
    ['api_key="abcd1234efgh5678"', `api_key="${MASK}"`],
    [`${"AKIA"}ABCDEFGHIJKLMNOP`, MASK],
    [`eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop`, MASK],
  ];
  for (const [input, want] of cases) assert.equal(redact(input), want, input);
});

test("redact leaves ordinary agent output alone", () => {
  for (const t of ["npm test -- auth.spec.ts:42", "git push origin HEAD:feat/x", "git@github.com:owner/repo.git",
    "see src/a.ts@main", "token: 1234", "commit 8b05c02 on develop", "@types/node 22", ""]) {
    assert.equal(redact(t), t, t);
  }
  assert.equal(redact(null), null);
  assert.equal(redact(42), 42);
});

const MODELS = [{ id: "claude-haiku-5-5", provider: "claude", efforts: ["low"], contextWindow: 200000 }];
const ROLES = [{ id: "impl", name: "구현자", model: "claude-haiku-5-5", perm: "plan", prompt: "ROLE PROMPT" }];

async function makeHub() {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-redact-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  store.save = () => {}; // no delayed write into a folder the test removes; the test flushes itself
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: () => { throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  const s = { id: "s1", n: 1, name: "Juno", role: "impl", provider: "claude", model: "claude-haiku-5-5", effort: null, perm: "plan",
    prompt: `custom prompt for ${MAIL}`, canSpawn: false, cwd: root, status: "idle", startedAt: 0, updatedAt: 0, last: "", turns: 0,
    ctx: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerSessionId: null, error: null };
  store.data.sessions[s.id] = s;
  return { root, store, hub, s };
}

test("the transcript ring buffer, errors and the task board get masked text", async () => {
  const { hub, s } = await makeHub();
  hub.push(s, { kind: "assistant", text: `my key is ${KEY}` });
  assert.equal(hub.transcript("s1").at(-1).text, `my key is ${MASK}`);
  hub.touch(s, { status: "error", error: `auth failed for ${MAIL}`, last: `ping ${MAIL}` });
  assert.equal(s.error, `auth failed for ${MASK}`);
  assert.equal(s.last, `ping ${MASK}`);
  const t = await hub.setTask("s1", { title: `mail ${MAIL}`, note: `uses ${GH}` });
  assert.equal(t.title, `mail ${MASK}`);
  assert.equal(t.note, `uses ${MASK}`);
});

test("state.json drops prompt, error, task notes and ticket item notes", async () => {
  const { root, store, hub, s } = await makeHub();
  s.error = "CLI said something";
  await hub.setTask("s1", { title: "build page", note: "secret note" });
  store.data.tickets = { k: { id: "k", lead: "s1", status: "open", items: [{ title: "build page", stage: "impl", owner: "Juno", note: "secret item note" }] } };
  const view = diskView(store.data);
  assert.equal("prompt" in view.sessions.s1, false);
  assert.equal("error" in view.sessions.s1, false);
  assert.equal(Object.values(view.tasks).every(t => !("note" in t)), true);
  assert.deepEqual(view.tickets.k.items, [{ title: "build page", stage: "impl", owner: "Juno" }]);
  // Memory keeps them.
  assert.equal(Object.values(store.data.tasks)[0].note, "secret note");
  assert.equal(store.data.tickets.k.items[0].note, "secret item note");

  await store.flush();
  const disk = readFileSync(path.join(root, ".dispatch", "state.json"), "utf8");
  assert.doesNotMatch(disk, /secret|custom prompt|CLI said/);

  // After a restart the role prompt is read from the role, and the missing fields have defaults.
  const again = new Store(root);
  await again.load();
  assert.equal(again.data.sessions.s1.error, null);
  assert.equal(Object.values(again.data.tasks)[0].note, "");
  const hub2 = new Hub({ root, store: again, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")) });
  assert.match(hub2.systemPrompt(again.data.sessions.s1), /^ROLE PROMPT/);
});
