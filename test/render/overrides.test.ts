import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import type { GraphDiagram } from '../../shared/dsl/index.ts';
import { basisOf, reconcileForSave, reconcileLayout, structureOf } from '../../shared/render/overrides.ts';
import type { BlockLayout, LayoutItem } from '../../shared/render/overrides.ts';

function ast(code: string): GraphDiagram {
  return parse(code, 'cloud-architecture').ast as GraphDiagram;
}

const BASE = 'VPC {\n  API [icon: server]\n  Cache\n}\nDB [icon: database]\nAPI > DB\nAPI > Cache';

function layoutFor(code: string, keys: Record<string, string>): BlockLayout {
  const d = ast(code);
  const items: Record<string, LayoutItem> = {};
  for (const [k, parent] of Object.entries(keys)) items[k] = { cx: 10, cy: 20, parent };
  return { v: 1, basis: basisOf(d), items };
}
const FULL = { API: 'VPC', Cache: 'VPC', DB: '' };

test('structureOf lists nodes and groups with their parents', () => {
  const s = structureOf(ast(BASE));
  assert.deepEqual([...s.parents], [['VPC', ''], ['API', 'VPC'], ['Cache', 'VPC'], ['DB', '']]);
  assert.equal(s.count, 4);
  assert.equal(s.direction, 'right');
});

test('no layout or empty items: nothing to do', () => {
  assert.deepEqual(reconcileLayout(ast(BASE), undefined), { layout: undefined, dropped: [], changed: false });
  const empty: BlockLayout = { v: 1, items: {} };
  assert.equal(reconcileLayout(ast(BASE), empty).layout, empty);
});

test('unknown layout version is returned as is, never wiped', () => {
  // Every key is gone and the type differs: v1 rules would reset, but v2 must be left alone.
  const v2 = { v: 2, basis: { type: 'flowchart', direction: 'down', count: 99 }, items: { Gone: { cx: 1, cy: 2, parent: 'X' }, Other: { cx: 3, cy: 4, parent: '' } } } as BlockLayout;
  const r = reconcileLayout(ast(BASE), v2);
  assert.equal(r.layout, v2);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.changed, false);
  assert.equal(r.reset, undefined);
  const saved = reconcileForSave(parse(BASE, 'cloud-architecture') as never, v2);
  assert.equal(saved.layout, v2);
  assert.equal(saved.changed, false);
});

test('layout without items does not throw and counts as no keys', () => {
  const bare: BlockLayout = { v: 1, basis: { type: 'flowchart', direction: 'down', count: 99 } };
  const r = reconcileLayout(ast(BASE), bare);
  assert.equal(r.layout, bare);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.changed, false);
  assert.equal(reconcileForSave(parse(BASE, 'cloud-architecture') as never, bare).layout, bare);
});

test('label, colour, icon, shape and edge edits keep every override', () => {
  const l = layoutFor(BASE, FULL);
  const edited = 'VPC {\n  API [icon: lambda, label: Gateway, color: red, shape: oval]\n  Cache\n}\nDB [icon: database]\nAPI > DB: sql\nDB > Cache';
  const r = reconcileLayout(ast(edited), l);
  assert.equal(r.layout, l);
  assert.equal(r.changed, false);
  assert.deepEqual(r.dropped, []);
});

test('adding a node keeps the others', () => {
  const l = layoutFor(BASE, FULL);
  const r = reconcileLayout(ast(BASE + '\nQueue'), l);
  assert.equal(r.layout, l);
  assert.equal(r.changed, false);
});

test('deleting a node drops only that key', () => {
  const l = layoutFor('VPC {\n  API\n  Cache\n}\nDB\nWorker\nAPI > DB', { API: 'VPC', Cache: 'VPC', DB: '', Worker: '' });
  const r = reconcileLayout(ast('VPC {\n  API\n  Cache\n}\nDB\nAPI > DB'), l);
  assert.deepEqual(r.dropped, ['Worker']);
  assert.deepEqual(Object.keys(r.layout!.items), ['API', 'Cache', 'DB']);
  assert.equal(r.changed, true);
  assert.equal(r.reset, undefined);
  assert.equal(l.items.Worker !== undefined, true, 'input is not mutated');
});

test('renaming a node drops the old key; the new name has no override', () => {
  const l = layoutFor(BASE + '\nQueue', { ...FULL, Queue: '' });
  const r = reconcileLayout(ast('VPC {\n  API\n  Cache\n}\nDB\nQueue2\nAPI > DB\nAPI > Cache'), l);
  assert.deepEqual(r.dropped, ['Queue']);
  assert.equal(r.layout!.items.Queue2, undefined);
  assert.deepEqual(Object.keys(r.layout!.items).sort(), ['API', 'Cache', 'DB']);
});

test('moving a node to another group drops that key', () => {
  const code = 'VPC {\n  API\n  Cache\n}\nDB\nWeb\nAPI > DB';
  const l = layoutFor(code, { API: 'VPC', Cache: 'VPC', DB: '', Web: '' });
  const r = reconcileLayout(ast('VPC {\n  API\n  Cache\n  Web\n}\nDB\nAPI > DB'), l);
  assert.deepEqual(r.dropped, ['Web']);
  assert.equal(r.reset, undefined);
});

test('implicit nodes behave like normal ones', () => {
  const l = layoutFor('A > B', { A: '', B: '' });
  assert.equal(reconcileLayout(ast('A > B\nB > A'), l).layout, l);
  const gone = reconcileLayout(ast('A > C\nA > D\nA > E'), layoutFor('A > B\nA > D', { A: '', B: '', D: '' }));
  assert.deepEqual(gone.dropped, ['B']);
});

