import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaLine, groupByStage, span, stageSpans } from '../../web/src/dispatch/lib/board.ts';
import type { BoardTask } from '../../web/src/dispatch/types.ts';

const MIN = 60_000;
const mk = (id: string, stage: BoardTask['stage'], stageAt: number, extra: Partial<BoardTask> = {}): BoardTask =>
  ({ id, lead: 'l', title: id, stage, owner: null, createdAt: 0, stageAt, updatedAt: 0, etaAt: null, note: '', ...extra });

test('groupByStage fills every column and puts the longest-standing first', () => {
  const g = groupByStage([mk('b', 'impl', 20), mk('a', 'impl', 10), mk('c', 'blocked', 5)]);
  assert.deepEqual(g.impl.map(t => t.id), ['a', 'b']);
  assert.deepEqual(g.blocked.map(t => t.id), ['c']);
  assert.deepEqual(g.done, []);
  assert.deepEqual(Object.keys(g), ['plan', 'impl', 'review', 'test', 'merge', 'done', 'blocked']);
});

test('stageSpans sums revisited stages and runs the current one to now', () => {
  const t = mk('x', 'test', 30 * MIN, { stages: [{ stage: 'plan', at: 0 }, { stage: 'impl', at: 10 * MIN }, { stage: 'review', at: 20 * MIN }, { stage: 'impl', at: 25 * MIN }, { stage: 'test', at: 30 * MIN }] });
  assert.deepEqual(stageSpans(t, 42 * MIN), [
    { stage: 'plan', ms: 10 * MIN }, { stage: 'impl', ms: 15 * MIN }, { stage: 'review', ms: 5 * MIN }, { stage: 'test', ms: 12 * MIN },
  ]);
});

test('stageSpans seeds a task without history from its stage time', () => {
  assert.deepEqual(stageSpans(mk('x', 'review', 5 * MIN), 8 * MIN), [{ stage: 'review', ms: 3 * MIN }]);
});

test('span formats minutes, hours and days', () => {
  assert.equal(span(30_000), '방금');
  assert.equal(span(12 * MIN), '12분');
  assert.equal(span(72 * MIN), '1시간 12분');
  assert.equal(span(49 * 60 * MIN), '2일');
});

test('etaLine: minutes left, almost, late, none, done', () => {
  assert.deepEqual(etaLine({ stage: 'impl', etaAt: 100 * MIN }, 90 * MIN), { text: '10분 남음', late: false });
  assert.deepEqual(etaLine({ stage: 'impl', etaAt: 100 * MIN + 20_000 }, 100 * MIN), { text: '곧 끝나요', late: false });
  assert.deepEqual(etaLine({ stage: 'impl', etaAt: 100 * MIN }, 115 * MIN), { text: '15분 지났어요', late: true });
  assert.equal(etaLine({ stage: 'impl', etaAt: null }, 0), null);
  assert.equal(etaLine({ stage: 'done', etaAt: 5 }, 0), null);
});
