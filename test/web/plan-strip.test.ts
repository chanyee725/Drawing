import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanFile } from '../../shared/dispatch/plan-write.ts';
import { confirmSnapshot, isPlanChanged, limitLine, startBody, startError, unansweredAsks } from '../../web/src/run/planStripModel.ts';

const doc = (asks: string[]) => buildPlanFile({ goal: 'g', steps: [{ title: 't', role: 'r' }], asks }).document;

test('unansweredAsks counts the open questions write_plan wrote', () => {
  assert.equal(unansweredAsks(doc([])), 0);
  assert.equal(unansweredAsks(doc(['15분?', '쿠키 이름?'])), 2);
  assert.equal(unansweredAsks(doc(['15분? 답: 10분', '쿠키 이름? → drw'])), 0);
  assert.equal(unansweredAsks(null), 0);
  assert.equal(unansweredAsks({ type: 'doc', content: [] }), 0);
});

test('unansweredAsks treats a nested answer as answered', () => {
  const d = doc(['15분?', '쿠키 이름?']) as { content: { type: string; content?: { content: unknown[] }[] }[] };
  const list = d.content.find((n) => n.type === 'bulletList' && n.content?.length === 2)!;
  list.content![0].content.push({ type: 'paragraph', content: [{ type: 'text', text: '10분이요' }] });
  assert.equal(unansweredAsks(d), 1);
});

test('limitLine shows the higher known limit', () => {
  assert.equal(limitLine(null), null);
  assert.equal(limitLine({ five: null, seven: null, fiveReset: null, sevenReset: null }), null);
  assert.equal(limitLine({ five: 61.6, seven: 40, fiveReset: null, sevenReset: null }), 'Claude 5시간 한도 62% 사용 중');
  assert.equal(limitLine({ five: 10, seven: 80, fiveReset: null, sevenReset: null }), 'Claude 주간 한도 80% 사용 중');
});

test('startError prefers blockers, then a revision hint', () => {
  assert.equal(startError(409, { error: 'a', blockers: ['x', 'y'] }), 'x · y');
  assert.equal(startError(409, { error: '계획이 바뀌었어요. 다시 확인해 주세요', revision: 7 }), '계획이 바뀌었어요. 다시 확인해 주세요 (지금 rev 7)');
  assert.equal(startError(500, {}), '시작하지 못했어요 (HTTP 500)');
});

test('the start request carries the revision the confirm dialog showed, not a later one', () => {
  const shown = confirmSnapshot({ revision: 4, sessions: 3, changes: ['a'], limits: null });
  // The lead rewrites the plan while the dialog is open: the live status moves on, the snapshot does not.
  const live = { revision: 5, sessions: 4, changes: [], limits: null };
  assert.equal(shown.revision, 4);
  assert.notEqual(shown.revision, live.revision);
  assert.deepEqual(startBody('pipelines/a.dpx.json', shown), { path: 'pipelines/a.dpx.json', revision: 4 });
});

test('a 409 from start asks the person to confirm the new plan again', () => {
  const msg = startError(409, { error: '계획이 바뀌었어요. 다시 확인해 주세요', revision: 5 });
  assert.match(msg, /다시 확인/);
  assert.equal(isPlanChanged(409, { revision: 5 }), true);
  assert.equal(isPlanChanged(409, { blockers: ['x'] }), false);
  assert.equal(isPlanChanged(500, {}), false);
});
