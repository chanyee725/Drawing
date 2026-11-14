#!/usr/bin/env bash
# Starts the Drawing server for another git project, in project mode (Dispatch run screen only).
#   start.sh <project>
# Workspace = <project>/pipelines (created when missing). The port is kept in
# <project>/.dispatch/server.port (its pid in server.pid, which stop.sh reads); a server that already
# answers there is reused. Port order: remembered live server, else $DRAW_PORT, else $DISPATCH_PORT (team.sh and
# restart.sh pass it; handed to the server as DRAW_PORT). No ~/.dispatch/servers registry is written, else a free port. Prints nothing but the URL on success.
# The server binds 127.0.0.1 only. Prints the URL on stdout; nothing else is written outside the project.
set -euo pipefail

project=${1:-}
[ -n "$project" ] && [ -d "$project" ] || { echo "Usage: start.sh <project>" >&2; exit 1; }
project=$(cd "$project" && pwd -P)
top=$(git -C "$project" rev-parse --show-toplevel 2>/dev/null) || { echo "Not a git project: $project" >&2; exit 1; }
[ "$(cd "$top" && pwd -P)" = "$project" ] || { echo "Pass the git project's top folder: $top" >&2; exit 1; }

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
home=${DRAWING_HOME:-$(cd "$here/../.." && pwd -P)}
[ -f "$home/server/index.js" ] || { echo "Drawing server not found in $home (set DRAWING_HOME)" >&2; exit 1; }

workspace=$project/pipelines
state=$project/.dispatch
portfile=$state/server.port
mkdir -p "$workspace" "$state"

# Prints the folder name when a Drawing server in project mode answers on $1, else nothing.
probe() {
  node -e '
    const http = require("node:http");
    const port = process.argv[1];
    const req = http.get({ host: "127.0.0.1", port, path: "/api/info", timeout: 1500 }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { try { const i = JSON.parse(b); if (i.mode === "project") process.stdout.write(String(i.workspace)); } catch {} });
    });
    req.on("error", () => {}); req.on("timeout", () => req.destroy());
  ' "$1"
}

port=$(tr -dc '0-9' < "$portfile" 2>/dev/null || true)
if [ -n "$port" ] && [ "$(probe "$port")" = "pipelines" ]; then
  echo "http://127.0.0.1:$port/dispatch"
  exit 0
fi

# The wanted port when it is free, else any free port.
port=$(node -e '
  const net = require("node:net");
  const want = Number(process.argv[1]) || 0;
  const tryPort = (p, next) => {
    const s = net.createServer();
    s.once("error", next);
    s.listen(p, "127.0.0.1", () => { const got = s.address().port; s.close(() => console.log(got)); });
  };
  tryPort(want, () => tryPort(0, () => process.exit(1)));
' "${DRAW_PORT:-${DISPATCH_PORT:-}}")
log=$state/server.log
DRAW_PORT=$port nohup node "$home/server/index.js" --project-mode "$workspace" >"$log" 2>&1 &
pid=$!
echo "$pid" > "$state/server.pid"

for _ in $(seq 1 100); do
  [ "$(probe "$port")" = "pipelines" ] && { echo "$port" > "$portfile"; echo "http://127.0.0.1:$port/dispatch"; exit 0; }
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
echo "Server did not start; see $log" >&2
kill "$pid" 2>/dev/null || true
rm -f "$state/server.pid"
exit 1
