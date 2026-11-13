// E56 live agent cursor, server side: diff model and the cursor module's attribution and events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { changedCentre, mentionsFile, shapesOf } from '../server/cursor/model.js';
import { setup } from '../server/cursor/index.js';

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
  return { files, hub, ctx, sent, change, tick: () => new Promise((r) => setTimeout(r, 5)) };
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
