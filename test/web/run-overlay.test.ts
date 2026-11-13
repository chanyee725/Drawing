import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { edgeKey, layoutDiagram, nodeRects } from '../../shared/render/index.ts';
import type { Scene } from '../../shared/render/index.ts';
import { agentColors, overlayModel, pathData, roleColor } from '../../web/src/run/overlayModel.ts';
import { FIXTURE_BLOCKED, FIXTURE_CODE, FIXTURE_STEPS } from '../../web/src/run/fixture.ts';

async function scene(code: string): Promise<Scene> {
  const { ast } = parse(code, 'flowchart');
  return layoutDiagram(ast);
}

test('one ring per linked step, on its node box, glyph and text with every state', async () => {
  const s = await scene(FIXTURE_CODE);
  const m = overlayModel(s, FIXTURE_STEPS);
  const rects = nodeRects(s);
  assert.deepEqual(m.nodes.map((n) => [n.node, n.view, n.glyph]), [
    ['plan', 'done', '✓'],
    ['impl', 'done', '✓'],
    ['review', 'review', '◐'],
    ['test', 'active', '●'],
    ['merge', 'pending', '◌'],
  ]);
  for (const n of m.nodes) {
    assert.deepEqual(n.rect, rects.get(n.node));
    // Never colour alone: the visible text starts with the state label.
    assert.match(n.text, /^(대기|진행|리뷰|완료|막힘)/);
  }
  assert.deepEqual(m.missing, []);
});

test('colours: owner role while active/review, status tokens otherwise', async () => {
  const m = overlayModel(await scene(FIXTURE_CODE), FIXTURE_STEPS);
  const by = new Map(m.nodes.map((n) => [n.node, n]));
  assert.equal(by.get('review')!.color, 'var(--role-review)');
  assert.equal(by.get('test')!.color, 'var(--role-test)');
  assert.equal(by.get('plan')!.color, 'var(--ok)');
  assert.equal(by.get('merge')!.color, 'var(--idle)');
  assert.equal(by.get('review')!.live, true);
  assert.equal(by.get('plan')!.live, false);
  const b = overlayModel(await scene(FIXTURE_CODE), FIXTURE_BLOCKED).nodes.find((n) => n.node === 'test')!;
  assert.equal(b.color, 'var(--bad)');
  assert.equal(b.live, false);
  assert.equal(b.glyph, '⚠');
});

test('active step with no session yet is green', async () => {
  const m = overlayModel(await scene('a\nb\na > b'), [{ id: 'a', view: 'active' }]);
  assert.equal(m.nodes[0]!.color, 'var(--ok)');
});

test('labels: name, state, agents with role, waiting tag only when live', async () => {
  const m = overlayModel(await scene(FIXTURE_CODE), FIXTURE_STEPS);
  const by = new Map(m.nodes.map((n) => [n.node, n]));
  assert.equal(by.get('review')!.label, 'Review · 리뷰 · Oren(리뷰어) · 사람 기다림');
  assert.equal(by.get('impl')!.label, 'Implement · 완료 · Juno(구현자) · Tali(구현자)');
  assert.equal(by.get('impl')!.text, '완료 · Juno · Tali');
  assert.equal(by.get('merge')!.text, '대기');
  const done = overlayModel(await scene('a'), [{ id: 'a', view: 'done', waiting: true }]).nodes[0]!;
  assert.equal(done.waiting, false);
  const many = overlayModel(await scene('a'), [{ id: 'a', view: 'active', agents: ['A', 'B', 'C'].map((name) => ({ name, role: 'impl' })) }]).nodes[0]!;
  assert.equal(many.text, '진행 · A 외 2');
});

test('same role: same hue, a lightness step per agent, kept across steps', () => {
  const c = agentColors([
    { id: 'x', view: 'active', agents: [{ name: 'Juno', role: 'impl' }, { name: 'Tali', role: 'impl' }] },
    { id: 'y', view: 'active', agents: [{ name: 'Tali', role: 'impl' }, { name: 'Oren', role: 'review' }, { name: 'Ash', role: 'impl' }, { name: 'Bo', role: 'impl' }] },
  ]);
  assert.equal(c.get('Juno'), 'var(--role-impl)');
  assert.equal(c.get('Tali'), roleColor('impl', 1));
  assert.match(c.get('Tali')!, /^color-mix\(in oklch, var\(--role-impl\)/);
  assert.equal(c.get('Ash'), roleColor('impl', 2));
  assert.equal(c.get('Bo'), roleColor('impl', 2));
  assert.equal(c.get('Oren'), 'var(--role-review)');
  assert.equal(roleColor('someone'), 'var(--idle)');
});

test('edges: flow from done into active/review in the target colour, solid green between done steps', async () => {
  const m = overlayModel(await scene(FIXTURE_CODE), FIXTURE_STEPS);
  const by = new Map(m.edges.map((e) => [e.key, e]));
  assert.deepEqual([...by.keys()].sort(), [edgeKey('impl', 'review'), edgeKey('impl', 'test'), edgeKey('plan', 'impl')].sort());
  assert.equal(by.get(edgeKey('plan', 'impl'))!.kind, 'done');
  assert.equal(by.get(edgeKey('plan', 'impl'))!.color, 'var(--ok)');
  assert.equal(by.get(edgeKey('impl', 'review'))!.kind, 'flow');
  assert.equal(by.get(edgeKey('impl', 'review'))!.color, 'var(--role-review)');
  // Into a blocked step: drawn as is.
  const b = overlayModel(await scene(FIXTURE_CODE), FIXTURE_BLOCKED);
  assert.equal(b.edges.some((e) => e.key === edgeKey('impl', 'test')), false);
});

test('missing nodes are listed, not drawn; edges to non-step nodes ignored', async () => {
  const m = overlayModel(await scene('a\nb\nc\na > b\nb > c'), [
    { id: 'a', view: 'done' },
    { id: 'b', view: 'active' },
    { id: 'gone', view: 'active' },
  ]);
  assert.deepEqual(m.nodes.map((n) => n.node), ['a', 'b']);
  assert.deepEqual(m.missing, ['gone']);
  assert.deepEqual(m.edges.map((e) => e.key), [edgeKey('a', 'b')]);
});

test('step.node links to a differently named node', async () => {
  const m = overlayModel(await scene('x\ny\nx > y'), [{ id: 's1', node: 'x', view: 'done' }, { id: 's2', node: 'y', view: 'review' }]);
  assert.deepEqual(m.nodes.map((n) => [n.step, n.node]), [['s1', 'x'], ['s2', 'y']]);
  assert.equal(m.edges[0]!.kind, 'flow');
});

test('pathData', () => {
  assert.equal(pathData([{ x: 0, y: 0 }, { x: 10.04, y: 5 }, { x: 10, y: 20.55 }]), 'M0 0L10 5L10 20.6');
});
