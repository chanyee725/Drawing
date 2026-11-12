import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { worktreeDirFor, toAgent, createAgentStore, activityLine } from '../server/agents/model.js';
import { createSseParser } from '../server/agents/sse.js';
import { resolveDispatchUrl } from '../server/agents/dispatch.js';
import { setup } from '../server/agents/index.js';

const PROJECT = '/tmp/fake-project';

// Fake Dispatch sessions; names are invented.
const fixture = () => [
  {
    id: 's1', name: 'Pip', role: 'impl', roleName: '구현자', model: 'm1', modelLabel: 'Model One',
    cwd: join(PROJECT, '.dispatch/wt/impl-2'), branch: 'dispatch/impl-2', worktree: true,
    status: 'running', state: 'working', activity: { label: 'Edit docs/a.drawio', since: 1000 },
    last: 'secret transcript line 1\nline 2', prompt: 'SYSTEM PROMPT', usage: { input: 1 }, cost: 1.5,
    providerSessionId: 'prov-xyz', updatedAt: 900,
  },
  {
    id: 's2', name: 'Quill', role: 'review', roleName: '리뷰어', model: 'm2',
    cwd: '', branch: 'dispatch/review-3', worktree: true, status: 'idle', state: 'done',
    activity: null, last: '  \n  Looks good,   ship it.  \nmore', updatedAt: 800,
  },
  {
    id: 's3', name: 'Lark', role: 'lead', roleName: '관리자', model: 'm3',
    cwd: PROJECT, branch: 'develop', worktree: false, status: 'idle', state: 'waiting', last: '', updatedAt: 700,
  },
  { id: 's4', name: 'Moss', role: 'impl', cwd: '/elsewhere/repo', branch: 'feat/x', status: 'done' },
];

const change = (dir, extra = {}) => ({
  fileId: 'f1', relPath: 'docs/a.drawio', source: { kind: 'worktree', label: 'Pip', dir },
  page: { id: 'p1', name: 'Page-1' }, kinds: ['text'], cellIds: ['c1', 'c2'],
  bbox: { x: 10, y: 20, w: 30, h: 40 }, summary: '1 text changed', at: 1234, ...extra,
});

test('session → worktree folder mapping', () => {
  const [pip, quill, lark, moss] = fixture();
  assert.equal(worktreeDirFor(pip, PROJECT), join(PROJECT, '.dispatch/wt/impl-2'));
  assert.equal(worktreeDirFor(quill, PROJECT), join(PROJECT, '.dispatch/wt/review-3'), 'branch fallback');
  assert.equal(worktreeDirFor(lark, PROJECT), PROJECT, 'main checkout session');
  assert.equal(worktreeDirFor(moss, PROJECT), null, 'cwd outside the project, non-dispatch branch');
  assert.equal(worktreeDirFor({ cwd: 'relative/x', branch: 'dispatch/a-1' }, PROJECT), join(PROJECT, '.dispatch/wt/a-1'));
  assert.equal(worktreeDirFor({ branch: 'dispatch/../../etc' }, PROJECT), null, 'no path escape via branch');
  assert.equal(worktreeDirFor({ branch: 'dispatch/..' }, PROJECT), null);
});

test('agent keeps only whitelisted fields and one activity line', () => {
  const [pip, quill] = fixture();
  const a = toAgent(pip, PROJECT);
  assert.deepEqual(Object.keys(a).sort(), ['activity', 'activityAt', 'branch', 'dir', 'id', 'model', 'name', 'role', 'roleName', 'state', 'status'].sort());
  assert.equal(a.activity, 'Edit docs/a.drawio');
  assert.equal(a.model, 'Model One');
  assert.doesNotMatch(JSON.stringify(a), /SYSTEM PROMPT|prov-xyz|secret transcript/);
  assert.equal(activityLine(quill), 'Looks good, ship it.');
  assert.equal(activityLine({ last: 'x'.repeat(500) }).length, 140);
});

test('changes are attributed to the agent owning the source folder', () => {
  let updates = 0;
  const store = createAgentStore(PROJECT, () => updates++);
  store.replaceAll(fixture());

  assert.equal(store.attribute(change(join(PROJECT, '.dispatch/wt/impl-2'))), 's1');
  assert.equal(store.attribute(change(join(PROJECT, '.dispatch/wt/review-3'), { at: 99 })), 's2');
  assert.equal(store.attribute(change(PROJECT)), 's3', 'main checkout → session working in the project root');
  assert.equal(store.attribute(change('/somewhere/else')), null);
  assert.equal(store.attribute({}), null);

  const pip = store.list().find((a) => a.id === 's1');
  assert.deepEqual(pip.lastChange, {
    fileId: 'f1', relPath: 'docs/a.drawio', source: 'Pip', page: { id: 'p1', name: 'Page-1' },
    kinds: ['text'], cellIds: ['c1', 'c2'], bbox: { x: 10, y: 20, w: 30, h: 40 }, summary: '1 text changed', at: 1234,
  });
  assert.equal(store.list().find((a) => a.id === 's4').lastChange, null);

  // Session refresh keeps the last change; removal drops it.
  store.upsert({ ...fixture()[0], status: 'idle' });
  assert.equal(store.list().find((a) => a.id === 's1').lastChange.at, 1234);
  store.remove('s1');
  assert.equal(store.list().some((a) => a.id === 's1'), false);
  assert.equal(store.attribute(change(join(PROJECT, '.dispatch/wt/impl-2'))), 's3', 'falls back to the root session');
  assert.ok(updates > 0);
});

