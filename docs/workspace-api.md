# Workspace API (E1)

Paths are relative to the workspace, `/`-separated. No `..`, absolute paths, hidden (`.x`) names or symlinks. A file path may omit the `.dpx.json` extension.

| Route | Notes |
|---|---|
| `GET /api/tree` | folders first; unreadable files are listed with `title:''`, `revision:null` |
| `GET /api/file?path=` / `POST /api/file {path,title?}` | create is exclusive (409 if it exists) |
| `PUT /api/file?path=` `{revision,title,document,canvas,blocks}` | whole-file save; 409 `{revision}` when `revision` is not the current one |
| `DELETE /api/file?path=` | files only. `?path=sub` never touches a folder `sub/` |
| `POST /api/folder {path}` / `DELETE /api/folder?path=` | folders only; delete is recursive |
| `POST /api/move {from,to,type?}` | rename = move |

## Delete and move rules

- `DELETE /api/file` always normalizes to `<path>.dpx.json` and removes that file only. `DELETE /api/folder` removes a directory only. Neither falls back to the other kind (404).
- `move` without `type`: a **file wins**. `from` is tried as a file (`<from>.dpx.json`) first, then as a folder. Send `type: "folder"` (or `"file"`) to be explicit when a file and a folder share a name.
- Moves never overwrite (409), and a folder cannot move into itself (400).

## Revisions and outside edits

- Every save bumps `revision`. A stale save gets 409 with the current revision.
- If a file is edited outside without raising its `revision`, the server raises it (`known revision + 1`) the next time it sees the change (watcher, GET or PUT). So a client holding the old revision gets 409, and re-reading gives the new revision.
- SSE `workspace` events (`create`, `change`, `delete`, `tree`): outside changes send all of them (`change` carries the raised `revision`). Through the API only deletes (`delete` for a file, `tree` for a folder) and moves (`tree`, with `path` = the new path and `from` = the old one) send an event, so other tabs update; saves and creates stay silent.
- Saving rewrites the file from the fields the server knows (`normalizeContent`), so fields added by a newer version or by hand are dropped. A file with a newer `version` is never rewritten.
- If the server cannot watch the folder (for example EACCES or the OS watch limit), it logs one line and goes on without outside-change events.

## Errors

Filesystem conflicts map to 400/409 (`ENOTDIR`, `EISDIR`, `EEXIST`, `ENOTEMPTY`). Responses and server logs never contain absolute paths.
