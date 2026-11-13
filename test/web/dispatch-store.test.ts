import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { apply, connect, forgetTranscript, getState, resetState, setState } from '../../web/src/dispatch/store.ts';
import type { Entry, Session } from '../../shared/dispatch/types.ts';

const sess = (id: string, extra: Partial<Session> = {}) => ({ id, name: id, status: 'running', pending: [], ...extra }) as unknown as Session;
const entry = (text: string): Entry => ({ kind: 'assistant', text, at: 1 });

beforeEach(() => resetState());

test('snapshot fills the state and marks it ready and online', () => {
  apply('snapshot', { sessions: [sess('a')], tasks: [], roles: [] });
  const s = getState();
  assert.equal(s.ready, true);
  assert.equal(s.online, true);
  assert.deepEqual(s.sessions.map(x => x.id), ['a']);
});

test('session updates in place or adds to the front', () => {
  apply('session', sess('a'));
  apply('session', sess('b'));
  apply('session', sess('a', { name: 'renamed' }));
  assert.deepEqual(getState().sessions.map(x => [x.id, x.name]), [['b', 'b'], ['a', 'renamed']]);
});

test('removed drops the session and its transcript, and a late update does not bring it back', () => {
  apply('session', sess('a'));
  setState({ transcripts: { a: [entry('hi')] } });
  apply('removed', { id: 'a' });
  assert.equal(getState().sessions.length, 0);
  assert.equal('a' in getState().transcripts, false);
  apply('session', sess('a'));
  assert.equal(getState().sessions.length, 0);
});

test('message appends only to a transcript already loaded', () => {
  apply('message', { id: 'a', entry: entry('x') });
  assert.equal('a' in getState().transcripts, false);
  setState({ transcripts: { a: [] } });
  apply('message', { id: 'a', entry: entry('x') });
  assert.deepEqual(getState().transcripts.a?.map(e => e.text), ['x']);
});

test('list and settings events replace their slice; unknown events are ignored', () => {
  const before = getState();
  apply('prefs', { theme: 'dark' });
  assert.equal(getState(), before);
  apply('tasks', [{ id: 't1' }]);
  apply('limits', { five: 0.5 });
  assert.deepEqual(getState().tasks, [{ id: 't1' }]);
  assert.deepEqual(getState().limits, { five: 0.5 });
});

test('forgetTranscript drops one transcript from memory', () => {
  setState({ transcripts: { a: [entry('x')], b: [] } });
  forgetTranscript('a');
  assert.deepEqual(Object.keys(getState().transcripts), ['b']);
});

test('connecting again applies the current /api/state even after the first visit', async () => {
  const real = globalThis.fetch;
  let snap: unknown = { sessions: [sess('old')] };
  globalThis.fetch = (async () => new Response(JSON.stringify(snap), { status: 200 })) as typeof fetch;
  try {
    const settle = () => new Promise(r => setTimeout(r, 0));
    const close = connect();
    await settle();
    assert.deepEqual(getState().sessions.map(x => x.id), ['old']);
    close();
    // The shared stream stays open elsewhere, so no new stream snapshot comes; the fetch must refresh the state.
    snap = { sessions: [sess('new')] };
    const close2 = connect();
    await settle();
    assert.deepEqual(getState().sessions.map(x => x.id), ['new']);
    close2();
  } finally {
    globalThis.fetch = real;
  }
});
