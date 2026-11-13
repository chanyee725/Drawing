import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, lastStep, stepIndex, stepStates } from '../../web/src/dispatch/lib/steps.ts';

test('five stages in order', () => {
  assert.deepEqual(STEPS.map(s => s.id), ['plan', 'impl', 'review', 'test', 'merge']);
  assert.equal(stepIndex('review'), 2);
  assert.equal(stepIndex('done'), -1);
});

test('a blocked task reports the stage it got stuck in', () => {
  assert.equal(lastStep({ stage: 'impl' }), 'impl');
  assert.equal(lastStep({ stage: 'blocked', stages: [{ stage: 'plan', at: 1 }, { stage: 'review', at: 2 }, { stage: 'blocked', at: 3 }] }), 'review');
  assert.equal(lastStep({ stage: 'blocked' }), 'plan');
});

test('current stage, done before it, todo after it', () => {
  assert.deepEqual(stepStates({ stage: 'review' }), ['done', 'done', 'current', 'todo', 'todo']);
});

test('blocked marks its stage', () => {
  const t = { stage: 'blocked' as const, stages: [{ stage: 'plan' as const, at: 1 }, { stage: 'impl' as const, at: 2 }, { stage: 'blocked' as const, at: 3 }] };
  assert.deepEqual(stepStates(t), ['done', 'blocked', 'todo', 'todo', 'todo']);
});

test('stages jumped past are skipped, also once done', () => {
  const stages = [{ stage: 'plan' as const, at: 1 }, { stage: 'impl' as const, at: 2 }, { stage: 'merge' as const, at: 3 }];
  assert.deepEqual(stepStates({ stage: 'merge', stages }), ['done', 'done', 'skipped', 'skipped', 'current']);
  assert.deepEqual(stepStates({ stage: 'done', stages }), ['done', 'done', 'skipped', 'skipped', 'done']);
});
