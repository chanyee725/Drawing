// E56 live agent cursor, server side: diff model and the cursor module's attribution and events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { changedCentre, mentionsFile, shapesOf } from '../server/cursor/model.js';
import { setup } from '../server/cursor/index.js';
import { Hub } from '../server/dispatch/hub.js';

const file = (elements = [], blocks = []) => ({ canvas: { elements }, blocks });
const rect = (id, x, y, w = 100, h = 50, extra = {}) => ({ id, type: 'rectangle', x, y, width: w, height: h, ...extra });
const block = (id, x, y, code = 'a > b') => ({ id, type: 'flow', code, x, y, w: 200, h: 100 });

test('mentionsFile: edit tools and curl URLs count, read tools and lookalike names do not', () => {
  const rel = 'plans/a.dpx.json';
  assert.equal(mentionsFile({ kind: 'tool', name: 'Edit', text: '{"file_path":"/w/plans/a.dpx.json","old_string":"x"}' }, rel), true);
  assert.equal(mentionsFile({ kind: 'tool', name: 'Bash', text: `curl -X PUT 'http://127.0.0.1:1/api/file?path=${encodeURIComponent(rel)}'` }, rel), true);
  assert.equal(mentionsFile({ kind: 'tool', name: 'Read', text: '{"file_path":"/w/plans/a.dpx.json"}' }, rel), false);
  assert.equal(mentionsFile({ kind: 'tool', name: 'Edit', text: '{"file_path":"/w/plans/xa.dpx.json"}' }, 'a.dpx.json'), false);
  assert.equal(mentionsFile({ kind: 'assistant', text: 'plans/a.dpx.json' }, rel), false);
});

test('changedCentre: centre of added, changed and removed shapes; null when nothing moved', () => {
  const a = shapesOf(file([rect('r1', 0, 0), rect('r2', 500, 500)], [block('b1', 1000, 0)]));
  assert.equal(changedCentre(a, a), null);
  // r1 moved to 100,100 (100x50): centre 150,125.
  const b = shapesOf(file([rect('r1', 100, 100), rect('r2', 500, 500)], [block('b1', 1000, 0)]));
  assert.deepEqual(changedCentre(a, b), { x: 150, y: 125 });
  // A block's code changed: its own box.
  const c = shapesOf(file([rect('r1', 0, 0), rect('r2', 500, 500)], [block('b1', 1000, 0, 'a > c')]));
  assert.deepEqual(changedCentre(a, c), { x: 1100, y: 50 });
  // r2 removed (deleted flag): its old box.
  const d = shapesOf(file([rect('r1', 0, 0), rect('r2', 500, 500, 100, 50, { isDeleted: true })], [block('b1', 1000, 0)]));
  assert.deepEqual(changedCentre(a, d), { x: 550, y: 525 });
  // Negative width (arrows drawn leftwards) is normalised.
  assert.deepEqual([...shapesOf(file([rect('n', 100, 0, -40, 10)])).values()][0].box, { x: 60, y: 0, w: 40, h: 10 });
});

function rig() {
  const files = new Map();
  const listeners = new Set();
  const sent = [];
  const hub = Object.assign(new EventEmitter(), { sessions: {}, get(id) { return this.sessions[id]; } });
  const ctx = {
    hub: { broadcast: (event, data) => sent.push({ event, data }) },
    modules: {
      workspace: {
        store: { readFile: async (rel) => { if (!files.has(rel)) throw new Error('nope'); return files.get(rel); } },
        onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      },
      dispatch: { hub },
    },
  };
  const change = async (rel, f) => {
    files.set(rel, f);
    for (const fn of listeners) fn(rel);
    await new Promise((r) => setTimeout(r, 5));
  };
  return { files, hub, ctx, sent, listeners, change, tick: () => new Promise((r) => setTimeout(r, 5)) };
}

