# 0001. Diagram renderer: vendored diagrams.net viewer

Date: 2026-11-12 · Ticket: T3

## Decision

Render pages with the official diagrams.net viewer, `viewer-static.min.js`
**v32.6.10**, committed unmodified at `web/static/vendor/drawio/` and served by
our own server at `/vendor/drawio/viewer-static.min.js`.

- Source: https://raw.githubusercontent.com/jgraph/drawio/v32.6.10/src/main/webapp/js/viewer-static.min.js
- Project: https://github.com/jgraph/drawio (tag `v32.6.10`)
- SHA-256: `35b8ef54369e938ad2399d3c8ce3945591d4b200a01f6942d0e39743bea1f1a1`
- Licence: Apache-2.0 (`LICENSE` and `NOTICE` next to the file). Size 4.9 MB.
  The bundle includes third-party code (DOMPurify, pako, spin.js, Babel helpers); see `web/static/vendor/drawio/THIRD_PARTY.md`.

We use its `Graph` class directly (not the `GraphViewer` widget) so we own
pan/zoom, can swap the model in place on live changes, and can map cell ids
to screen rects for overlays.

## Why

- Faithful: it is draw.io's own renderer, so HTML labels, draw.io shapes
  (e.g. `mxgraph.aws4.*`), embedded images and edge styles match the editor.
  All 7 pages of the sim-studio handover diagram render.
- Licence: Apache-2.0, compatible with redistribution.
- Offline: the file is local. Before loading it we point every lazy path
  (`STYLE_PATH`, `SHAPES_PATH`, `STENCIL_PATH`, `GRAPH_IMAGE_PATH`, …) at
  `/vendor/drawio/…`, turn off resource/stylesheet loading and make
  `Graph.addFont` a no-op so Google Fonts are never fetched. A headless check
  logged no request to any host other than 127.0.0.1.

## Alternatives

- `@maxgraph/core` 0.25 (Apache-2.0): bundles cleanly, but lacks draw.io's
  shape library and label handling; output would differ from the editor.
- `mxgraph` 4.2.2 on npm (Apache-2.0): unmaintained since 2020, same gaps.
- Loading the viewer from `viewer.diagrams.net`: not offline, sends traffic out.

## Limits

- Stencils not built into the viewer would be requested from
  `/vendor/drawio/stencils/…` (404, the shape draws empty). None are used in
  the handover diagrams.
- Images referenced by URL inside a diagram are loaded by the browser as the
  diagram says; we do not proxy them.
- Upgrading: replace the file, update the version, URL and SHA-256 here and in
  `NOTICE`.
