import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentsByOtherPage,
  agentsOnPage,
  cursorOpacity,
  cursorPoint,
  IDLE_DIM_MS,
  IDLE_HIDE_MS,
  normalizeAgents,
  roleColor,
  springSettled,
  springStep,
  statusInfo,
  timeAgo,
} from '../web/src/agents/model.ts';

const NOW = 1_000_000;
const change = (extra = {}) => ({
  fileId: 'f1',
  relPath: 'docs/a.drawio',
  source: 'impl-1',
  page: { id: 'p1', name: 'Page 1' },
  kinds: ['text'],
  cellIds: ['c1'],
  bbox: { x: 10, y: 20, w: 30, h: 40 },
  summary: '1개 글자 바뀜',
  at: NOW - 1000,
  ...extra,
});
const agent = (id, extra = {}) => ({
  id,
  name: id,
  role: 'impl',
  roleName: '구현자',
  status: 'running',
  activity: '',
  activityAt: null,
  lastChange: change(),
  ...extra,
});

test('normalizeAgents keeps known fields only and tolerates junk', () => {
  const snap = normalizeAgents({
    dispatch: { url: 'http://127.0.0.1:1', connected: true },
    agents: [
      { id: 's1', name: 'a', role: 'impl', roleName: '구현자', status: 'running', activity: 'x', activityAt: 5, model: 'm', branch: 'b', lastChange: change() },
      { id: 2, name: 'b', role: 'review', lastChange: { page: { id: 'p2' }, at: '2026-01-01T00:00:00Z', bbox: { x: 1 } } },
      null,
      { name: 'no id' },
    ],
  });
  assert.deepEqual(snap.dispatch, { found: true, connected: true });
  assert.equal(snap.agents.length, 2);
  assert.deepEqual(snap.agents[0].lastChange.bbox, { x: 10, y: 20, width: 30, height: 40 });
  assert.deepEqual(Object.keys(snap.agents[0]).sort(), ['activity', 'activityAt', 'id', 'lastChange', 'name', 'role', 'roleName', 'status']);
  assert.equal(snap.agents[1].id, '2');
  assert.equal(snap.agents[1].roleName, 'review');
  assert.deepEqual(snap.agents[1].lastChange.page, { id: 'p2', name: 'p2' });
  assert.equal(snap.agents[1].lastChange.at, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(snap.agents[1].lastChange.bbox, null);
  assert.deepEqual(normalizeAgents(null), { dispatch: { found: false, connected: false }, agents: [] });
});

test('roleColor maps role keys and Korean names, and is stable for unknown roles', () => {
  assert.equal(roleColor('impl'), roleColor('', '구현자'));
  assert.notEqual(roleColor('impl'), roleColor('review'));
  assert.equal(roleColor('wizard'), roleColor('wizard'));
  assert.match(roleColor('wizard'), /^#[0-9a-f]{6}$/);
});

test('statusInfo and timeAgo speak plain Korean', () => {
  assert.deepEqual(statusInfo('running'), { label: '일하는 중', tone: 'live' });
  assert.equal(statusInfo('waiting').tone, 'wait');
  assert.equal(statusInfo('done').tone, 'off');
  assert.equal(timeAgo(null, NOW), '');
  assert.equal(timeAgo(NOW - 2000, NOW), '방금');
  assert.equal(timeAgo(NOW - 12_000, NOW), '12초 전');
  assert.equal(timeAgo(NOW - 3 * 60_000, NOW), '3분 전');
  assert.equal(timeAgo(NOW - 2 * 3600_000, NOW), '2시간 전');
  assert.equal(timeAgo(NOW + 5000, NOW), '방금');
});

test('cursorOpacity: active, dimmed when idle or stopped, hidden when long idle', () => {
  assert.equal(cursorOpacity(agent('a'), NOW), 1);
  assert.equal(cursorOpacity(agent('a', { lastChange: change({ at: NOW - IDLE_DIM_MS }) }), NOW), 0.35);
  assert.equal(cursorOpacity(agent('a', { status: 'done' }), NOW), 0.35);
  assert.equal(cursorOpacity(agent('a', { lastChange: change({ at: NOW - IDLE_HIDE_MS }) }), NOW), 0);
  assert.equal(cursorOpacity(agent('a', { lastChange: null }), NOW), 0);
});

test('agentsOnPage matches path and page across sources; others become tab chips', () => {
  const list = [
    agent('here'),
    agent('wt', { lastChange: change({ fileId: 'f2', source: 'review-1' }) }),
    agent('other-page', { lastChange: change({ page: { id: 'p2', name: 'Page 2' } }) }),
    agent('other-file', { lastChange: change({ relPath: 'docs/b.drawio' }) }),
    agent('gone', { lastChange: change({ at: NOW - IDLE_HIDE_MS - 1 }) }),
    agent('idle-p2', { lastChange: change({ page: { id: 'p2', name: 'Page 2' }, at: NOW - IDLE_DIM_MS - 1 }) }),
  ];
  assert.deepEqual(agentsOnPage(list, 'docs/a.drawio', 'p1', NOW).map((a) => a.id), ['here', 'wt']);
  assert.deepEqual(agentsOnPage(list, null, 'p1', NOW), []);
  const chips = agentsByOtherPage(list, 'docs/a.drawio', 'p1', NOW);
  assert.deepEqual([...chips.keys()], ['p2']);
  assert.deepEqual(chips.get('p2').map((a) => a.id), ['other-page']);
});

test('cursorPoint is the centre of the changed rect', () => {
  assert.deepEqual(cursorPoint({ x: 10, y: 20, width: 30, height: 40 }), { x: 25, y: 40 });
});

test('springStep glides to the target without overshoot, retargets without jumps', () => {
  let s = { x: 0, v: 0 };
  let prev = s.x;
  let maxStep = 0;
  for (let i = 0; i < 60; i++) {
    s = springStep(s, 100, 1 / 60, 9);
    assert.ok(s.x >= prev - 1e-9 && s.x <= 100 + 1e-9, 'monotone, no overshoot');
    maxStep = Math.max(maxStep, s.x - prev);
    prev = s.x;
  }
  assert.ok(s.x > 99, `arrives within a second (x=${s.x})`);
  assert.ok(maxStep < 20, 'no single-frame jump');
  // A new target mid-flight keeps position continuous.
  let t = { x: 0, v: 0 };
  for (let i = 0; i < 10; i++) t = springStep(t, 100, 1 / 60, 9);
  const before = t.x;
  t = springStep(t, -50, 1 / 60, 9);
  assert.ok(Math.abs(t.x - before) < 10, 'position continuous after retarget');
  // Large dt (tab was in the background) stays stable.
  const big = springStep({ x: 0, v: 0 }, 100, 5, 9);
  assert.ok(Math.abs(big.x - 100) < 1e-6);
  assert.ok(springSettled({ x: 100.01, v: 0.01 }, 100));
  assert.ok(!springSettled({ x: 90, v: 0 }, 100));
});
