import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOTE, REMIND_MS, expandHome, findServer, looksLikeWrite, projectRoot, readPort, run, shellSkeleton } from "../plugin/hooks/main-delegates.mjs";

// Temp git project with a fake Drawing server (a loopback http server answering /api/info) whose port is kept in
// <project>/.dispatch/server.port, as plugin/scripts/start.sh does (issue #367).
const servers = [];
after(() => { for (const s of servers) s.close(); });
function serve(info = { workspace: "pipelines", mode: "project" }, status = 200) {
  return new Promise(ok => {
    const s = createServer((req, res) => {
      if (req.url !== "/api/info") { res.statusCode = 404; return res.end(); }
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(typeof info === "string" ? info : JSON.stringify(info));
    }).listen(0, "127.0.0.1", () => { servers.push(s); ok(s.address().port); });
  });
}

async function setup(portFile = "serve") {
  const home = mkdtempSync(join(tmpdir(), "dmd-home-"));
  const proj = join(home, "proj");
  mkdirSync(join(proj, "src"), { recursive: true });
  execFileSync("git", ["init", "-q", proj]);
  if (portFile !== null) {
    mkdirSync(join(proj, ".dispatch"));
    writeFileSync(join(proj, ".dispatch", "server.port"), portFile === "serve" ? `${await serve()}\n` : portFile);
  }
  const marks = mkdtempSync(join(tmpdir(), "dmd-marks-"));
  return { home, proj, marks };
}

const input = (proj, extra = {}) => ({ session_id: "abc-123", cwd: proj, tool_input: { file_path: join(proj, "src", "a.js") }, ...extra });

test("does nothing inside a Dispatch session", async () => {
  const { home, proj, marks } = await setup();
  for (const k of ["DISPATCH_SESSION", "DISPATCH_PARENT", "DISPATCH_SELF"]) {
    assert.equal(await run({ [k]: "x" }, input(proj), marks, home), null);
  }
  assert.deepEqual(readdirSync(marks), []);
});

test("valid port file + responding project server -> note", async () => {
  const { home, proj, marks } = await setup();
  assert.ok(await run({}, input(proj), marks, home));
  // From a subfolder of the project the git top-level is still found.
  assert.ok(await run({}, input(proj, { session_id: "sub", cwd: join(proj, "src") }), marks, home));
});

test("missing port file or .dispatch folder -> null", async () => {
  const { home, proj, marks } = await setup(null);
  assert.equal(await run({}, input(proj), marks, home), null);
  mkdirSync(join(proj, ".dispatch"));
  assert.equal(await run({}, input(proj), marks, home), null);
  assert.deepEqual(readdirSync(marks), []);
});

test("invalid port file -> null, no probe", async () => {
  for (const bad of ["abc", "4317abc", "43 17", "-1", "1e3", "0", "70000", "", "4317; rm -rf /", "$(id)", "http://127.0.0.1:1"]) {
    const { home, proj, marks } = await setup(bad);
    assert.equal(readPort(proj), null, JSON.stringify(bad));
    assert.equal(await run({}, input(proj), marks, home), null, JSON.stringify(bad));
  }
});

test("port file names a server that is not ours or not responding -> null", async () => {
  for (const info of [{ workspace: "x", mode: "drawing" }, "not json", [], null]) {
    const { home, proj, marks } = await setup(String(await serve(info)));
    assert.equal(await run({}, input(proj), marks, home), null, JSON.stringify(info));
  }
  const { home, proj, marks } = await setup(String(await serve({ mode: "project" }, 500)));
  assert.equal(await run({}, input(proj), marks, home), null, "HTTP 500");
  // A port nobody listens on (a server we opened, then closed).
  const s = createServer().listen(0, "127.0.0.1");
  await new Promise(r => s.once("listening", r));
  const dead = s.address().port;
  await new Promise(r => s.close(r));
  const d = await setup(String(dead));
  assert.equal(await run({}, input(d.proj), d.marks, d.home), null, "closed port");
  assert.deepEqual(readdirSync(d.marks), []);
});

