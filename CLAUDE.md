# CLAUDE.md

Draw-Pipelines: a local web page that shows draw.io files changing live and the Dispatch agents editing them, with smooth cursors. Work items are in `docs/tickets.md`.

## Rules

- Talk to the user in Korean. Code, comments, identifiers, commit messages and this file in English. `README.md` in Korean. UI copy in Korean 해요체, short and plain.
- Git: `develop` is the integration branch. Branch every change off it (`feat/`, `fix/`, `docs/`, `chore/`), merge back into `develop`. Never use `main`. No push without the user's OK.
- Commits: English conventional commits, `type(scope): summary`.
- The server binds to 127.0.0.1 only. It reads the Dispatch API and files; it never writes to watched files or posts to Dispatch.
- Privacy: no transcripts, tokens, API keys, emails or real names stored or logged. Never read `.env` files.
- Checks before merging: `npm test`, `npm run build` (when `web/` changed), and a headless browser look at the page (never open a visible browser window).
- Testing against real data: point it at a scratch copy of the sim-studio `docs/handover` folder, not at files other sessions are editing, unless the task is to watch them read-only.