test('two sessions sharing a folder: the live one wins, otherwise no attribution', () => {
  const store = createAgentStore(PROJECT);
  store.replaceAll([
    { id: 'a', name: 'A', cwd: PROJECT, status: 'done' },
    { id: 'b', name: 'B', cwd: PROJECT, status: 'running' },
  ]);
  assert.equal(store.attribute(change(PROJECT)), 'b');
  store.replaceAll([
    { id: 'a', name: 'A', cwd: PROJECT, status: 'idle' },
    { id: 'b', name: 'B', cwd: PROJECT, status: 'idle' },
  ]);
  assert.equal(store.attribute(change(PROJECT)), null);
});

test('SSE parser handles split chunks, comments and CRLF', () => {
  const got = [];
  const p = createSseParser((e, d) => got.push([e, d]));
  p.feed(': ping\n\nevent: sess');
  p.feed('ion\r\ndata: {"a":');
  p.feed('1}\r\n\r\ndata: x\ndata: y\n\n');
  assert.deepEqual(got, [['session', '{"a":1}'], ['message', 'x\ny']]);
});

test('dispatch URL from --dispatch or <project>/.dispatch/server.port', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'draw-proj-'));
  try {
    assert.equal(await resolveDispatchUrl(dir, null), null);
    await mkdir(join(dir, '.dispatch'));
    await writeFile(join(dir, '.dispatch/server.port'), '4318\n');
    assert.equal(await resolveDispatchUrl(dir, null), 'http://127.0.0.1:4318');
    assert.equal(await resolveDispatchUrl(dir, 'http://127.0.0.1:9/'), 'http://127.0.0.1:9');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('module: follows Dispatch with GET only, attributes watch changes, broadcasts agents', async () => {
  const requests = [];
  let push;
  const fetchImpl = async (url, opts) => {
    requests.push([opts?.method ?? 'GET', new URL(url).pathname]);
    if (url.endsWith('/api/state')) return new Response(JSON.stringify({ sessions: fixture(), prompt: 'x' }));
    const body = new ReadableStream({ start(c) { push = (s) => c.enqueue(new TextEncoder().encode(s)); } });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
  const listeners = new Set();
  const watch = { api: { onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)), listSources: () => [] } };
  const events = [];
  const ctx = { projectDir: PROJECT, dispatch: 'http://127.0.0.1:1', hub: { broadcast: (e, d) => events.push([e, d]) }, modules: { watch } };

  const mod = await setup(ctx, { fetchImpl });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    while (!push) await wait(5);
    push('event: message\ndata: {"id":"s1","entry":{"text":"transcript"}}\n\n');
    push('event: session\ndata: ' + JSON.stringify({ ...fixture()[1], status: 'running', activity: { label: 'Reading diff', since: 5 } }) + '\n\n');
    push('event: removed\ndata: {"id":"s4"}\n\n');
    await wait(20);
    for (const fn of listeners) fn(change(join(PROJECT, '.dispatch/wt/impl-2')));
    await wait(100);

    assert.ok(requests.every(([m]) => m === 'GET'), 'never anything but GET');
    assert.deepEqual(requests.map(([, p]) => p), ['/api/state', '/api/events']);

    const last = events.filter(([e]) => e === 'agents').at(-1)?.[1];
    assert.ok(last, 'agents event broadcast');
    assert.equal(last.dispatch.connected, true);
    const byId = Object.fromEntries(last.agents.map((a) => [a.id, a]));
    assert.equal(byId.s2.activity, 'Reading diff');
    assert.equal(byId.s4, undefined);
    assert.equal(byId.s1.lastChange.summary, '1 text changed');
    assert.doesNotMatch(JSON.stringify(events), /transcript|SYSTEM PROMPT/);

    const res = { writeHead() {}, end(b) { this.body = JSON.parse(b); } };
    mod.routes.find((r) => r.path === '/api/agents').handler({}, res);
    assert.equal(res.body.agents.length, 3);
  } finally {
    mod.close();
  }
  assert.equal(listeners.size, 0, 'unsubscribed from watch on close');
});
