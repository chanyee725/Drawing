// Fake `gh` for tests: answers `gh pr view <branch> --json ...` from FAKE_GH_SCENARIO (JSON file:
// { "<branch>": { json } | { "error": "stderr text", "exit": 1 } }); logs calls to FAKE_CLI_LOG.
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (process.env.FAKE_CLI_LOG) appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ bin: "gh", args, cwd: process.cwd() }) + "\n");
if (process.env.FAKE_GH_SLOW) await new Promise(r => setTimeout(r, Number(process.env.FAKE_GH_SLOW)));
const sc = process.env.FAKE_GH_SCENARIO ? JSON.parse(readFileSync(process.env.FAKE_GH_SCENARIO, "utf8")) : {};
const hit = sc[args[2]];
if (!hit) { process.stderr.write(`no pull requests found for branch "${args[2]}"\n`); process.exit(1); }
if (hit.error) { process.stderr.write(hit.error + "\n"); process.exit(hit.exit ?? 1); }
process.stdout.write(JSON.stringify(hit));
