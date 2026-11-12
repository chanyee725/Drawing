import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconFor } from '../../shared/render/icons.ts';
import { attributeCompletions, ICON_NAMES } from '../../web/src/dsl/completion.ts';

const labels = (r: ReturnType<typeof attributeCompletions>) => r?.options.map((o) => o.label) ?? [];

test('no completions outside brackets, after a closing bracket, or inside quotes', () => {
  assert.equal(attributeCompletions('architecture', 'Web ic'), null);
  assert.equal(attributeCompletions('architecture', 'Web [icon: user] ic'), null);
  assert.equal(attributeCompletions('architecture', 'Web [label: "a, ic'), null);
});

test('attribute keys are offered after [ and after a comma', () => {
  const a = attributeCompletions('architecture', 'Web [ic');
  assert.equal(a?.from, 'Web ['.length);
  assert.ok(labels(a).includes('icon') && labels(a).includes('connectorStyle'));
  const b = attributeCompletions('architecture', 'Web [icon: user, co');
  assert.equal(b?.from, 'Web [icon: user, '.length);
  assert.ok(labels(b).includes('color'));
});

test('keys depend on the diagram type and legend lines', () => {
  assert.ok(!labels(attributeCompletions('erd', 'users [')).includes('shape'));
  assert.ok(labels(attributeCompletions('flowchart', 'A [')).includes('shape'));
  assert.ok(labels(attributeCompletions('flowchart', 'legend [')).includes('position'));
});

test('icon values come from the icon list', () => {
  const r = attributeCompletions('architecture', 'Web [icon: aw');
  assert.equal(r?.from, 'Web [icon: '.length);
  assert.deepEqual(labels(r), [...ICON_NAMES]);
  assert.ok(ICON_NAMES.includes('aws-ec2') && ICON_NAMES.includes('user'));
});

test('every suggested icon name resolves to a bundled icon, never the placeholder', () => {
  for (const n of ICON_NAMES) assert.notEqual(iconFor(n).set, 'own', n);
  assert.ok(ICON_NAMES.includes('postgresql') && ICON_NAMES.includes('house'));
  assert.ok(!ICON_NAMES.includes('placeholder') && !ICON_NAMES.includes('balancer'));
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
});

test('enum, color and connection values are offered', () => {
  assert.deepEqual(labels(attributeCompletions('flowchart', 'A [shape: ')).slice(0, 2), ['rectangle', 'circle']);
  assert.ok(labels(attributeCompletions('flowchart', 'A > B: [color: bl')).includes('blue'));
  assert.deepEqual(labels(attributeCompletions('flowchart', 'A [connectorStyle: ')), ['elbow', 'straight', 'arc']);
  assert.ok(labels(attributeCompletions('flowchart', 'legend { [connection: ')).includes('-->'));
});

test('free-text values (label, link) and finished values offer nothing', () => {
  assert.equal(attributeCompletions('flowchart', 'A [label: '), null);
  assert.equal(attributeCompletions('flowchart', 'A [color: blue '), null);
});