test("another project's port file is not used", async () => {
  const a = await setup();
  const b = await setup(null);
  assert.equal(await run({}, input(b.proj), b.marks, b.home), null);
  // A file of project A edited from cwd in project B belongs to A's root, not B's.
  assert.equal(await findServer(join(a.proj, "src", "a.js"), b.proj), null);
  // Not inside any git project -> null.
  const loose = mkdtempSync(join(tmpdir(), "dmd-loose-"));
  assert.equal(projectRoot(loose) === null || !readPort(projectRoot(loose)), true);
  assert.equal(await run({}, { session_id: "l", cwd: loose, tool_input: {} }, b.marks, b.home), null);
});

test("file outside the project -> null", async () => {
  const { home, proj, marks } = await setup();
  const other = join(home, "proj-other", "a.js");
  assert.equal(await run({}, input(proj, { cwd: home, tool_input: { file_path: other } }), marks, home), null);
});

test("match -> note, then quiet until REMIND_MS passes, never blocks", async () => {
  const { home, proj, marks } = await setup();
  const out = await run({}, input(proj), marks, home);
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: NOTE } });
  assert.ok(!("permissionDecision" in out.hookSpecificOutput));
  assert.ok(NOTE.startsWith("[Dispatch 훅]"));
  assert.equal(await run({}, input(proj), marks, home), null);
  const files = readdirSync(marks);
  assert.deepEqual(files, ["dispatch-main-abc-123"]);
  assert.equal(readFileSync(join(marks, files[0]), "utf8"), "");
  // A different session gets its own note.
  assert.ok(await run({}, input(proj, { session_id: "other" }), marks, home));
});

test("relative file path resolves against cwd; cwd alone counts", async () => {
  const { home, proj, marks } = await setup();
  assert.ok(await run({}, { session_id: "s1", cwd: proj, tool_input: { file_path: "src/a.js" } }, marks, home));
  assert.ok(await run({}, { session_id: "s2", cwd: proj, tool_input: {} }, marks, home));
});

test("session id is sanitized in the marker name", async () => {
  const { home, proj, marks } = await setup();
  assert.ok(await run({}, input(proj, { session_id: "../../evil id" }), marks, home));
  assert.deepEqual(readdirSync(marks), ["dispatch-main-______evil_id"]);
});

test("bad input -> null", async () => {
  const { home, proj, marks } = await setup();
  for (const bad of [null, "x", 42, {}, { session_id: 5, cwd: proj }, { session_id: "s", cwd: "rel" }, { session_id: "s" }]) {
    assert.equal(await run({}, bad, marks, home), null);
  }
  assert.equal(await run({}, input(proj, { session_id: "z", cwd: "\0bad" }), marks, home), null);
});

test("expandHome expands only the tilde form", () => {
  assert.equal(expandHome("~/x", "/h"), "/h/x");
  assert.equal(expandHome("~", "/h"), "/h");
  assert.equal(expandHome("/abs", "/h"), "/abs");
});

test("repeats the note after REMIND_MS, not before", async () => {
  const { home, proj, marks } = await setup();
  const t0 = Date.now();
  assert.ok(await run({}, input(proj), marks, home, t0));
  assert.equal(await run({}, input(proj), marks, home, t0 + REMIND_MS - 60_000), null);
  assert.ok(await run({}, input(proj), marks, home, t0 + REMIND_MS + 1000));
  // The repeat resets the clock.
  assert.equal(await run({}, input(proj), marks, home, t0 + REMIND_MS + 2000), null);
  // An old marker on disk (e.g. from a session hours ago) does not silence the note.
  const mark = join(marks, "dispatch-main-abc-123");
  const old = new Date(Date.now() - 2 * REMIND_MS);
  utimesSync(mark, old, old);
  assert.ok(await run({}, input(proj), marks, home));
  assert.equal(readFileSync(mark, "utf8"), "");
});


const bash = (proj, command, sid = "bash-1") => ({ session_id: sid, cwd: proj, tool_name: "Bash", tool_input: { command } });

