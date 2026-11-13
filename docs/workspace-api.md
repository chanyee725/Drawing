# Workspace API (E1)

Paths are relative to the workspace, `/`-separated. No `..`, absolute paths, hidden (`.x`) names or symlinks. A file path may omit the `.dpx.json` extension.

| Route | Notes |
|---|---|
| `GET /api/tree` | folders first; unreadable files are listed with `title:''`, `revision:null`; files with a `plan` carry `pipeline: {state:'plan'}` |
| `GET /api/workspace/projects` | projects view, see below (`/api/projects` belongs to Dispatch) |
| `GET /api/file?path=` / `POST /api/file {path,title?,document?,canvas?,blocks?,plan?}` | create is exclusive (409 if it exists); optional content (a template) is checked like a save (400) |
| `PUT /api/file?path=` `{revision,title,document,canvas,blocks,plan?}` | whole-file save; 409 `{revision}` when `revision` is not the current one |
| `PATCH /api/file/plan?path=` `{revision?,ops}` | step-level plan edit, see below; returns `{path,revision,plan}` |
| `DELETE /api/file?path=` | files only. `?path=sub` never touches a folder `sub/` |
| `POST /api/folder {path}` / `DELETE /api/folder?path=` | folders only; delete is recursive |
| `POST /api/move {from,to,type?}` | rename = move |

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

## Revisions and outside edits

- Every save bumps `revision`. A stale save gets 409 with the current revision. A plan patch bumps it too.
- If a file is edited outside without raising its `revision`, the server raises it (`known revision + 1`) the next time it sees the change (watcher, GET or PUT). So a client holding the old revision gets 409, and re-reading gives the new revision.
- SSE `workspace` events (`create`, `change`, `delete`, `tree`): outside changes send all of them (`change` carries the raised `revision`). Through the API only deletes (`delete` for a file, `tree` for a folder) and moves (`tree`, with `path` = the new path and `from` = the old one) send an event, so other tabs update; saves and creates stay silent. A plan patch sends `change` with the new `revision`, so an open, clean tab reloads and a tab with unsaved edits gets 409 on its next save.
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

## Pipeline `plan`

A file may carry a top-level `plan`: the steps of an agent pipeline drawn in one of its diagram blocks (design: `docs/design/dispatch-integration/2-file-format-and-live-overlay.md` §3). Files are format `version` 4; v3 files read as they are and are stored as v4 on the next save. An older server treats v4 files as read-only (422). Rules live in `shared/dispatch/plan.ts` (`planProblem`, `cleanPlan`), shared by the server and the web.

```jsonc
"plan": { "v": 1, "block": "b_pipe", "defaults": { "provider": "claude", "perm": "acceptEdits" },
          "steps": [ { "id": "impl", "node": "impl", "role": "impl", "n": 2, "task": "Implement section 2." },
                     { "id": "merge", "node": "merge", "role": "lead", "gate": "manual", "after": ["impl"] } ] }
```

- Optional. A file without `plan` is an ordinary drawing. Saving without `plan` removes it.
- `v`: integer >= 1. `block`: the diagram block id, 1-200 characters. `steps`: at most 200.
- A step needs `id` or `node` (1-200 characters each); the missing one is filled from the other. Ids are unique.
- `role`, `model`, `effort`, `provider`: strings of 1-200 characters. `perm`: `manual`, `acceptEdits`, `auto` or `plan` (nothing looser). `n`: integer 1-4. `task`: at most 20 000 characters, instructions only (no transcripts, tokens, keys or personal data). `gate`: `auto` or `manual`. `after`: step ids (at most 200).
- `defaults` takes the same fields and fills them into steps that omit them.
- A `PUT` or `POST` with an invalid `plan` gets 400. A stored file whose `plan` is invalid still reads; only the plan is dropped. Unknown fields in a `v` 1 plan are dropped; a plan with a newer `v` is kept verbatim (only checked to be an object with an integer `v`) and cannot be patched (422).
- Storage does not check that `block` exists, that `after` names real steps or that there is no cycle: a person deleting the diagram must still be able to save. Those make the plan not runnable; `planOrder` (`shared/dispatch/plan.ts`) reports them. Order: a step's `after`, or else the diagram edges between step nodes (edges to other nodes are ignored). A step whose node is missing from the diagram still runs.

`PATCH /api/file/plan?path=` `{revision?, ops}` re-reads the file under the store lock, applies the ops in order, validates and writes (`revision + 1`, the previous file kept in history). With `revision`, a stale one gets 409. Up to 200 ops; any failure leaves the file unchanged (400):

| Op | Effect |
|---|---|
| `{op:'plan', block?, defaults?}` | Set plan-level fields. Starts a plan (needs `block`) when the file has none. `defaults: null` removes them. |
| `{op:'add', step, before?}` | Insert a step before step `before`, or at the end. |
| `{op:'set', id, step}` | Change step `id`'s fields; `null` removes a field. A new `id` is renamed in every `after` and keeps the node link. |
| `{op:'remove', id}` | Remove step `id` and drop it from every `after`. |

## Errors

Filesystem conflicts map to 400/409 (`ENOTDIR`, `EISDIR`, `EEXIST`, `ENOTEMPTY`). Responses and server logs never contain absolute paths.
