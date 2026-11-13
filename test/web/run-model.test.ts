import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRunEvent,
  beforeBlocked,
  fmtDur,
  historyLines,
  nodeLabels,
  overlaySteps,
  pickRun,
  runListText,
  sessionRows,
  stepRows,
  stripModel,
  type LiveSession,
  type RunRecord,
  type RunSummary,
} from '../../web/src/run/runModel.ts';
import { FIXTURE_CODE } from '../../web/src/run/fixture.ts';

const MIN = 60e3;
const T0 = Date.UTC(2026, 10, 13, 5, 5);

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  v: 1,
  id: '0000000000001-abcdef',
  file: 'p.dpx.json',
  plan: {
    revision: 7,
    hash: 'sha256:x',
    snapshot: {
      v: 1,
      block: 'b',
      defaults: { role: 'impl' },
      steps: [
        { id: 'plan', node: 'plan', role: 'lead' },
        { id: 'impl', node: 'impl' },
        { id: 'review', node: 'review', role: 'review' },
        { id: 'test', node: 'test', role: 'test' },
        { id: 'merge', node: 'merge' },
      ],
    },
  },
  startedAt: T0,
  endedAt: null,
  state: 'running',
  steps: {
    plan: { state: 'done', startedAt: T0, endedAt: T0 + 12 * MIN, sessions: [{ sid: 's1', name: 'Mira', state: 'done', cost: 0.5 }] },
    impl: { state: 'working', startedAt: T0 + 12 * MIN, endedAt: null, sessions: [{ sid: 's2', name: 'Juno', state: 'working', cost: 1.2, tokens: { input: 1000, output: 500 } }] },
    review: { state: 'pending', startedAt: null, endedAt: null, sessions: [] },
    test: { state: 'blocked', startedAt: T0 + 13 * MIN, endedAt: null, sessions: [] },
    merge: { state: 'skipped', startedAt: null, endedAt: T0 + 14 * MIN, sessions: [] },
  },
  totals: { cost: 1.7, mtok: 0 },
  timeline: [
    [T0 + MIN, 'plan', 'working'],
    [T0 + 12 * MIN, 'impl', 'working'],
  ],
  ...over,
});

test('pickRun: the running run, else the newest', () => {
  const s = (id: string, state: RunSummary['state']): RunSummary => ({ id, state, startedAt: 0, endedAt: null, totals: { cost: 0, mtok: 0 } });
  assert.equal(pickRun([s('3', 'done'), s('2', 'running'), s('1', 'done')])?.id, '2');
  assert.equal(pickRun([s('3', 'stopped'), s('1', 'done')])?.id, '3');
  assert.equal(pickRun([]), null);
});

test('stepRows: views, times and agents from the record', () => {
  const now = T0 + 20 * MIN;
  const rows = stepRows(record(), new Map(), now, nodeLabels(FIXTURE_CODE));
  assert.deepEqual(
    rows.map((r) => [r.n, r.title, r.view, r.label, r.time]),
    [
      [1, 'Plan', 'review', '리뷰', '12분'],
      [2, 'Implement', 'active', '진행', '8분째'],
      [3, 'Review', 'pending', '대기', '기다려요'],
      [4, 'Test', 'blocked', '막힘', '막힘'],
      [5, 'Merge', 'pending', '건너뜀', '건너뜀'],
    ],
  );
  assert.deepEqual(rows[0]!.agents, [{ name: 'Mira', role: 'lead' }]);
  // The step's role comes from plan defaults when the step names none.
  assert.deepEqual(rows[1]!.agents, [{ name: 'Juno', role: 'impl' }]);
  assert.deepEqual(overlaySteps(rows)[1], { id: 'impl', node: 'impl', view: 'active', waiting: false, title: 'Implement', agents: [{ name: 'Juno', role: 'impl' }] });
});

