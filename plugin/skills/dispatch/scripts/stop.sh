#!/usr/bin/env bash
# Stop the Dispatch server started by start.sh for a project. server.pid is trusted only when that
# process is node running a Drawing server/index.js for <project>/pipelines; otherwise it is stale.
set -euo pipefail

# Succeeds only when pid $1 is node running a Drawing server/index.js in project mode on workspace $2
# (what start.sh launches). Reads /proc/<pid>/cmdline, falls back to `ps -o command=`; nothing is eval'd.
is_our_server() {
  local pid=$1 workspace=$2 cmd first
  [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 0 ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  else
    cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
  fi
  cmd=${cmd%"${cmd##*[![:space:]]}"}
  [ -n "$cmd" ] || return 1
  first=${cmd%% *}
  case "${first##*/}" in node|nodejs) ;; *) return 1 ;; esac
  [[ "$cmd" == *"/server/index.js --project-mode $workspace" ]]
}

target="$(cd "${1:-$PWD}" && pwd -P)"
project="$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || echo "$target")"
pid_file="$project/.dispatch/server.pid"
pid=""
[ ! -f "$pid_file" ] || pid="$(tr -dc '0-9' < "$pid_file" 2>/dev/null || true)"

if [ -n "$pid" ] && is_our_server "$pid" "$project/pipelines"; then
  kill "$pid"
  rm -f "$pid_file"
  echo "Dispatch stopped for $project"
else
  rm -f "$pid_file"
  echo "No Dispatch server running for $project"
fi