test("Bash: writes in the project get the note, reads do not", async () => {
  const { home, proj, marks } = await setup();
  assert.equal(await run({}, bash(proj, "git status && ls -la"), marks, home), null);
  assert.equal(await run({}, bash(proj, "grep -rn foo src 2>/dev/null"), marks, home), null);
  assert.deepEqual(readdirSync(marks), []);
  assert.ok(await run({}, bash(proj, "sed -i 's/a/b/' src/a.js"), marks, home));
  assert.equal(await run({}, bash(proj, "sed -i 's/a/b/' src/a.js"), marks, home), null);
  assert.equal(await run({}, bash(home, "rm -rf x", "bash-2"), marks, home), null, "outside the project");
  assert.equal(await run({}, { session_id: "b3", cwd: proj, tool_name: "Bash", tool_input: {} }, marks, home), null);
});

test("looksLikeWrite: write commands", () => {
  for (const c of [
    "echo hi > out.txt",
    "echo hi >> log.txt",
    "cat > src/a.js <<'EOF'\nconst a = 1;\nEOF",
    "cmd &> all.log",
    "ls 2>&1 > files.txt",
    "sed -i 's/x/y/' a.js",
    "sed -i.bak -e 's/x/y/' a.js",
    "sed --in-place 's/x/y/' a.js",
    "perl -pi -e 's/x/y/' a.js",
    "echo x | tee a.txt",
    "echo x | sudo tee -a /etc/hosts",
    "git commit -m 'msg'",
    "git add -A && git commit -m x",
    "git -C sub apply patch.diff",
    "git checkout -- a.js",
    "git stash",
    "cd src; rm a.js",
    "cp a b",
    "mv a b",
    "mkdir -p x/y",
    "touch x",
    "/bin/rm x",
    "FOO=1 rm x",
    "find . -name '*.tmp' -delete",
    "find . -name '*.tmp' -exec rm {} \\;",
    "ls | xargs rm",
    "python3 -c \"open('a.txt','w').write('x')\"",
    "python3 - <<'EOF'\nfrom pathlib import Path\nPath('a').write_text('x')\nEOF",
    "node -e \"require('fs').writeFileSync('a', 'x')\"",
    "python -c 'import shutil; shutil.rmtree(\"x\")'",
    "(cd src && touch b)",
  ]) assert.equal(looksLikeWrite(c), true, c);
});

test("looksLikeWrite: read-only commands", () => {
  for (const c of [
    "ls -la",
    "cat a.js",
    "grep -rn 'a > b' src",
    "grep -rn \"=>\" src",
    "git status",
    "git log --oneline -5",
    "git diff HEAD~1",
    "git show HEAD",
    "git stash list",
    "git -C sub log",
    "npm test 2>&1",
    "npm test 2>&1 | tail -20",
    "ls >/dev/null 2>&1",
    "ls > /dev/null",
    "cmd 2>/dev/null",
    "cmd &>/dev/null",
    "echo done >&2",
    "sed -n '1,20p' a.js",
    "find . -name '*.js'",
    "python3 -c 'print(1 > 0)'",
    "python3 - <<'EOF'\nprint(1 > 0)\nprint(open('a').read())\nEOF",
    "node -e \"console.log([1].map(x => x))\"",
    "grep writeFileSync src",
    "echo \"rm -rf /\"",
    "",
    "   ",
  ]) assert.equal(looksLikeWrite(c), false, JSON.stringify(c));
  assert.equal(looksLikeWrite(undefined), false);
  assert.equal(looksLikeWrite(42), false);
});

test("shellSkeleton drops quotes, escapes and heredoc bodies", () => {
  assert.equal(shellSkeleton(`echo 'a > b' "c \\" > d" x`), "echo Q Q x");
  assert.equal(shellSkeleton("cat <<EOF > f\nbody > x\nEOF\nls"), "cat <<EOF > f\nls");
  assert.equal(shellSkeleton("echo \\> x"), "echo  x");
});
