import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanFile, planChanges, writePlanProblem, PLAN_BLOCK_ID, MAX_PLAN_LIST } from '../../shared/dispatch/plan-write.ts';
import { planProblem, MAX_PLAN_N, type Plan } from '../../shared/dispatch/plan.ts';
import { parse } from '../../shared/dsl/index.ts';

const STEPS = [
  { id: 'api', title: '서버 API', role: 'impl', model: 'm1', done: 'npm test 통과', files: ['server/a.js'] },
  { id: 'ui', title: '로그인 "화면"', role: 'impl', after: ['api'], task: '자세한 할 일' },
];

test('writePlanProblem accepts a usable input and default ids', () => {
  assert.equal(writePlanProblem({ goal: 'g', steps: STEPS }), null);
  assert.equal(writePlanProblem({ goal: 'g', steps: [{ title: 'a', role: 'r' }, { title: 'b', role: 'r', after: ['s1'] }] }), null);
});

test('writePlanProblem names what is wrong', () => {
  const cases: [unknown, RegExp][] = [
    [null, /객체/],
    [{ goal: ' ', steps: STEPS }, /goal/],
    [{ goal: 'g', steps: [] }, /steps/],
    [{ goal: 'g', steps: STEPS, risks: 'x' }, /risks/],
    [{ goal: 'g', steps: STEPS, asks: Array(MAX_PLAN_LIST + 1).fill('q') }, /asks/],
    [{ goal: 'g', steps: [1] }, /steps\[0\]/],
    [{ goal: 'g', steps: [{ id: 'a b', title: 't', role: 'r' }] }, /id/],
    [{ goal: 'g', steps: [{ id: 'a', title: 't', role: 'r' }, { id: 'a', title: 't', role: 'r' }] }, /두 번/],
    [{ goal: 'g', steps: [{ title: '', role: 'r' }] }, /title/],
    [{ goal: 'g', steps: [{ title: 't', role: '' }] }, /role/],
    [{ goal: 'g', steps: [{ title: 't', role: 'r', model: ' ' }] }, /model/],
    [{ goal: 'g', steps: [{ title: 't', role: 'r', perm: 'bypassPermissions' }] }, /perm/],
    [{ goal: 'g', steps: [{ title: 't', role: 'r', n: MAX_PLAN_N + 1 }] }, /\.n/],
    [{ goal: 'g', steps: [{ title: 't', role: 'r', after: 'x' }] }, /after/],
    [{ goal: 'g', steps: [{ title: 't', role: 'r', files: [1] }] }, /files/],
    [{ goal: 'g', steps: [{ title: 't', role: 'r', task: 'x'.repeat(4001) }] }, /4000/],
    [{ goal: 'g', steps: [{ title: 't', role: 'r', after: ['nope'] }] }, /없는 단계/],
  ];
  for (const [input, re] of cases) assert.match(writePlanProblem(input) ?? '', re, JSON.stringify(input)?.slice(0, 80));
});

test('buildPlanFile makes a valid plan, a parseable flowchart and the document sections', () => {
  const out = buildPlanFile({ title: '로그인 개편', goal: '매직 링크', steps: STEPS, risks: ['쿠키'], asks: ['15분?'] });
  assert.equal(out.title, '로그인 개편');
  assert.equal(out.block.id, PLAN_BLOCK_ID);
  assert.equal(out.plan.block, PLAN_BLOCK_ID);
  assert.equal(planProblem(out.plan), null);
  assert.deepEqual(out.plan.steps.map((s) => [s.id, s.node, s.after]), [['api', 'api', []], ['ui', 'ui', ['api']]]);
  assert.equal(out.plan.steps[0].model, 'm1');
  assert.match(out.plan.steps[0].task ?? '', /끝: npm test 통과\n파일: server\/a\.js/);
  assert.match(out.plan.steps[1].task ?? '', /자세한 할 일/);
  // A quote in a title must not end the DSL string early.
  assert.match(out.block.code, /ui \[label: "로그인 '화면'"\]/);
  assert.match(out.block.code, /api > ui/);
  const { ast, errors } = parse(out.block.code, 'flowchart') as { ast: unknown; errors?: unknown[] };
  assert.ok(ast);
  assert.equal(errors?.length ?? 0, 0);
  const headings = out.document.content.filter((n) => n.type === 'heading').map((n) => (n.content?.[0] as { text?: string })?.text);
  assert.deepEqual(headings, ['목표', '단계', '위험', '사용자에게 물어볼 것']);
  assert.ok(out.document.content.some((n) => n.type === 'diagram' && n.attrs?.blockId === PLAN_BLOCK_ID));
});

test('buildPlanFile falls back to the goal for a title and keeps a placed block', () => {
  const prev = { id: 'b9', type: 'flowchart', code: 'old', x: 10, y: 20, w: 300, h: 200, frameId: 'f1' };
  const out = buildPlanFile({ goal: '  짧은   목표 ', steps: [{ title: 'a', role: 'r' }] }, prev);
  assert.equal(out.title, '짧은 목표');
  assert.deepEqual([out.block.id, out.block.x, out.block.y, out.block.w, out.block.frameId], ['b9', 10, 20, 300, 'f1']);
  assert.equal(out.plan.block, 'b9');
  assert.equal(out.plan.steps[0].id, 's1');
  const empty = out.document.content.filter((n) => n.type === 'paragraph').map((n) => (n.content?.[0] as { text?: string })?.text);
  assert.ok(empty.filter((t) => t === '없어요.').length === 2);
});

test('planChanges lists what changed by step id', () => {
  const before = buildPlanFile({ goal: 'g', steps: STEPS }).plan;
  assert.deepEqual(planChanges(before, before), []);
  assert.deepEqual(planChanges(null, before), []);
  assert.deepEqual(planChanges(before, null), ['계획이 지워졌어요']);
  assert.deepEqual(planChanges(null, null), []);
  const after: Plan = structuredClone(before);
  after.steps[0].model = 'm2';
  after.steps[1].after = [];
  after.steps[1].task = 'other';
  after.steps.push({ id: 'doc', node: 'doc', role: 'docs' });
  const lines = planChanges(before, after);
  assert.deepEqual(lines, ['단계 api 모델 m1 → m2', '단계 ui 순서 바뀜', '단계 ui 할 일 바뀜', '단계 doc 추가']);
  const removed: Plan = { ...before, block: 'other', steps: [before.steps[0]], defaults: { perm: 'plan' } };
  assert.deepEqual(planChanges(before, removed), ['단계 ui 지움', '다이어그램 블록 바뀜', '기본값 바뀜']);
});

test('planChanges caps the list', () => {
  const before: Plan = { v: 1, block: 'b', steps: [] };
  const after: Plan = { v: 1, block: 'b', steps: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, node: `s${i}`, role: 'r' })) };
  assert.deepEqual(planChanges(before, after, 3), ['단계 s0 추가', '단계 s1 추가', '단계 s2 추가', '그 밖에 2개']);
});
