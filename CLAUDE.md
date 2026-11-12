# CLAUDE.md

Drawing: a local, internal-only diagramming tool that works and looks like Eraser.io (document + infinite canvas per file, Eraser-compatible diagram-as-code, free-form drawing). Work items are in `docs/tickets.md`; the spec is `docs/research/eraser/` (start with `00-summary.md`). The old draw.io live viewer is retired.

## Rules

- Talk to the user in Korean. Code, comments, identifiers, commit messages and this file in English. `README.md` in Korean. UI copy in Korean 해요체, short and plain.
- Git: `develop` is the integration branch. Branch every change off it (`feat/`, `fix/`, `docs/`, `chore/`), merge back into `develop`. Never use `main`. No push without the user's OK.
- Commits: English conventional commits, `type(scope): summary`.
- The server binds to 127.0.0.1 only and makes no outbound network requests; everything (fonts, Excalidraw assets, icons) is bundled or vendored. It writes only inside the workspace folder it was started with.
- Internal use only: matching Eraser's look is fine, but never copy Eraser's name, logo, icon/illustration/font files or code (except the MIT `eraser-diagrams` code with its notice). No tldraw.
- Privacy: no transcripts, tokens, API keys, emails or real names stored or logged. Never read `.env` files.
- Checks before merging: `npm test`, `npm run build` (when `web/` changed), and a headless browser look at the page (never open a visible browser window).
- Testing: point the server at a scratch workspace folder (in a temp dir), never at a real project folder.
