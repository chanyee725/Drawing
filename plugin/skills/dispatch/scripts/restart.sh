#!/usr/bin/env bash
# Restart the Dispatch server for a project (to load new server code). Sessions cut off mid-turn
# are resumed automatically, and transcripts survive in .dispatch/transcripts.
set -euo pipefail
here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
start="$(dirname "$(dirname "$(dirname "$here")")")/scripts/start.sh"
[ -f "$start" ] || { echo "missing $start; server not stopped" >&2; exit 1; }
# start.sh reads DISPATCH_PORT or DRAW_PORT: pass either one on as both.
port="${DRAW_PORT:-${DISPATCH_PORT:-}}"
if [ -n "$port" ]; then
  [[ "$port" =~ ^[0-9]+$ ]] || { echo "bad port: $port" >&2; exit 1; }
  export DRAW_PORT="$port" DISPATCH_PORT="$port"
fi
"$here/stop.sh" "${1:-$PWD}"
sleep 1
"$start" "${1:-$PWD}"
