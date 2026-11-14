import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate, alwaysOnOrder, burnNow, cacheRate, hashOf, outliers, rowHistory, topSessions, totals, viewOf, weekHint,
} from '../../web/src/dispatch/lib/usage.ts';
import type { SessionState, UsageDay } from '../../shared/dispatch/types.ts';

const u = (input: number, output: number, cacheRead: number, cacheWrite: number, cost: number) => ({ input, output, cacheRead, cacheWrite, cost });
const day = (d: string, cost: number, extra: Partial<UsageDay> = {}): UsageDay => ({ day: d, cost, models: {}, roles: {}, ...extra });

test('aggregate sums tokens and cost per model and cost per role', () => {
  const days = [
    day('2026-11-13', 3, { models: { m1: u(10, 5, 100, 1, 2), m2: u(1, 1, 0, 0, 1) }, roles: { impl: 2, lead: 1 } }),
    day('2026-11-14', 4, { models: { m1: u(20, 5, 50, 2, 4) }, roles: { impl: 4 } }),
  ];
  const { byModel, byRole } = aggregate(days);
  assert.deepEqual(byModel.m1, u(30, 10, 150, 3, 6));
  assert.deepEqual(byModel.m2, u(1, 1, 0, 0, 1));
  assert.deepEqual(byRole, { impl: 6, lead: 1 });
  assert.equal(cacheRate(byModel), 150 / (31 + 150 + 3));
  assert.equal(cacheRate({}), null);
});

test('totals split the 14 days into today, last 7 and the 7 before', () => {
  const days = Array.from({ length: 14 }, (_, i) => day(`d${i}`, i < 7 ? 1 : 2));
  assert.deepEqual(totals(days), { today: 2, week: 14, prev: 7, all: 21 });
  assert.deepEqual(totals([]), { today: 0, week: 0, prev: 0, all: 0 });
  const usd = (n: number) => `$${n}`;
  assert.equal(weekHint(14, 7, usd), '그 전 7일보다 +100%');
  assert.equal(weekHint(7, 14, usd), '그 전 7일보다 -50%');
  assert.equal(weekHint(14, 0, usd), '하루 평균 $2');
});

test('outliers flag days at twice the median of spending days, needing three of them', () => {
  assert.deepEqual(outliers([0, 1, 1, 0, 5]), { median: 1, ratio: [null, null, null, null, 5] });
  assert.deepEqual(outliers([0, 0, 1, 9]).ratio, [null, null, null, null]);
  assert.equal(outliers([1, 2, 3, 4]).median, 2.5);
});

test('burn rate and top sessions skip sessions without numbers', () => {
  const ss = [
    { id: 'a', cost: 1, burn: { perHour: 2, windowMin: 30 } },
    { id: 'b', cost: null, burn: null },
    { id: 'c', cost: 5, burn: { perHour: null, windowMin: 30 } },
    { id: 'd', cost: 3, burn: { perHour: 0.5, windowMin: 30 } },
  ];
  assert.deepEqual(burnNow(ss), { perHour: 2.5, rated: 2 });
  assert.deepEqual(topSessions(ss).map(s => s.id), ['c', 'd', 'a']);
  assert.deepEqual(topSessions(ss, 1).map(s => s.id), ['c']);
});

test('always-on order: needs-a-person first, then start time and id, stable across ticks', () => {
  type S = { id: string; startedAt: number; st: SessionState };
  const list: S[] = [
    { id: 'w2', startedAt: 2, st: 'working' }, { id: 'd', startedAt: 0, st: 'done' }, { id: 'w1', startedAt: 1, st: 'working' },
    { id: 'q', startedAt: 9, st: 'waiting' }, { id: 'f', startedAt: 9, st: 'failed' }, { id: 's', startedAt: 9, st: 'stuck' },
  ];
  assert.deepEqual(alwaysOnOrder(list, s => s.st).map(s => s.id), ['f', 's', 'q', 'w1', 'w2', 'd']);
  assert.deepEqual(list[0].id, 'w2', 'input left alone');
});

test('view follows the hash; unknown hashes fall back to the board', () => {
  assert.equal(viewOf('#usage'), 'usage');
  assert.equal(viewOf('#timeline'), 'timeline');
  assert.equal(viewOf('#tv'), 'tv');
  assert.equal(viewOf(''), 'sessions');
  assert.equal(viewOf('#nope'), 'sessions');
  assert.equal(hashOf('sessions'), '');
  assert.equal(hashOf('tv'), '#tv');
});

test('a timeline row adds the live state after the server history', () => {
  const server: [number, string][] = [[100, 'working']];
  assert.deepEqual(rowHistory({ status: 'waiting', state: 'waiting', stateSince: 200 }, server, 300), [[100, 'working'], [200, 'waiting']]);
  assert.deepEqual(server, [[100, 'working']], 'server entries not mutated');
  assert.deepEqual(rowHistory({ status: 'running', state: 'working', stateSince: 150 }, server, 300), [[100, 'working']]);
  assert.deepEqual(rowHistory({ status: 'idle' }, undefined, 300), [[300, 'resting']]);
});
