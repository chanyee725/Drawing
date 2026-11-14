# Flowchart group wrap (E65, #276)

Status: prototype behind an option, default unchanged. Whether to switch the default is the user's call.

## Problem

A flowchart whose top-level groups form a chain is laid out as one line. The sample (two groups, 12 nodes,
`direction right`) is 2746 x 275, about 10:1. In the canvas view at 1440x900 "zoom to fit" lands on 40% and
node text is hard to read. The reference tool draws the same content as two stacked rows with one connector
running in the gap between them.

The sample is `test/dsl/fixtures/flowchart-procure-to-pay.eraser`. Its original code was not kept with the
comparison captures, so the fixture was rewritten from those captures; node names and links match what the
pictures show, attributes are a best reading.

## How the layout is built today

`shared/render/layout-graph.ts`, `graphBase`:

1. Measure nodes and groups (`measureNode`, `measureGroup`, `unifySizes`).
2. `layoutScope` runs ELK `layered` once per scope with `hierarchyHandling: INCLUDE_CHILDREN`, so groups are
   compound nodes and the diagram's `direction` applies at every level. A chain of groups therefore becomes
   one layer after another along the flow axis: one line.
3. Children no edge touches are taken out of ELK and packed in grids (`gridOf`, `packGrid`). Free groups
   already wrap towards 3:2 (`bandColumns`, `BAND_ASPECT`). Groups joined by edges do not.
4. `alignLayout` snaps layers and matches sibling group bands; `routeAcross` routes edges over divider rows
   with the obstacle router (`route-around.ts`); `routeEdges` deals out ports and shares buses.
5. `composeGraph` paints, applying saved per-block overrides (`block.layout`: node centres in layout
   coordinates).

## Options

| | A. Wrap after layout | B. ELK wrapping | C. Lay groups out apart, then the root across the flow |
|---|---|---|---|
| How | Keep steps 1-4, then move top-level items as rigid blocks into rows and reroute only the edges that now join two rows | `elk.layered.wrapping.strategy` on the root | ELK per group, then a second ELK run over group boxes with the direction turned |
| Inside a group | Unchanged, pixel for pixel | Changes | Loses the pull of edges that leave the group |
| Connectors between rows | Ours: obstacle router, long run in the row gap | ELK's | ELK's to the group box, ours from the box to the node |
| Cost | About 200 lines, no new ELK options | Small | Larger: two passes, port stitching |
| Risk | Row-crossing routes are only as good as the router; many of them crowd the gap | ELK cuts between layers, not between groups, and its wrapping is documented for flat graphs; with `INCLUDE_CHILDREN` a cut can fall inside a group | Two layouts to keep consistent; group-internal order may flip |

Only A was built. B and C were not tried, so the table's entries for them are expectations from how the
code and ELK's options are documented, not measurements.

## Recommendation

A. It leaves everything inside a group exactly as today, which keeps the change reviewable and the default
path untouched, and it reuses the router that already handles divider rows.

## Prototype

`shared/render/layout-wrap.ts`, called from `graphBase` after `alignLayout` when `wrapGroups` is set.

- Top-level items that overlap along the flow axis (one ELK layer) form a unit. Units keep their order.
- Row split: every width limit that some run of units defines is tried; the split whose block is closest to
  3:2 wins, fewer rows on a tie. One row winning means nothing changes. A row only breaks in front of a unit
  holding a group, so a loose node stays with what precedes it.
- Rows are left-aligned, 64 px apart. A lone group ending a row is widened to the block edge.
- Edges within a row move with it. Edges between rows are rerouted: no running along the flow inside a
  top-level group (so the long run goes to the gap), off other groups, nodes and group titles, never out of
  the start's back side or into the end's far side. They draw as elbows whatever the connector style.
- `direction down` is handled by mirroring on the diagonal: rows become columns.
- Skipped: `left`/`up`, fewer than two top-level groups, divider rows at the root.

Turning it on:

- Code: `renderDiagram(code, { wrapGroups: true })`, `graphBase(ast, { wrapGroups: true })`.
- Browser: `localStorage['drawing.experiment.groupWrap'] = '1'`, then reload (`web/src/experiments.ts`).
  Nothing in the UI sets it.

## Measurements

`scripts/capture-group-wrap.mjs`: headless, 1440x900 @2x, canvas view, zoom to fit, a fresh file per capture.
Counts come from `test/render/layout-metrics.ts`. Light and dark give the same numbers.

Sample (`direction right`):

| | Before | After |
|---|---|---|
| Fit zoom (zoom control) | 40% | 70% |
| Picture | 2746 x 275 (9.99:1) | 1474 x 526 (2.80:1) |
| Connectors / bends | 12 / 6 | 12 / 8 |
| Connector crossings | 0 | 0 |
| Connectors overlapping | 0 | 0 |
| Connectors through a node | 0 | 0 |
| Labels on a node | 0 | 0 |

The two extra bends are the one connector between the rows (bottom of the last node, along the gap, top of
the first node).

Other cases, from the renderer only (no browser):

| Case | Picture before -> after | Bends | Crossings | Through a node |
|---|---|---|---|---|
| Sample, `direction down` | 428 x 1584 -> 871 x 914 | 6 -> 8 | 0 -> 0 | 0 -> 0 |
| Four groups, with a loop back and a link skipping a group | 2176 x 328 -> 960 x 532 | 14 -> 17 | 0 -> 3 | 0 -> 0 |

The four-group case shows the cost: links that were parallel in one line cross once they turn through the
gaps, and one connector's vertical run passes behind another's label.

## Connector routing impact

- Only edges between rows change; all others are translated with their row.
- A row-crossing edge is marked like a parallel or self edge, so `routeEdges` leaves it alone: it takes no
  part in even port spacing or shared buses, and it ignores `connectorStyle: straight`.
- A gap offers five tracks 8 px apart. More edges than that in one gap fall back to less tidy routes.
- With `direction down` the gap is a vertical strip 64 px wide; a long label on the connector in it is wider
  than the strip and overlaps the group borders.
- Backward links (a loop to an earlier row) work but tend to cross forward ones.

## Risks of making it the default

1. Saved blocks keep the width they were first drawn at. A block saved as one line and redrawn wrapped is
   shown at the old width, about 1.9x larger for the sample. A default switch needs a rule for existing
   blocks (refit the block, or wrap only new ones).
2. Saved `block.layout` overrides are node centres in one-line coordinates; under the wrap they point at the
   wrong place. They would have to be dropped or the wrap skipped for blocks that have them.
3. Every snapshot of a diagram with two or more linked top-level groups changes, including documents users
   already arranged around the old shape (PDF and image exports too).
4. Dragging a node of a row-crossing edge redraws that edge with the simple elbow (`routeElbow`), which does
   not avoid the rows.
5. Not covered: `left`/`up`, root divider rows, nested groups (only the top level wraps), cloud architecture
   diagrams (same code path, not looked at).
6. The 3:2 target and the 64 px gap are guesses checked on two diagrams.

## If the default is switched later

Suggested order: decide the rule for existing blocks (risk 1 and 2), add `left`/`up`, try option B on the
sample for comparison, then run the wrap over the layout fuzz set and the example survey diagrams before
flipping.
