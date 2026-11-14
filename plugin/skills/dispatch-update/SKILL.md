---
name: dispatch-update
description: Update Drawing (the Dispatch plugin) on this machine to the latest GitHub release — download the release bundle with gh, unpack it, and restart every running Drawing server so all projects use the new code. Use when the user says "디스패치 업데이트", "dispatch update", "최신으로 맞춰", or Drawing behaves differently on another machine than expected.
---

# Dispatch update

`<skill-dir>` is the directory containing this file. Do every step yourself; the user only asks.

1. Run `<skill-dir>/scripts/update.sh`. It needs `gh` logged in and reads releases of `chanyee725/Drawing`: it downloads `drawing-<ver>.tgz` (server + built web + plugin), unpacks it into `~/.dispatch/drawing/<ver>/`, points `~/.dispatch/drawing/current` at it, and restarts each running server on its own port.
   - `--tag v1.2.3` picks a release instead of the latest. `--no-restart` skips the restart (use it when the user is in the middle of a team run and wants to restart later).
   - If `gh` is missing or not logged in, tell the user to run `! gh auth login` in their own terminal.
2. Report the version it unpacked and which servers were restarted (project and port). Restarted servers resume any turn that was cut off.
3. Skills and hooks update through Claude Code. When the script prints the `/plugin ...` lines, tell the user to run them (they are Claude Code commands, you cannot run them): `/plugin marketplace update dispatch` then `/plugin update dispatch@dispatch`, or the `marketplace add` + `install` pair on a first install from the bundle.
4. If a server did not come back, read `<project>/.dispatch/server.log` and report the error.

The bundle is made by `npm run pack` in the Drawing repo and attached to a GitHub release by hand (`gh release create <tag> dist/drawing-<ver>.tgz`).