test('stepRows: live Dispatch state wins while running; a done run closes its steps', () => {
  const live = new Map<string, LiveSession>([['s2', { id: 's2', name: 'Juno', role: 'impl', state: 'waiting' }]]);
  const rows = stepRows(record(), live, T0 + 20 * MIN);
  assert.equal(rows[1]!.view, 'active');
  assert.equal(rows[1]!.waiting, true);
  const done = stepRows(record({ state: 'done', endedAt: T0 + 30 * MIN }), live, T0 + 40 * MIN);
  assert.equal(done[0]!.view, 'done');
  assert.equal(done[1]!.view, 'done'); // live state is ignored once the run ended
  assert.equal(done[1]!.time, '18분');
  assert.equal(done[3]!.view, 'blocked');
});

test('applyRunEvent: session patches, step states and the run summary', () => {
  const r = record();
  assert.equal(applyRunEvent(r, { file: r.file, runId: 'other', step: 'impl', state: 'failed' }), r);
  let n = applyRunEvent(r, { file: r.file, runId: r.id, step: 'impl', session: { sid: 's2', cost: 2 }, state: 'waiting' });
  assert.equal(n.steps.impl!.sessions[0]!.cost, 2);
  assert.equal(n.steps.impl!.sessions[0]!.name, 'Juno');
  assert.equal(n.steps.impl!.state, 'waiting');
  assert.equal(r.steps.impl!.sessions[0]!.cost, 1.2); // not mutated
  n = applyRunEvent(n, { file: r.file, runId: r.id, step: 'review', session: { sid: 's3', name: 'Oren', state: 'working' } });
  assert.equal(n.steps.review!.sessions.length, 1);
  n = applyRunEvent(n, { file: r.file, runId: r.id, run: { id: r.id, startedAt: T0, endedAt: T0 + MIN, state: 'stopped', totals: { cost: 3, mtok: 1 } } });
  assert.equal(n.state, 'stopped');
  assert.equal(n.totals.cost, 3);
});

test('stripModel: the one-line summary and who needs a look', () => {
  const live = new Map<string, LiveSession>([['s2', { id: 's2', name: 'Juno', role: 'impl', state: 'waiting' }]]);
  const r = record();
  const now = T0 + 24 * MIN;
  const rows = stepRows(r, live, now);
  const sm = stripModel(r, rows, sessionRows(r, live, now), 0.68, now);
  assert.equal(sm.glyph, '●');
  assert.deepEqual(sm.parts, ['실행 중', '4단계 중 0 완료 · 45% · 남은 4 (막힘 1)', '24분째', '$1.70', '5시간 68%']);
  assert.deepEqual(sm.attention, [{ sid: 's2', text: 'Juno(구현자)가 답을 기다려요', since: null }]);
  const ended = record({ state: 'done', endedAt: T0 + 67 * MIN });
  const em = stripModel(ended, stepRows(ended), sessionRows(ended), 0.68, now);
  assert.deepEqual(em.parts, ['완료', '4단계 중 2 완료 · 62% · 남은 2 (막힘 1)', '1시간 7분', '$1.70']);
  assert.deepEqual(em.attention, []);
});

test('sessionRows: record metadata, live values while running', () => {
  const live = new Map<string, LiveSession>([['s2', { id: 's2', name: 'Juno', role: 'impl', modelLabel: 'sonnet', activity: { label: 'npm test 실행', since: T0 + 18 * MIN }, ctx: 38, ctxWindow: 100 }]]);
  const rows = sessionRows(record(), live, T0 + 20 * MIN);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { ...rows[1]! },
    { sid: 's2', step: 'impl', name: 'Juno', role: 'impl', roleName: '구현자', model: 'sonnet', state: 'working', branch: null, activity: 'npm test 실행 · 2분째', cost: 1.2, tokens: 1500, ctxPct: 38, pr: null, live: true },
  );
  assert.equal(rows[0]!.live, false);
});

test('historyLines and runListText', () => {
  const lines = historyLines(record({ state: 'done', endedAt: T0 + 30 * MIN }), nodeLabels(FIXTURE_CODE));
  assert.deepEqual(
    lines.map((l) => l.text),
    ['완료', '2 Implement · 진행', '1 Plan · 진행', '시작 · 계획 rev 7'],
  );
  assert.match(runListText({ id: 'x', startedAt: T0, endedAt: T0 + 67 * MIN, state: 'done', totals: { cost: 4.9, mtok: 9.8 } }), /^11월 13일 \d\d:05 · 완료 · 1시간 7분 · \$4\.90$/);
});

