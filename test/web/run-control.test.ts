import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionError, actionsFor, requestAction } from '../../web/src/run/runControl.ts';

test('actionsFor: 멈추기 while running, 이어서 하기 and 계획 다시 열기 while paused', () => {
  assert.deepEqual(actionsFor('running'), ['stop']);
  assert.deepEqual(actionsFor('paused'), ['resume', 'reopen']);
  for (const s of ['done', 'failed', 'stopped', undefined] as const) assert.deepEqual(actionsFor(s), []);
});

test('actionError: the first blocker (the limit reset time), else the message', () => {
  assert.equal(actionError('resume', 409, { error: 'x', blockers: ['한도에 걸려 있어요 (5시간). 15시 10분에 초기화돼요'] }), '한도에 걸려 있어요 (5시간). 15시 10분에 초기화돼요');
  assert.equal(actionError('stop', 409, { error: '이미 멈췄어요' }), '이미 멈췄어요');
  assert.equal(actionError('reopen', 500, {}), '계획 다시 열기를 하지 못했어요 (HTTP 500)');
});

test('requestAction: POSTs the path with the x-drawing header', async () => {
  const calls: [string, RequestInit][] = [];
  const ok = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await requestAction('stop', 'a/p.dpx.json', ok), null);
  assert.equal(calls[0]![0], '/api/pipeline/stop');
  assert.equal(calls[0]![1].method, 'POST');
  assert.equal((calls[0]![1].headers as Record<string, string>)['x-drawing'], '1');
  assert.deepEqual(JSON.parse(String(calls[0]![1].body)), { path: 'a/p.dpx.json' });

  const limited = (async () => new Response(JSON.stringify({ error: 'e', blockers: ['한도에 걸려 있어요'] }), { status: 409 })) as unknown as typeof fetch;
  assert.equal(await requestAction('resume', 'p', limited), '한도에 걸려 있어요');
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  assert.equal(await requestAction('resume', 'p', down), '이어서 하기를 하지 못했어요. 서버에 닿지 않아요');
});
