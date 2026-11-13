// Shared body of the fake agent CLIs (claude.mjs, codex.mjs, agy.mjs). A fake:
// - appends { bin, args, cwd } as one JSON line to $FAKE_CLI_LOG (so a test can prove the fake ran);
// - answers the status commands the server uses (--version, auth status, login status);
// - for a session turn, prints the JSON lines of $FAKE_CLI_SCENARIO (a JSON-lines file) or a short
//   default reply in that CLI's stream format, then exits with $FAKE_CLI_EXIT (default 0).
//   Two scenario lines are actions, not output: { "$sleep": ms } waits, { "$write": { file, text } } writes
//   `text` to the absolute path `file` (a test's scratch folder), like an agent editing a file.
// It never talks to the network and never reads credentials.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const DEFAULT = {
  claude: [
    { type: "system", subtype: "init", session_id: "fake-claude-session" },
    { type: "assistant", message: { id: "fake-msg-1", content: [{ type: "text", text: "fake reply" }], usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: "result", subtype: "success", total_cost_usd: 0.001 },
  ],
  codex: [
    { type: "thread.started", thread_id: "fake-codex-thread" },
    { type: "item.completed", item: { type: "agent_message", text: "fake reply" } },
    { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
  ],
  agy: [
    { event: "init", conversation_id: "fake-agy-conversation" },
    { event: "step_update", step_update: { step_type: "agent_response", text_delta: "fake reply", usage: { input_tokens: 10, output_tokens: 5 } } },
    { event: "result", result: { status: "OK", response: "fake reply" } },
  ],
};

const STATUS = {
  claude: { "auth status": JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) },
  codex: { "login status": "Logged in using ChatGPT", "debug models": JSON.stringify({ models: [] }) },
  agy: {},
};

function scenario(bin) {
  const file = process.env.FAKE_CLI_SCENARIO;
  if (!file) return DEFAULT[bin];
  return readFileSync(file, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
}

async function emit(lines) {
  for (const l of lines) {
    if (l.$sleep) await new Promise(r => setTimeout(r, l.$sleep));
    else if (l.$write) writeFileSync(l.$write.file, l.$write.text);
    else process.stdout.write(JSON.stringify(l) + "\n");
  }
}
const finish = () => process.exit(Number(process.env.FAKE_CLI_EXIT || 0));

export function run(bin) {
  const args = process.argv.slice(2);
  if (process.env.FAKE_CLI_LOG) appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ bin, args, cwd: process.cwd() }) + "\n");
  if (args[0] === "--version") { process.stdout.write(`${bin} 0.0.0-fake\n`); return finish(); }
  const status = STATUS[bin][args.slice(0, 2).join(" ")];
  if (status !== undefined) { process.stdout.write(status + "\n"); return finish(); }

  if (bin !== "claude") { emit(scenario(bin)).then(finish); return; }
  // claude -p --input-format stream-json: one turn per user line on stdin, alive until stdin ends.
  // Turns are played one after another, so a scenario's $sleep holds back the next turn's lines too.
  let first = true;
  let turns = Promise.resolve();
  const rl = createInterface({ input: process.stdin });
  rl.on("line", line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type !== "user") return;
    const lines = first ? scenario(bin) : DEFAULT.claude.slice(1);
    first = false;
    turns = turns.then(() => emit(lines));
  });
  rl.on("close", () => turns.then(finish));
}