test('cursor module: an agent edit is broadcast at the changed shape; a human-only change is not', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.files.set('a.dpx.json', file([rect('r1', 0, 0)]));
  // A change nobody mentioned: no cursor.
  await r.change('a.dpx.json', file([rect('r1', 10, 0)]));
  assert.equal(r.sent.length, 0);
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/x/wt/a.dpx.json"}' } });
  await r.tick();
  await r.change('a.dpx.json', file([rect('r1', 10, 0), rect('r2', 300, 300)]));
  assert.deepEqual(r.sent.map((s) => s.event), ['cursor']);
  const { at, ...rest } = r.sent[0].data;
  assert.equal(typeof at, 'number');
  assert.deepEqual(rest, { sid: 's1', name: 'Remy', role: 'impl', file: 'a.dpx.json', x: 350, y: 325 });
  // A change with no shape moved keeps the cursor alive without a place.
  await r.change('a.dpx.json', { ...file([rect('r1', 10, 0), rect('r2', 300, 300)]), title: 't' });
  assert.equal('x' in r.sent[1].data, false);
  // The session is removed: its cursor goes.
  r.hub.emit('removed', { id: 's1' });
  assert.deepEqual(r.sent[2].data, { sid: 's1', gone: true });
  m.close();
});

test('cursor module: the baseline is read when the tool call arrives, so the first edit has a place', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.files.set('p/a.dpx.json', file([rect('r1', 0, 0)]));
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Write', text: '{"file_path":"/abs/repo/p/a.dpx.json"}' } });
  await r.tick();
  await r.change('p/a.dpx.json', file([rect('r1', 200, 0)]));
  assert.equal(r.sent[0].data.x, 250);
  m.close();
});

test('cursor module: an agent creating a diagram gets a cursor at what it drew (#249)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running', color: '#0f766e' };
  // The file does not exist when the tool call arrives: the tool-time read fails.
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Write', text: '{"file_path":"/abs/repo/new.dpx.json"}' } });
  await r.tick();
  await r.change('new.dpx.json', file([rect('r1', 0, 0), rect('r2', 200, 100)]));
  // Bounds 0..300 x 0..150 against an empty canvas.
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].data.x, 150);
  assert.equal(r.sent[0].data.y, 75);
  assert.equal(r.sent[0].data.color, '#0f766e');
  m.close();
});

test('cursor module: a tool-time read that lands after the edit does not hide the first cursor (#249)', async () => {
  const r = rig();
  const read = r.ctx.modules.workspace.store.readFile;
  let release;
  const gate = new Promise((ok) => (release = ok));
  let slow = true;
  // The first read (the tool-time baseline) is slow: it resolves only after the edit has landed.
  r.ctx.modules.workspace.store.readFile = async (rel) => {
    if (slow) {
      slow = false;
      await gate;
    }
    return read(rel);
  };
  const m = await setup(r.ctx);
  r.files.set('a.dpx.json', file([rect('r1', 0, 0)]));
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/w/a.dpx.json"}' } });
  r.files.set('a.dpx.json', file([rect('r1', 0, 0), rect('r2', 400, 0)]));
  const done = r.change('a.dpx.json', r.files.get('a.dpx.json'));
  release();
  await done;
  await r.tick();
  // The baseline read saw the edited file: no diff, so the cursor is placed against an empty canvas instead of
  // being dropped (bounds 0..500 x 0..50).
  assert.equal(r.sent.length, 1);
  assert.deepEqual([r.sent[0].data.x, r.sent[0].data.y], [250, 25]);
  // The next edit diffs against the version the change reported, not a tool-time read.
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/w/a.dpx.json"}' } });
  await r.tick();
  await r.change('a.dpx.json', file([rect('r1', 0, 0), rect('r2', 400, 0), rect('r3', 0, 300)]));
  assert.deepEqual([r.sent[1].data.x, r.sent[1].data.y], [50, 325]);
  m.close();
});

test('cursor module: quick changes to one file are diffed in order (#249)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running' };
  await r.change('a.dpx.json', file([rect('r1', 0, 0)])); // the reported version: r1 only
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/w/a.dpx.json"}' } });
  await r.tick();
  // Two changes back to back. The first one's read is slow, the second one's is fast: handled concurrently, the
  // second would diff first and the first would then diff backwards.
  const v1 = file([rect('r1', 0, 0), rect('r2', 1000, 0)]);
  const v2 = file([rect('r1', 0, 0), rect('r2', 1000, 0), rect('r3', 0, 1000)]);
  const reads = [[v1, 40], [v2, 0]];
  r.ctx.modules.workspace.store.readFile = async () => {
    const [v, ms] = reads.shift();
    await new Promise((ok) => setTimeout(ok, ms));
    return v;
  };
  void r.change('a.dpx.json', v1);
  await r.change('a.dpx.json', v2);
  await new Promise((ok) => setTimeout(ok, 80));
  // r2's centre, then r3's.
  assert.deepEqual(r.sent.map((s) => [s.data.x, s.data.y]), [[1050, 25], [50, 1025]]);
  m.close();
});