test('fmtDur and nodeLabels', () => {
  assert.equal(fmtDur(10e3), '1분');
  assert.equal(fmtDur(60 * MIN), '1시간');
  assert.deepEqual([...nodeLabels('a [label: "A b"]\nb\nc [color: red, label: "C"]\na > b').entries()], [['a', 'A b'], ['c', 'C']]);
});

test('beforeBlocked: a blocked step keeps the weight of its newest non-blocking state', () => {
  const tl: RunRecord['timeline'] = [
    [T0, 'impl', 'working'],
    [T0 + MIN, 'test', 'working'],
    [T0 + 2 * MIN, 'impl', 'done'],
    [T0 + 3 * MIN, 'impl', 'failed'],
    [T0 + 4 * MIN, 'impl', 'blocked'],
  ];
  assert.equal(beforeBlocked(tl, 'impl'), 'review');
  assert.equal(beforeBlocked(tl, 'test'), 'active');
  assert.equal(beforeBlocked(tl, 'merge'), undefined);
});

test('stepRows: a blocked step whose history fell off the capped timeline still counts as started', () => {
  const now = T0 + 24 * MIN;
  const started = { state: 'blocked' as const, startedAt: T0 + 13 * MIN, endedAt: null, sessions: [{ sid: 's4', name: 'Pell', state: 'failed' as const }] };
  const base = record({ steps: { ...record().steps, test: { state: 'working', startedAt: T0 + 13 * MIN, endedAt: null, sessions: [{ sid: 's4', name: 'Pell', state: 'working' }] } } });
  const p0 = stripModel(base, stepRows(base, new Map(), now), [], null, now).progress;
  // Only failed/blocked entries left for the step: no non-blocking state to carry.
  const r = record({ steps: { ...record().steps, test: started }, timeline: [[T0 + 20 * MIN, 'test', 'failed'], [T0 + 21 * MIN, 'test', 'blocked']] });
  const rows = stepRows(r, new Map(), now);
  assert.equal(rows[3]!.view, 'blocked');
  assert.equal(rows[3]!.before, 'active');
  assert.equal(stripModel(r, rows, [], null, now).progress.percent, p0.percent);
  // Never started: still nothing to carry.
  const fresh = record({ steps: { ...record().steps, test: { state: 'blocked', startedAt: null, endedAt: null, sessions: [] } }, timeline: [] });
  assert.equal(stepRows(fresh, new Map(), now)[3]!.before, undefined);
});

test('stripModel: blocking never makes the bar go backwards; skipped steps leave the count', () => {
  const now = T0 + 24 * MIN;
  const before = record({ steps: { ...record().steps, test: { state: 'working', startedAt: T0 + 13 * MIN, endedAt: null, sessions: [{ sid: 's4', name: 'Pell', state: 'working' }] } } });
  const p0 = stripModel(before, stepRows(before, new Map(), now), [], null, now).progress;
  const blocked = record({
    steps: { ...record().steps, test: { state: 'failed', startedAt: T0 + 13 * MIN, endedAt: null, sessions: [{ sid: 's4', name: 'Pell', state: 'failed' }] } },
    timeline: [...record().timeline, [T0 + 13 * MIN, 'test', 'working'], [T0 + 20 * MIN, 'test', 'failed']],
  });
  const rows = stepRows(blocked, new Map(), now);
  assert.equal(rows[3]!.view, 'blocked');
  assert.equal(rows[3]!.before, 'active');
  const p1 = stripModel(blocked, rows, [], null, now).progress;
  assert.equal(p1.percent, p0.percent);
  assert.deepEqual({ total: p1.total, done: p1.done, blocked: p1.blocked, remaining: p1.remaining }, { total: 4, done: 0, blocked: 1, remaining: 4 });
  assert.deepEqual(overlaySteps(rows)[3]!.before, 'active');
  assert.equal(overlaySteps(rows)[4]!.skipped, true);
});

