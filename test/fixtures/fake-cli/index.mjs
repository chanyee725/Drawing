// Helpers for tests that need the fake agent CLIs.
//
// fakeCliBin() makes a temp bin folder holding only `claude`, `codex` and `agy` (wrappers around
// the scripts here, started with this node by absolute path) plus the marker that tells
// server/dispatch/cli.js the folder is fake. With PATH set to that folder alone no real CLI can be
// found. fakeSpawner(bin) is a spawnCli for the Hub: the real seam, with PATH and FAKE_CLI_* set.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AGENT_CLIS, FAKE_MARKER, spawnCli } from "../../../server/dispatch/cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function fakeCliBin({ scenario, exit } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "drawing-fake-cli-"));
  for (const bin of AGENT_CLIS) {
    const file = path.join(dir, bin);
    writeFileSync(file, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(path.join(HERE, `${bin}.mjs`)).href)});\n`);
    chmodSync(file, 0o755);
  }
  writeFileSync(path.join(dir, FAKE_MARKER), "");
  const log = path.join(dir, "calls.jsonl");
  const env = { PATH: dir, FAKE_CLI_LOG: log };
  if (scenario) {
    env.FAKE_CLI_SCENARIO = path.join(dir, "scenario.jsonl");
    writeFileSync(env.FAKE_CLI_SCENARIO, scenario.map(l => JSON.stringify(l)).join("\n") + "\n");
  }
  if (exit != null) env.FAKE_CLI_EXIT = String(exit);
  return {
    dir, log, env,
    /** Every call the fakes got so far: [{ bin, args, cwd }]. */
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : []),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const fakeSpawner = bin => (name, args, opts = {}) =>
  spawnCli(name, args, { ...opts, env: { ...(opts.env ?? process.env), ...bin.env } });

/** Waits until `fn()` is truthy (polls every 20 ms), else throws after `ms`. */
export async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 20));
  }
}
