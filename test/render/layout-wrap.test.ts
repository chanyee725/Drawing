// Experimental top-level group wrap (E65, #276): off by default, and readable when on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiagram } from '../../shared/render/index.ts';
import type { Scene, SceneBox } from '../../shared/render/index.ts';
import { pickRows, WRAP_ROW_GAP } from '../../shared/render/layout-wrap.ts';
import { fixture } from '../dsl/helpers.ts';
import { layoutMetrics } from './layout-metrics.ts';

const SAMPLE = fixture('flowchart-procure-to-pay');
const OTHERS = ['architecture-web-service', 'flowchart-ticket-workflow', 'sequence-login', 'erd-billing'];

/** Four groups in a chain, with a loop back to the first and a link that skips a group. */
const CHAIN = `direction right
Intake { Request
  Check }
Build { Plan
  Make
  Test }
Ship { Pack
  Send }
Close { Invoice
  Archive }
Request > Check > Plan > Make > Test > Pack > Send > Invoice > Archive
Test > Plan: Fails
Check > Pack: Stock item
Archive > Request: Next order`;

const box = (scene: Scene, id: string): SceneBox => scene.items.find((it): it is SceneBox => it.kind === 'box' && it.id === id)!;

test('wrap is off by default: an explicit false and no option draw the same picture', async () => {
  for (const code of [SAMPLE, CHAIN, ...OTHERS.map(fixture)]) {
    const plain = await renderDiagram(code);
    const off = await renderDiagram(code, { wrapGroups: false });
    assert.equal(off.svg, plain.svg);
  }
});

test('wrap leaves diagrams without two top-level groups alone', async () => {
  for (const name of OTHERS) {
    const plain = await renderDiagram(fixture(name));
    const on = await renderDiagram(fixture(name), { wrapGroups: true });
    assert.equal(on.svg, plain.svg, name);
  }
});

test('sample flowchart: one line becomes two rows, connectors stay clean', async () => {
  const before = layoutMetrics((await renderDiagram(SAMPLE)).scene);
  const { scene } = await renderDiagram(SAMPLE, { wrapGroups: true });
  const after = layoutMetrics(scene);
  const procure = box(scene, 'Procure');
  const pay = box(scene, 'Pay');
  assert.equal(pay.x, procure.x);
  assert.equal(Math.round(pay.y - (procure.y + procure.h)), WRAP_ROW_GAP);
  assert.equal(pay.w, procure.w, 'the shorter row reaches the block edge');
  assert.ok(after.width < before.width * 0.6, `${after.width} against ${before.width}`);
  assert.ok(after.aspect < before.aspect / 3);
  assert.deepEqual(
    { crossings: after.crossings, overlaps: after.overlaps, throughNodes: after.throughNodes, labelsOnNodes: after.labelsOnNodes },
    { crossings: 0, overlaps: 0, throughNodes: 0, labelsOnNodes: 0 },
  );
  // The one connector between the rows: out of the bottom, along the gap, into the top.
  const link = scene.items.find((it) => it.kind === 'edge' && it.from === 'Issue the order' && it.to === 'Receive the goods');
  assert.ok(link && link.kind === 'edge');
  assert.equal(link.points.length, 4);
  const run = link.points[1]!.y;
  assert.ok(run > procure.y + procure.h && run < pay.y, 'the long run is in the gap between the rows');
  assert.equal(after.bends, before.bends + 2);
});

test('sample flowchart, top to bottom: the rows are columns', async () => {
  const code = SAMPLE.replace('direction right', 'direction down');
  const before = layoutMetrics((await renderDiagram(code)).scene);
  const { scene } = await renderDiagram(code, { wrapGroups: true });
  const after = layoutMetrics(scene);
  const procure = box(scene, 'Procure');
  const pay = box(scene, 'Pay');
  assert.equal(pay.y, procure.y);
  assert.equal(Math.round(pay.x - (procure.x + procure.w)), WRAP_ROW_GAP);
  assert.ok(after.height < before.height * 0.6);
  assert.deepEqual([after.crossings, after.overlaps, after.throughNodes], [0, 0, 0]);
});

test('a chain of four groups wraps, nothing runs through a node, and it is deterministic', async () => {
  const before = layoutMetrics((await renderDiagram(CHAIN)).scene);
  const a = await renderDiagram(CHAIN, { wrapGroups: true });
  const b = await renderDiagram(CHAIN, { wrapGroups: true });
  assert.equal(a.svg, b.svg);
  const after = layoutMetrics(a.scene);
  assert.ok(Math.abs(Math.log(after.aspect / 1.5)) < Math.abs(Math.log(before.aspect / 1.5)), `${after.aspect} against ${before.aspect}`);
  assert.equal(after.throughNodes, 0);
  assert.equal(after.edges, before.edges);
});

test('wrap skips left and up flows', async () => {
  for (const dir of ['left', 'up']) {
    const code = SAMPLE.replace('direction right', `direction ${dir}`);
    assert.equal((await renderDiagram(code, { wrapGroups: true })).svg, (await renderDiagram(code)).svg, dir);
  }
});

test('pickRows: the split closest to 3:2, breaking only between groups', () => {
  const unit = (x0: number, w: number, hasGroup = true) => ({ x0, x1: x0 + w, y0: 0, y1: 200, hasGroup });
  // Four 400-wide groups 48 apart: one row is 1744 x 200, two rows 848 x 464, four rows 400 x 992.
  const four = [unit(0, 400), unit(448, 400), unit(896, 400), unit(1344, 400)];
  assert.deepEqual(pickRows(four).map((r) => r.length), [2, 2]);
  // A loose node between two groups stays on the row of the group before it.
  const mixed = [unit(0, 900), unit(948, 100, false), unit(1096, 900)];
  assert.deepEqual(pickRows(mixed).map((r) => r.length), [2, 1]);
  // Already close to 3:2: left as one row.
  assert.equal(pickRows([unit(0, 150), unit(170, 150)]).length, 1);
});