// ---- E27: paused runs and steps carried from an earlier run ----

const fmt = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

test('pickRun: a paused run is shown before older ones', () => {
  const s = (id: string, state: RunSummary['state']): RunSummary => ({ id, state, startedAt: 0, endedAt: null, totals: { cost: 0, mtok: 0 } });
  assert.equal(pickRun([s('3', 'stopped'), s('2', 'paused'), s('1', 'done')])?.id, '2');
});

test('stepRows and stripModel: a limit pause says when it goes on and turns amber', () => {
  const at = T0 + 20 * MIN;
  const resetAt = T0 + 125 * MIN;
  const r = record({ state: 'paused', pause: { by: 'limit', at, resetAt } });
  const now = T0 + 40 * MIN;
  const rows = stepRows(r, new Map(), now);
  const impl = rows.find((x) => x.id === 'impl')!;
  assert.equal(impl.paused, 'limit');
  assert.equal(impl.label, '한도로 멈춤');
  assert.equal(impl.time, `한도로 멈춤 · ${fmt(resetAt)}에 이어요`);
  assert.equal(impl.glyph, '⏸');
  assert.equal(rows.find((x) => x.id === 'plan')!.paused, undefined);
  const sm = stripModel(r, rows, sessionRows(r, new Map(), now), 0.9, now);
  assert.equal(sm.tone, 'warn');
  assert.equal(sm.parts[0], `한도로 멈춤 · ${fmt(resetAt)}에 이어요`);
  assert.equal(sm.parts[2], '20분'); // the clock stopped at the pause
  assert.deepEqual(sm.attention, []);
  // Without a known reset time.
  const r2 = record({ state: 'paused', pause: { by: 'limit', at } });
  assert.equal(stepRows(r2, new Map(), now).find((x) => x.id === 'impl')!.time, '한도로 멈춤 · 한도가 풀리면 이어요');
});

test('stepRows and stripModel: 멈추기 pauses quietly, live sessions still count', () => {
  const at = T0 + 20 * MIN;
  const r = record({ state: 'paused', pause: { by: 'stop', at } });
  const live = new Map<string, LiveSession>([['s2', { id: 's2', name: 'Juno', role: 'impl', state: 'working' }]]);
  const rows = stepRows(r, live, T0 + 50 * MIN);
  const impl = rows.find((x) => x.id === 'impl')!;
  assert.deepEqual([impl.paused, impl.label, impl.time], ['stop', '멈춤', '8분']);
  const sm = stripModel(r, rows, sessionRows(r, live, T0 + 50 * MIN), null, T0 + 50 * MIN);
  assert.deepEqual([sm.tone, sm.glyph, sm.parts[0]], ['muted', '⏸', '멈춤']);
  assert.equal(historyLines(r)[0]!.text, '멈춤');
  assert.match(runListText({ id: r.id, startedAt: T0, endedAt: null, state: 'paused', totals: r.totals, pause: r.pause }), /· 멈춤 · 20분 ·/);
});

test('stepRows: steps carried over from a stopped run show as done', () => {
  const r = record({
    steps: {
      ...record().steps,
      plan: { state: 'done', startedAt: T0 - 60 * MIN, endedAt: T0 - 48 * MIN, sessions: [{ sid: 's0', name: 'Mira', state: 'working' }], carried: '0000000000000-aaaaaa' },
    },
  });
  const plan = stepRows(r, new Map(), T0 + 20 * MIN).find((x) => x.id === 'plan')!;
  assert.deepEqual([plan.view, plan.label, plan.time], ['done', '완료', '12분']);
});

test('applyRunEvent: the run summary carries the pause', () => {
  const r = record();
  const pause = { by: 'limit' as const, at: T0, resetAt: T0 + MIN };
  const n = applyRunEvent(r, { file: r.file, runId: r.id, run: { id: r.id, startedAt: T0, endedAt: null, state: 'paused', totals: r.totals, pause } });
  assert.equal(n.state, 'paused');
  assert.deepEqual(n.pause, pause);
});