test('cursor module: two agents editing two blocks of one file each get their own cursor (#375)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const tool = (id, text) => r.hub.emit('message', { id, entry: { kind: 'tool', name: 'Bash', text } });
  tool('c', `curl -X PUT 'http://127.0.0.1:1/api/file?path=${rel}'`);
  tool('a', `curl -X PUT 'http://127.0.0.1:1/api/file?path=${rel}'`); // Ash's call is the newest
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500)]));
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500, 'p > q')]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['c', 'a']);
  assert.equal(cur[0].y, 50);
  assert.equal(cur[1].y, 550);
  await m.close();
});

test('cursor module: a tool call naming the block wins over call order (#375)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}","new_string":"\\"id\\":\\"bot\\""}` } });
  r.hub.emit('message', { id: 'a', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}","new_string":"\\"id\\":\\"top\\""}` } });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0), block('bot', 0, 500, 'p > q')]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['c']);
  await m.close();
});

test('cursor module: whole-file curl PUT bodies name every block, so call order decides (#390)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const put = (id, blocks) => r.hub.emit('message', { id, entry: { kind: 'tool', name: 'Bash', text: JSON.stringify({
    command: `curl -X PUT 'http://127.0.0.1:1/api/file?path=${rel}' -H 'x-drawing: 1' -d '${JSON.stringify({ blocks })}'`,
  }) } });
  put('c', [block('top', 0, 0, 'x > y'), block('bot', 0, 500)]);
  put('a', [block('top', 0, 0, 'x > y'), block('bot', 0, 500, 'p > q')]); // Ash's call is the newest
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500)]));
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500, 'p > q')]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['c', 'a']);
  assert.deepEqual(cur.map((d) => d.y), [50, 550]);
  await m.close();
});

test('cursor module: a block with an empty id does not hang attribution (#395)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  // Cora's call is raw Codex-style text naming the changed block; Ash's names nothing.
  r.hub.emit('message', { id: 'a', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}` } });
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool', name: 'apply_patch', text: `*** Update File: ${rel}\n"id": "top"` } });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('', 0, 500)]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['c']);
  await m.close();
});

test('cursor module: a call that left no edit does not take the next one (#390)', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const say = (id, entry) => r.hub.emit('message', { id, entry });
  // Cora reads the file through the API and is done with it.
  say('c', { kind: 'tool', name: 'Bash', text: JSON.stringify({ command: `curl -s 'http://127.0.0.1:1/api/file?path=${rel}' | jq .blocks` }) });
  now += 200;
  say('c', { kind: 'tool_result', text: '[]', error: false });
  await r.tick();
  now += 10_000;
  // Ash edits the file 10s later: the cursor is Ash's, not Cora's older uncredited call.
  say('a', { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}` });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500)]));
  // Cora tries an Edit that fails; Ash edits again right after.
  say('c', { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}` });
  say('c', { kind: 'tool_result', text: 'old_string not found', error: true });
  say('a', { kind: 'tool_result', text: 'ok', error: false });
  say('a', { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}` });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500, 'p > q')]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['a', 'a']);
  // A change nobody's open call can explain (all finished long ago) shows no cursor.
  say('a', { kind: 'tool_result', text: 'ok', error: false });
  now += 10_000;
  await r.change(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  assert.equal(r.sent.filter((e) => e.event === 'cursor').length, 2);
  await m.close();
});

