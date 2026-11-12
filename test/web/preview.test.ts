import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDiagram, nextPreview, renderPreview } from '../../web/src/dsl/adapter.ts';

const GOOD = 'a [icon: aws-ec2]\nb [icon: aws-s3]\na > b\n';

test('renderPreview draws valid code as SVG', async () => {
  const r = await renderPreview('architecture', GOOD, 'light');
  assert.ok(r);
  assert.match(r.svg, /^<svg /);
  assert.equal(nextPreview(null, r)?.stale, false);
});

test('renderPreview returns null for unsupported types', async () => {
  assert.equal(await renderPreview('bpmn', 'x', 'light'), null);
});

test('errors keep the last good render', async () => {
  const good = nextPreview(null, await renderPreview('architecture', GOOD, 'light'));
  assert.ok(good);
  const bad = await renderPreview('architecture', 'a [icon: \nb > > \n{{{', 'light');
  assert.ok(bad);
  assert.ok(bad.diagnostics.some((d) => d.severity === 'error'), 'fixture must produce an error');
  const kept = nextPreview(good, bad);
  assert.equal(kept?.svg, good.svg);
  assert.equal(kept?.stale, true);
  assert.ok(kept!.errors.length > 0);
  // a failed render also keeps it
  assert.equal(nextPreview(good, null)?.svg, good.svg);
  // fixing the code replaces it
  const fixed = nextPreview(kept, await renderPreview('architecture', 'x [icon: aws-ec2]\n', 'light'));
  assert.equal(fixed?.stale, false);
  assert.notEqual(fixed?.svg, good.svg);
});

test('no earlier render and an error shows nothing', async () => {
  const bad = await renderPreview('architecture', 'a [icon: \nb > > \n{{{', 'light');
  assert.equal(nextPreview(null, bad), null);
  assert.equal(analyzeDiagram('architecture', GOOD).parsed, true);
});

test('a failed render keeps the drawing but does not claim zero errors', async () => {
  const good = nextPreview(null, await renderPreview('architecture', GOOD, 'light'), 'architecture');
  assert.ok(good);
  assert.equal(good.failed, false);
  const kept = nextPreview(good, null, 'architecture');
  assert.equal(kept?.svg, good.svg);
  assert.equal(kept?.stale, true);
  assert.equal(kept?.failed, true);
});

test('switching a block to an unsupported type drops the earlier drawing', async () => {
  const good = nextPreview(null, await renderPreview('architecture', GOOD, 'light'), 'architecture');
  assert.ok(good);
  const r = await renderPreview('bpmn', GOOD, 'light');
  assert.equal(r, null);
  assert.equal(nextPreview(good, r, 'bpmn'), null);
  assert.equal(analyzeDiagram('bpmn', '').parsed, false);
});