test('empty group keys are kept while the group exists', () => {
  const l = layoutFor('Empty {\n}\nA\nB', { Empty: '', A: '', B: '' });
  assert.equal(reconcileLayout(ast('Empty {\n}\nA\nB'), l).changed, false);
});

test('reset: diagram type changes', () => {
  const l = layoutFor('A > B', { A: '', B: '' });
  const flow = parse('A > B', 'flowchart').ast as GraphDiagram;
  const r = reconcileLayout(flow, l);
  assert.equal(r.reset, 'type');
  assert.equal(r.layout, undefined);
});

test('reset: direction changes', () => {
  const l = layoutFor('A > B', { A: '', B: '' });
  const r = reconcileLayout(ast('direction down\nA > B'), l);
  assert.equal(r.reset, 'direction');
  assert.equal(r.layout, undefined);
  assert.deepEqual(r.dropped, ['A', 'B']);
});

test('reset: half or more of the keys dropped (2+ keys)', () => {
  const l = layoutFor('A\nB\nC\nD', { A: '', B: '', C: '', D: '' });
  const r = reconcileLayout(ast('A\nB\nX\nY'), l);
  assert.equal(r.reset, 'dropped');
  const below = reconcileLayout(ast('A\nB\nC\nY'), l);
  assert.equal(below.reset, undefined);
  assert.deepEqual(below.dropped, ['D']);
});

test('a single key is dropped alone, not reset', () => {
  const l = layoutFor('A\nB\nC', { A: '' });
  const r = reconcileLayout(ast('B\nC\nD'), l);
  assert.equal(r.reset, undefined);
  assert.deepEqual(r.layout!.items, {});
  assert.deepEqual(r.dropped, ['A']);
});

test('reset: node+group count moves more than 50% from basis.count', () => {
  const l = layoutFor('A\nB\nC\nD', { A: '', B: '' });
  const grown = reconcileLayout(ast('A\nB\nC\nD\nE\nF\nG'), l); // 4 -> 7
  assert.equal(grown.reset, 'count');
  const ok = reconcileLayout(ast('A\nB\nC\nD\nE\nF'), l); // 4 -> 6 is exactly +50%
  assert.equal(ok.reset, undefined);
  assert.equal(ok.layout, l);
  const shrunk = reconcileLayout(ast('A\nB'), layoutFor('A\nB\nC\nD\nE', { A: '', B: '' })); // 5 -> 2
  assert.equal(shrunk.reset, 'count');
});

test('without basis only the per-key rules apply', () => {
  const l: BlockLayout = { v: 1, items: { A: { cx: 1, cy: 2, parent: '' }, B: { cx: 1, cy: 2, parent: '' } } };
  const r = reconcileLayout(ast('A\nB\nC\nD\nE\nF\nG\nH'), l);
  assert.equal(r.layout, l);
});

test('reconcileForSave leaves the layout alone while the code has errors', () => {
  const l = layoutFor('A\nB\nC\nD', { A: '', B: '', C: '', D: '' });
  const bad = parse('A\nA\nX\nY', 'cloud-architecture') as { ast: GraphDiagram; diagnostics: { severity: string }[] };
  assert.ok(bad.diagnostics.some((d) => d.severity === 'error'), 'fixture must contain an error');
  const r = reconcileForSave(bad as never, l);
  assert.equal(r.layout, l);
  assert.equal(r.changed, false);
  const good = reconcileForSave(parse('A\nX\nY\nZ', 'cloud-architecture') as never, l);
  assert.equal(good.reset, 'dropped');
});

test('a group that gained children loses its key; odd key names are plain data', () => {
  const before = 'VPC {\n}\nDB\nWeb\nVPC > DB';
  const l: BlockLayout = { v: 1, basis: basisOf(ast(before)), items: { VPC: { cx: 1, cy: 2, parent: '' }, DB: { cx: 3, cy: 4, parent: '' }, Web: { cx: 5, cy: 6, parent: '' } } };
  const r = reconcileLayout(ast('VPC {\n  API\n}\nDB\nWeb\nVPC > DB'), l);
  assert.deepEqual(r.dropped, ['VPC']);
  assert.deepEqual(Object.keys(r.layout!.items!), ['DB', 'Web']);
  // `__proto__` never survives; `constructor` is an ordinary node name.
  const items = JSON.parse('{"__proto__":{"cx":1,"cy":2,"parent":""},"constructor":{"cx":3,"cy":4,"parent":""},"DB":{"cx":5,"cy":6,"parent":""}}');
  const r2 = reconcileLayout(ast('constructor\nDB\nconstructor > DB\nDB > constructor'), { v: 1, items });
  assert.deepEqual(r2.dropped, ['__proto__']);
  assert.deepEqual(Object.keys(r2.layout!.items!).sort(), ['DB', 'constructor']);
  assert.equal(Object.getPrototypeOf(r2.layout!.items), Object.prototype);
});

test('basisOf stores the AST type, so a saved layout is not wiped on the next render', () => {
  const d = ast(BASE);
  assert.equal(basisOf(d).type, 'cloud-architecture');
  const l = layoutFor(BASE, FULL);
  assert.equal(reconcileLayout(d, l).changed, false);
  // The editor block type ("architecture") is not the AST type.
  assert.equal(reconcileLayout(d, { ...l, basis: { ...l.basis!, type: 'architecture' } }).reset, 'type');
});