test('cursor module: Codex shell calls are final, so a silent sed is not closed by the next call\'s result (#401)', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0)]));
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const say = (entry) => r.hub.emit('message', { id: 'c', entry });
  // Entries as Hub.onCodex pushes them: the tool entry is final, a result (when there is output) follows it.
  say({ kind: 'tool', name: 'shell', text: `sed -i s/a/b/ ${rel}`, final: true, error: false });
  now += 100;
  say({ kind: 'tool', name: 'shell', text: `jq . ${rel}`, final: true, error: false });
  say({ kind: 'tool_result', text: '{}', error: false, final: true });
  await r.tick();
  // A human edits 10s later: both Codex calls are long finished, so there is no cursor.
  now += 10_000;
  await r.change(rel, file([], [block('top', 0, 0, 'x > y')]));
  assert.equal(r.sent.filter((e) => e.event === 'cursor').length, 0);
  // The sed's own edit arrives right away: the cursor is Cora's.
  say({ kind: 'tool', name: 'shell', text: `sed -i s/x/z/ ${rel}`, final: true, error: false });
  await r.change(rel, file([], [block('top', 0, 0, 'z > y')]));
  assert.deepEqual(r.sent.filter((e) => e.event === 'cursor').map((e) => e.data.sid), ['c']);
  // A failed shell call is no edit.
  now += 10_000;
  say({ kind: 'tool', name: 'shell', text: `sed -i s/q/r/ ${rel}`, final: true, error: true });
  await r.change(rel, file([], [block('top', 0, 0, 'z > w')]));
  assert.equal(r.sent.filter((e) => e.event === 'cursor').length, 1);
  await m.close();
});

test('cursor module: Claude results are paired by call id, so parallel and subagent calls cannot swap (#401)', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0)]));
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const say = (entry) => r.hub.emit('message', { id: 'c', entry });
  // A subagent's slow call (older, still running) and the parent's Edit run side by side; the Edit's result comes first.
  say({ kind: 'tool', name: 'Bash', text: 'sleep 60', callId: 'toolu_1' });
  say({ kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}`, callId: 'toolu_2' });
  now += 100;
  say({ kind: 'tool_result', text: 'ok', error: false, callId: 'toolu_2' });
  await r.tick();
  now += 10_000;
  // Edit finished 10s ago (its own change is long past): a human edit now is not Cora's. By call order the Edit
  // would have stayed "running" (the Edit's result would have closed the sleep) and been credited.
  await r.change(rel, file([], [block('top', 0, 0, 'x > y')]));
  assert.equal(r.sent.filter((e) => e.event === 'cursor').length, 0);
  await m.close();
});

test('cursor module: a watcher catch-up attributes to calls older than the settle window (#401)', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0)]));
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}`, callId: 't1' } });
  now += 100;
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool_result', text: 'ok', error: false, callId: 't1' } });
  await r.tick();
  now += 10_000; // the watcher was down for this long
  r.files.set(rel, file([], [block('top', 0, 0, 'x > y')]));
  for (const fn of [...r.listeners]) fn(rel, { catchUp: true });
  await r.tick();
  assert.deepEqual(r.sent.filter((e) => e.event === 'cursor').map((e) => e.data.sid), ['c']);
  await m.close();
});

test('cursor module: ids that are common path words still tell two calls apart (#401)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('flow', 0, 0), block('api', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 'a', entry: { kind: 'tool', name: 'Bash', text: `curl -X PUT 'http://127.0.0.1:1/api/file?path=${rel}' -d '{"id":"api"}'` } });
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}","new_string":"\\"id\\": \\"flow\\""}` } });
  await r.tick();
  await r.change(rel, file([], [block('flow', 0, 0, 'x > y'), block('api', 0, 500)]));
  assert.deepEqual(r.sent.filter((e) => e.event === 'cursor').map((e) => e.data.sid), ['c']);
  await m.close();
});

test('hub: Codex tool entries are final and carry their outcome; Claude entries carry the call id (#401)', () => {
  const hub = Object.create(Hub.prototype);
  const pushed = [];
  Object.assign(hub, { push: (_s, e) => pushed.push(e), touch() {}, noteCheck() {}, rt: () => ({}) });
  hub.onCodex({ id: 's' }, { type: 'item.completed', item: { type: 'command_execution', command: 'sed -i s/a/b/ f', aggregated_output: '', exit_code: 1 } });
  hub.onCodex({ id: 's' }, { type: 'item.completed', item: { type: 'command_execution', command: 'jq . f', aggregated_output: '{}', exit_code: 0 } });
  hub.onCodex({ id: 's' }, { type: 'item.completed', item: { type: 'file_change', changes: [{ kind: 'update', path: 'f' }] } });
  assert.deepEqual(pushed.map((e) => [e.kind, e.final === true, !!e.error]), [
    ['tool', true, true], ['tool', true, false], ['tool_result', true, false], ['tool', true, false]]);
});
