# CLAUDE.md

Drawing: a local, internal-only diagramming tool that works and looks like Eraser.io (document + infinite canvas per file, Eraser-compatible diagram-as-code, free-form drawing), and runs agent pipelines planned in those documents (merged from Dispatch, issue #87; design in docs/design/dispatch-integration.md). Work items are in `docs/tickets.md`; the spec is `docs/research/eraser/` (start with `00-summary.md`). The old draw.io live viewer is retired.

## Rules

- Talk to the user in Korean. Code, comments, identifiers, commit messages and this file in English. `README.md` in Korean. UI copy in Korean 해요체, short and plain.
- Git: `develop` is the integration branch (GitHub `chanyee725/Drawing`). Never use `main`.
- GitHub flow, every step leaves a trace: one issue per ticket or bug (`gh issue create`, title `E<n>: ...`), branch off `develop` (`feat/`, `fix/`, `docs/`, `chore/`), push the branch, open a PR against `develop` with `Closes #<issue>` and what was checked, review findings as PR comments, then `gh pr merge --merge`. Pushing feature branches and merging reviewed PRs into `develop` is allowed; force-push, deleting remote branches and pushing to `main` are not.
- Commits: English conventional commits, `type(scope): summary`.
- The server binds to 127.0.0.1 only and its own code makes no outbound network requests (loopback only); everything (fonts, Excalidraw assets, icons) is bundled or vendored. It writes only inside the workspace folder (run records under <workspace>/.drawing/), the git project that holds it (<project>/.dispatch/ and session worktrees), and ~/.dispatch/ (shared usage limits).
- Agent sessions are the user's own CLIs (claude, codex, agy) started as child processes, only after the user connects a provider. Child processes are limited to those, git and gh (PR/CI status, can be turned off per workspace), all through server/dispatch/cli.js, never with a shell. The server never proxies their traffic or reads their credentials.
- Permission modes are manual, acceptEdits, auto, plan; never run a session looser than the mode chosen (refuse instead). No bypassPermissions. Usage-limit and session-length guards stay on with their defaults unless an issue says otherwise.
- Pipeline runs: one approval (시작하기) per plan; the lead merges reviewed PRs into develop without a second approval; nobody pushes to main.
- Every non-GET /api request needs the x-drawing: 1 header (x-dispatch: 1 is accepted for the plugin).
- Internal use only: matching Eraser's look is fine, but never copy Eraser's name, logo, icon/illustration/font files or code (except the MIT `eraser-diagrams` code with its notice). No tldraw.
- Privacy: no transcripts, auth tokens, API keys, emails or real names stored or logged. Agent transcripts live in memory only. Disk, documents and run records keep metadata only (step states, times, model, token counts, cost, branch, commit, PR number). Never read `.env` files.
- Checks before merging: `npm test`, `npm run build` (when `web/` changed), and a headless browser look at the page (never open a visible browser window).
- Testing: point the server at a scratch workspace folder inside a scratch git repo with one commit (in a temp dir), never at a real project folder. npm test uses the fake CLIs in test/fixtures/fake-cli/ and must never start a real claude, codex or agy. A manual run against a real CLI uses claude-haiku-5-5 at effort low with one-line prompts.
