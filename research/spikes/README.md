# Spikes (Eraser-like tool research)
Each folder is independent: `cd <dir> && npm i && npm run build|start`. No node_modules committed.
- excalidraw/ tldraw/ : Vite+React embed, `npm run build` only (no browser run).
- dsl/ : hand-written parser -> ELK.js layered layout -> SVG. `npm start` writes out.svg (git-ignored output not required).
- yjs/ : two in-memory Y.Docs, offline edits, convergence check. `npm start`.
