import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelinePath, pipelineTemplate, PIPELINE_STEPS } from '../../web/src/pipelineTemplate.ts';
import { planProblem } from '../../shared/dispatch/plan.ts';
import { planOrderIn } from '../../shared/dispatch/plan-diagram.ts';

test('pipelinePath puts a bare name under pipelines/ and keeps a given folder', () => {
  assert.equal(pipelinePath('release'), 'pipelines/release');
  assert.equal(pipelinePath(' release.dpx '), 'pipelines/release');
  assert.equal(pipelinePath('ops/release'), 'ops/release');
  assert.equal(pipelinePath('/release/'), 'pipelines/release');
  assert.equal(pipelinePath('  '), '');
});

test('pipelineTemplate: document sections, one flowchart block, a plan that runs in edge order', () => {
  const t = pipelineTemplate('b_test');
  assert.equal(planProblem(t.plan), null);
  assert.equal(t.blocks.length, 1);
  assert.equal(t.blocks[0]!.type, 'flowchart');
  assert.equal(t.plan!.block, 'b_test');
  const content = (t.document as { content: { type: string; attrs?: Record<string, unknown>; content?: { text: string }[] }[] }).content;
  assert.deepEqual(content.filter((n) => n.type === 'heading').map((n) => n.content![0]!.text), ['목표', '단계', '위험']);
  assert.ok(content.some((n) => n.type === 'diagram' && n.attrs?.blockId === 'b_test'));
  const order = planOrderIn(t.plan!, t.blocks);
  assert.equal(order.ok, true, JSON.stringify(order));
  assert.deepEqual(order.ok && order.order, [...PIPELINE_STEPS]);
});
