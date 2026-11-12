# Draw-Pipelines tickets

Goal: a local web page that shows draw.io files **as they change**, and the AI agents (Dispatch sessions) that are editing them, with smooth Figma-like cursors on the part of the diagram each agent is working on.

First user: the sim-studio handover diagrams (`~/ws/physical-ai/sim-studio/docs/handover/**/*.drawio`), edited by a Dispatch team on `http://127.0.0.1:4318`, each teammate in its own git worktree (`<project>/.dispatch/wt/<name>/`).

Order: T1 → T2 → (T3, T4 in parallel) → T5 → T6 → T7. Each ticket is one branch off `develop` and one PR-sized merge.

---

## T1. Project skeleton

- `npm start -- <project-dir>` starts a server on 127.0.0.1 (default port 4330, `DRAW_PORT` to change) and prints the URL.
- `server/` (Node ≥ 22, built-ins preferred like Dispatch; a dependency needs a reason in the PR), `web/` (Vite + React + TypeScript + Tailwind), `web` builds into `public/` which the server serves.
- `npm test` runs `node --test`; `npm run build` builds the web.
- Done when: an empty page loads from the server and `npm test` passes with one test.

## T2. File watcher and change feed (server)

- Watch every `*.drawio` / `*.drawio.xml` under the given dir (recursive), and under each Dispatch worktree of that project (`.dispatch/wt/*/` + the same relative paths) so edits show **before** they are merged. Each source is labelled (`main`, or the worktree's session name from the Dispatch API, falling back to the folder name).
- Parse files into pages → cells (id, parent, value text, style, geometry, edge source/target). Handle uncompressed XML and the compressed `<diagram>` form (deflate + base64).
- On every change compute a cell-level diff per page: added / removed / moved or resized / text changed / style changed. Debounce writes (a script writing a file in pieces must give one change).
- Keep an in-memory history (last 500 changes per file) and serve: `GET /api/files`, `GET /api/files/<id>` (current XML per page), `GET /api/history?file=`, and an SSE stream `GET /api/events` (`file`, `change`, `agents`).
- Done when: tests cover parse (both forms), diff kinds, debounce, and a worktree copy showing as its own source.

## T3. Diagram view (web)

- Render the selected file and page faithfully (shapes, text with HTML labels, edges, images). Recommended: the diagrams.net viewer/mxGraph renderer; check its licence and whether it works offline, and say in the PR which was picked and why.
- File / page picker, source picker (main or a worktree), zoom and pan, fit to screen.
- Live: a change from SSE updates the view without a reload and without losing zoom/pan; changed cells flash briefly (added green, changed amber, removed red ghost that fades).
- Done when: the 7 pages of `sim-studio/docs/handover/handover.drawio` render, and editing a cell in a file updates the open page within a second.

## T4. Agents feed (server)

- Read the Dispatch server for the project (port from `<project>/.dispatch/server.port`, or `--dispatch <url>`): `GET /api/state` for sessions (name, role, model, status, branch, last line) and `GET /api/events` (SSE) for updates. Read only; never post to Dispatch.
- Map each session to its worktree folder, so a file change in that folder is attributed to that agent.
- Per agent keep: status, the last activity line, the file/page/cells it last changed and when.
- Push `agents` events to the web. Store no transcripts, tokens or personal data, only names, roles, status and what changed.
- Done when: tests cover the session → worktree mapping and attribution of a change.

## T5. Live cursors and activity (web)

- One cursor per active agent, coloured by role, with a name tag (name · role) and its current activity line, positioned on the centre (or last edited corner) of the cells it last changed on the page being viewed.
- Movement is smooth like Figma: interpolate positions (spring or critically damped easing, 60 fps via `requestAnimationFrame`), no jumps when several changes arrive at once; an idle agent's cursor fades after a while; an agent working on another page shows as a chip at the page tab instead.
- A side panel lists agents (status dot, activity, file/page, time since last change); clicking one jumps to its page and cursor.
- Done when: two agents changing different cells show two cursors gliding to the right places, checked in a headless browser recording or screenshots.

## T6. Change history

- Timeline panel per file: newest first, each entry = time, source/agent, page, a one-line summary ("3 cells added, 1 text changed").
- Clicking an entry shows that version of the page with its diff highlighted; a scrubber replays changes in order.
- Also read the file's git history (`git log --follow` in the main checkout) so merged versions appear with commit subjects.
- Done when: replay steps through at least 10 recorded changes correctly.

## T7. Docs and launch

- `README.md` (Korean): what it is, install, `npm start -- <project-dir>`, screenshots, how agents are attributed.
- A one-line note in sim-studio `docs/handover/README.md` on how to open the live view is the user's call; propose it, do not edit sim-studio.
- Done when: a fresh clone runs with `npm install && npm start -- <dir>`.

---

Out of scope for now: editing diagrams in the browser, remote access (127.0.0.1 only), authentication.
