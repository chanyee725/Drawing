// Safety rules from CLAUDE.md, checked by reading the source and by running the CLI seam:
// child processes only through server/dispatch/cli.js and never with a shell, loopback only,
// no real agent CLI under npm test, every mode on every provider as strict as chosen.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_MARKER, runCli, spawnCli } from "../../server/dispatch/cli.js";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { fakeCliBin, fakeSpawner, until } from "../fixtures/fake-cli/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = prefix => { const d = mkdtempSync(path.join(tmpdir(), prefix)); dirs.push(d); return d; };

function sources(dir) {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(c|m)?js$/.test(e.name)) out.push({ rel, text: readFileSync(path.join(ROOT, rel), "utf8") });
  }
  return out;
}
const CODE = [...sources("server"), ...sources("plugin")];
const hits = re => CODE.filter(f => re.test(f.text)).map(f => f.rel).sort();

/* ---------------- static checks ---------------- */

test("static: child_process is imported only in server/dispatch/cli.js", () => {
  assert.deepEqual(hits(/["'](node:)?child_process["']/), ["server/dispatch/cli.js"]);
});

test("static: no shell option is ever turned on", () => {
  assert.deepEqual(hits(/shell\s*:\s*(true|["'`])/), []);
  assert.deepEqual(hits(/\bexecSync\b|(?<![.\w])exec\(/), []);
});

test("static: no other network modules, fetch only in mcp.js, the hook and the lock probe", () => {
  assert.deepEqual(hits(/["'](node:)?(https|net|tls|dgram|http2)["']/), []);
  assert.deepEqual(hits(/\b(http|https)\.(request|get)\(|new WebSocket\(|XMLHttpRequest/), []);
  assert.deepEqual(hits(/\bfetch(Fn)?\(/), ["plugin/hooks/long-session.mjs", "server/dispatch/mcp.js", "server/lock.js"]);
  // The lock probe (E13) only ever asks 127.0.0.1: a fixed host, and one fetch built from it.
  const lock = CODE.find(f => f.rel === "server/lock.js").text;
  assert.match(lock, /^const HOST = '127\.0\.0\.1';$/m);
  assert.deepEqual(lock.match(/\bfetch\([^,]*/g), ["fetch(`http://${HOST}:${port}${path}`"]);
  // Both refuse a DISPATCH_URL that is not this machine's loopback.
  for (const rel of ["plugin/hooks/long-session.mjs", "server/dispatch/mcp.js"]) {
    const text = CODE.find(f => f.rel === rel).text;
    assert.match(text, /\^http:\\\/\\\/127\\\.0\\\.0\\\.1:\\d\+\$/, rel);
  }
});

test("static: the server listens on 127.0.0.1 only", () => {
  const listens = CODE.filter(f => /\.listen\(/.test(f.text));
  assert.deepEqual(listens.map(f => f.rel), ["server/index.js"]);
  const text = listens[0].text;
  assert.match(text, /const HOST = '127\.0\.0\.1';/);
  assert.match(text, /\.listen\(port, HOST,/);
});

/* ---------------- cli.js ---------------- */

test("cli: refuses anything outside the allowlist, and any shell", async () => {
  for (const bin of ["cp", "sh", "bash", "node", "/usr/bin/git", "claude; rm -rf /"]) {
    assert.throws(() => spawnCli(bin, []), e => e.code === "ECLIDENIED", bin);
    await assert.rejects(runCli(bin, []), e => e.code === "ECLIDENIED", bin);
  }
  assert.throws(() => spawnCli("git", ["--version"], { shell: true }), e => e.code === "ECLIDENIED");
  await assert.rejects(runCli("git", ["--version"], { shell: "/bin/sh" }), e => e.code === "ECLIDENIED");
});

test("cli: a real agent CLI never starts under npm test", async () => {
  // An executable named claude in a folder without the fake marker counts as real.
  const dir = tmp("drawing-real-cli-");
  for (const bin of ["claude", "codex", "agy"]) {
    writeFileSync(path.join(dir, bin), `#!${process.execPath}\nprocess.exit(0);\n`);
    chmodSync(path.join(dir, bin), 0o755);
    const env = { ...process.env, PATH: dir };
    assert.throws(() => spawnCli(bin, ["--version"], { env }), e => e.code === "ECLIDENIED", bin);
    await assert.rejects(runCli(bin, ["--version"], { env }), e => e.code === "ECLIDENIED", bin);
  }
  // Not on PATH at all: refused too, never looked up elsewhere.
  assert.throws(() => spawnCli("claude", [], { env: { ...process.env, PATH: tmp("drawing-empty-bin-") } }), e => e.code === "ECLIDENIED");
});

test("cli: the real seam runs the fake CLIs from a marked folder", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const env = { ...process.env, ...bin.env };
  for (const name of ["claude", "codex", "agy"]) {
    const { stdout } = await runCli(name, ["--version"], { env });
    assert.equal(stdout.trim(), `${name} 0.0.0-fake`);
  }
  assert.deepEqual(bin.calls().map(c => c.bin), ["claude", "codex", "agy"]);
  // git is not an agent CLI: it runs from the normal PATH.
  assert.match((await runCli("git", ["--version"])).stdout, /^git version/);
  assert.equal(readdirSync(bin.dir).includes(FAKE_MARKER), true);
});

/* ---------------- permission matrix ---------------- */

const MODELS = [
  { id: "claude-haiku-5-5", provider: "claude", efforts: ["low"], contextWindow: 200000 },
  { id: "gpt-x", provider: "openai", efforts: ["low"], contextWindow: 200000 },
  { id: "gemini-3.8-flash-low", provider: "gemini", efforts: ["low"], contextWindow: 1000000 },
];
const ROLES = [{ id: "impl", name: "구현자", model: "claude-haiku-5-5", perm: "plan", prompt: "" }];

async function makeHub(bin, root = tmp("drawing-safety-hub-")) {
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  return { root, store, hub };
}

const flagAfter = (args, flag) => args[args.indexOf(flag) + 1];
// What each provider's CLI must get for each mode; null = refused with 400 before anything starts.
const MATRIX = {
  claude: { manual: a => flagAfter(a, "--permission-mode") === "manual", acceptEdits: a => flagAfter(a, "--permission-mode") === "acceptEdits",
    auto: a => flagAfter(a, "--permission-mode") === "auto", plan: a => flagAfter(a, "--permission-mode") === "plan" },
  openai: { manual: a => a.includes('sandbox_mode="read-only"'), acceptEdits: a => a.includes('sandbox_mode="workspace-write"'),
    auto: a => a.includes('sandbox_mode="workspace-write"'), plan: a => a.includes('sandbox_mode="read-only"') },
  gemini: { manual: null, acceptEdits: null, auto: a => flagAfter(a, "--mode") === "auto", plan: a => flagAfter(a, "--mode") === "plan" },
};
const BIN = { claude: "claude", openai: "codex", gemini: "agy" };

test("permission matrix: 4 modes x 3 providers through hub.create", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const { hub, store } = await makeHub(bin);
  let cells = 0;
  for (const model of MODELS) {
    for (const [perm, ok] of Object.entries(MATRIX[model.provider])) {
      cells++;
      const label = `${model.provider}/${perm}`;
      const before = bin.calls().length;
      if (!ok) {
        await assert.rejects(hub.create({ items: [{ role: "impl", model: model.id, perm }], commonPrompt: "hi", worktree: false }), e => e.status === 400, label);
        await new Promise(r => setTimeout(r, 50));
        assert.equal(bin.calls().length, before, `${label} started a CLI`);
        continue;
      }
      const [s] = await hub.create({ items: [{ role: "impl", model: model.id, perm }], commonPrompt: "hi", worktree: false });
      const call = await until(() => bin.calls().slice(before).find(c => c.bin === BIN[model.provider]));
      assert.equal(ok(call.args), true, `${label}: ${JSON.stringify(call.args)}`);
      for (const loose of ["--dangerously-skip-permissions", "bypassPermissions", "--yolo", "danger-full-access", "--dangerously-bypass-approvals-and-sandbox"]) {
        assert.equal(call.args.some(a => a.includes(loose)), false, `${label} got ${loose}`);
      }
      assert.equal(store.data.sessions[s.id].perm, perm);
    }
  }
  assert.equal(cells, 12);
  // No agy call ever carried the skip flag, whatever the mode.
  assert.equal(bin.calls().filter(c => c.bin === "agy").some(c => c.args.includes("--dangerously-skip-permissions")), false);
});

test("resumeInterrupted resumes only sessions whose provider is connected", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const root = tmp("drawing-safety-resume-");
  const store = new Store(root);
  await store.load();
  const base = { role: "impl", effort: null, perm: "plan", prompt: "", canSpawn: false, cwd: root, startedAt: 0, updatedAt: 0, last: "",
    turns: 0, ctx: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerSessionId: null };
  store.data.sessions = {
    c: { ...base, id: "c", n: 1, name: "C", provider: "claude", model: "claude-haiku-5-5", status: "running" },
    o: { ...base, id: "o", n: 2, name: "O", provider: "openai", model: "gpt-x", status: "running" },
    g: { ...base, id: "g", n: 3, name: "G", provider: "gemini", model: "gemini-3.8-flash-low", status: "waiting" },
  };
  store.save = () => {};
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  for (const s of Object.values(store.data.sessions)) assert.equal(s.interrupted, true, s.id);

  hub.isConnected = p => p === "claude";
  hub.resumeInterrupted();
  await until(() => bin.calls().some(c => c.bin === "claude"));
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(bin.calls().map(c => c.bin), ["claude"]);
  assert.equal(store.data.sessions.c.interrupted, false);
  assert.equal(store.data.sessions.o.interrupted, true);
  assert.equal(store.data.sessions.g.interrupted, true);

  // Connecting OpenAI later resumes the Codex session, and only that one.
  hub.isConnected = p => p === "claude" || p === "openai";
  hub.resumeInterrupted();
  await until(() => bin.calls().some(c => c.bin === "codex"));
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(bin.calls().map(c => c.bin).sort(), ["claude", "codex"]);
  assert.equal(store.data.sessions.g.interrupted, true);
});

test("Codex limits (~/.codex/sessions) are read only while OpenAI is connected", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const { hub } = await makeHub(bin);
  hub.isConnected = p => p !== "openai";
  assert.equal((await hub.providerLimits()).openai, null);
  // The only call site is behind the connection check.
  const hubText = CODE.find(f => f.rel === "server/dispatch/hub.js").text;
  assert.deepEqual(hubText.match(/.*codexLimits\(\).*/g).map(l => l.trim()), ['openai: this.isConnected("openai") ? await codexLimits() : null,']);
});
