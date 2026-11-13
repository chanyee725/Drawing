# Workspace API (E1)

Paths are relative to the workspace, `/`-separated. No `..`, absolute paths, hidden (`.x`) names or symlinks. A file path may omit the `.dpx.json` extension.

| Route | Notes |
|---|---|
| `GET /api/tree` | folders first; unreadable files are listed with `title:''`, `revision:null` |
| `GET /api/workspace/projects` | projects view, see below (`/api/projects` belongs to Dispatch) |
| `GET /api/file?path=` / `POST /api/file {path,title?}` | create is exclusive (409 if it exists) |
| `PUT /api/file?path=` `{revision,title,document,canvas,blocks}` | whole-file save; 409 `{revision}` when `revision` is not the current one |
| `DELETE /api/file?path=` | files only. `?path=sub` never touches a folder `sub/` |
| `POST /api/folder {path}` / `DELETE /api/folder?path=` | folders only; delete is recursive |
| `POST /api/move {from,to,type?,withSubdocs?}` | rename = move |

## Projects view

`GET /api/workspace/projects` → `{ projects: Project[], loose: DocNode[] }` (design: `docs/design/dispatch-integration/6-app-shell-projects.md` §1). Read only; built from the same walk as `/api/tree`.

- **Project** = a top-level folder: `{ path, name, icon, description, created, modified, count, docs }`. An optional `<folder>/.project.json` gives `name` (max 100 characters), `icon` (max 16) and `description` (max 500); other fields, non-strings, broken JSON, files over 16 KB and symlinks are ignored. Without it `name` is the folder name, `icon` null, `description` ''. Sorted by `name`.
- **DocNode** = `{ type: 'doc'|'group', path, name, title?, revision?, created, modified, count, children }`. A folder `X/` next to `X.dpx.json` holds X's sub-documents (`children`); a folder with no such file is a `group` (its `path` is the folder). `count` is the number of documents below. Sorted by `name`.
- `loose` = files right in the workspace root (미분류). They are not nested: a top-level folder is always a project.
- Times are ISO strings. `modified` is the file's mtime (a group's or project's newest below). `created`: saves replace the file, so its birth time is lost; a file made through the API gets a `born` mark (ms) in its history folder, which moves with it and goes through the trash. For files made outside the app it is the earliest of the oldest kept snapshot and the file's own times.

## Delete and move rules

- `DELETE /api/file` always normalizes to `<path>.dpx.json` and removes that file only. `DELETE /api/folder` removes a directory only. Neither falls back to the other kind (404).
- `move` without `type`: a **file wins**. `from` is tried as a file (`<from>.dpx.json`) first, then as a folder. Send `type: "folder"` (or `"file"`) to be explicit when a file and a folder share a name.
- Moves never overwrite (409), and a folder cannot move into itself (400).
- `withSubdocs: true` (with `type: "file"` only) moves a document's sub-documents folder (`X/` next to `X.dpx.json`) along with it. Both targets are checked before anything moves (409 / 400 into its own sub-documents), and the file goes back if the folder move fails. Two `tree` events are sent, one per path.

## Revisions and outside edits

- Every save bumps `revision`. A stale save gets 409 with the current revision.
- If a file is edited outside without raising its `revision`, the server raises it (`known revision + 1`) the next time it sees the change (watcher, GET or PUT). So a client holding the old revision gets 409, and re-reading gives the new revision.
- SSE `workspace` events (`create`, `change`, `delete`, `tree`): outside changes send all of them (`change` carries the raised `revision`). Through the API only deletes (`delete` for a file, `tree` for a folder) and moves (`tree`, with `path` = the new path and `from` = the old one) send an event, so other tabs update; saves and creates stay silent.
- Saving rewrites the file from the fields the server knows (`normalizeContent`), so fields added by a newer version or by hand are dropped. A file with a newer `version` is never rewritten.
- If the server cannot watch the folder (for example EACCES or the OS watch limit), it logs one line and goes on without outside-change events.

## Block `layout`

A block may carry `layout`, the node positions a user moved on top of the automatic layout (design: `docs/design/block-drag-edit.md`). Files that have it are format `version` 3; older files are read as they are and stored as v3 on the next save. An older server treats v3 files as read-only (422).

```jsonc
"layout": { "v": 1, "basis": { "type": "cloud-architecture", "direction": "right", "count": 3 },
            "items": { "API": { "cx": 212.5, "cy": 96, "parent": "VPC" } } }
```

- Optional. Without it (or with empty `items`) the block draws with the automatic layout.
- `v`: integer >= 1. `items`: at most 2000 entries; keys 1-200 characters, never `__proto__`; each value needs numeric `cx`, `cy` and a string `parent` (at most 200 characters). `basis`: string `type` and `direction` (at most 200 characters each), integer `count` >= 0. `basis.type` is the parsed diagram type (for example `cloud-architecture`), not the block `type`.
- A `PUT` with an invalid `layout` gets 400. A stored file whose `layout` is invalid still reads; only that layout is dropped.
- Unknown fields inside a `v` 1 layout are dropped. A layout with a `v` newer than the server knows is kept verbatim (only checked to be an object with an integer `v`), so a newer client's layout is never wiped.

## Errors

Filesystem conflicts map to 400/409 (`ENOTDIR`, `EISDIR`, `EEXIST`, `ENOTEMPTY`). Responses and server logs never contain absolute paths.
