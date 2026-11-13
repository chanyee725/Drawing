import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from '../server/app.js';
import * as workspace from '../server/workspace/index.js';
import * as runsModule from '../server/runs/index.js';
import { createStore } from '../server/workspace/store.js';
import { createRecorder } from '../server/runs/recorder.js';
import { pickSession, serializeRecord } from '../server/runs/record.js';

const DAY = 24 * 60 * 60 * 1000;
const PLAN = { v: 1, block: 'b_pipe', steps: [{ id: 'impl' }, { id: 'review' }] };

async function withRecorder(opts, fn) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-runs-'));
  let t = 1_763_000_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const store = createStore(ws, { now: clock.now });
  const events = [];
  const hub = { broadcast: (event, data) => events.push([event, data]) };
  const recorder = createRecorder({ runs: store.runs, hub, now: clock.now, writeDelayMs: 20, eventGapMs: 0, ...opts });
  try {
    await fn({ ws, store, recorder, events, clock });
  } finally {
    await recorder.close();
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
}
const runFile = (ws, rel, id) => join(ws, '.drawing', 'runs', ...rel.split('/'), `${id}.json`);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

test('runs: start writes a record with the plan snapshot and pending steps', async () => {
  await withRecorder({}, async ({ ws, store, recorder, events }) => {
    await store.createFile('pipes/a');
    const r = await recorder.startRun({ file: 'pipes/a', plan: PLAN, revision: 3 });
    assert.match(r.id, /^\d{13}-[0-9a-f]{8}$/);
    const disk = await readJson(runFile(ws, 'pipes/a.dpx.json', r.id));
    assert.equal(disk.file, 'pipes/a.dpx.json');
    assert.equal(disk.state, 'running');
    assert.equal(disk.plan.revision, 3);
    assert.match(disk.plan.hash, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(disk.plan.snapshot, PLAN);
    assert.deepEqual(Object.keys(disk.steps), ['impl', 'review']);
    assert.equal(disk.steps.impl.state, 'pending');
    assert.equal(events[0][0], 'run');
    assert.equal(events[0][1].run.state, 'running');
    // Hidden: never in the tree.
    assert.ok(!JSON.stringify(await store.tree()).includes('.drawing'));
  });
});

test('runs: session metadata only; free text and unknown keys never reach disk', async () => {
  await withRecorder({}, async ({ ws, store, recorder }) => {
    await store.createFile('a');
    const { id } = await recorder.startRun({ file: 'a', plan: PLAN });
    recorder.updateSession(id, 'impl', {
      sid: 's_14', name: 'Juno', provider: 'claude', model: 'claude-sonnet-5-5', effort: 'high', state: 'working',
      tokens: { input: 100, output: 10, cacheRead: 5, cacheWrite: 1, secret: 9 }, cost: 1.5, ctxPct: 40,
      branch: 'dispatch/impl-14', commit: 'c06f887', pr: { number: 88, state: 'OPEN', title: 'x' },
      last: 'TRANSCRIPT TEXT', prompt: 'PROMPT TEXT', question: 'QUESTION', attention: 'what is the db password?',
    });
    await recorder.endRun(id, 'done');
    const text = await readFile(runFile(ws, 'a.dpx.json', id), 'utf8');
    for (const bad of ['TRANSCRIPT', 'PROMPT', 'QUESTION', 'password', 'secret', 'title']) assert.ok(!text.includes(bad), bad);
    const s = JSON.parse(text).steps.impl.sessions[0];
    assert.deepEqual(s.pr, { number: 88, state: 'open' });
    assert.deepEqual(s.tokens, { input: 100, output: 10, cacheRead: 5, cacheWrite: 1 });
    assert.equal(s.model, 'claude-sonnet-5-5');
    assert.equal(JSON.parse(text).state, 'done');
    // free text in a short-token field is refused
    assert.equal(pickSession({ sid: 's', branch: 'has spaces in it' }).branch, undefined);
  });
});

test('runs: step state is the worst of its sessions; timeline and totals follow', async () => {
  await withRecorder({}, async ({ recorder, store, clock }) => {
    await store.createFile('a');
    const { id } = await recorder.startRun({ file: 'a', plan: PLAN });
    clock.advance(1000);
    assert.equal(recorder.updateSession(id, 'impl', { sid: 's1', state: 'working', cost: 1, tokens: { input: 1_000_000 } }), 'working');
    assert.equal(recorder.updateSession(id, 'impl', { sid: 's2', state: 'stuck', cost: 0.5 }), 'stuck');
    assert.equal(recorder.updateSession(id, 'impl', { sid: 's2', state: 'done' }), 'working');
    assert.equal(recorder.updateSession(id, 'impl', { sid: 's1', state: 'done' }), 'done');
    recorder.setStepState(id, 'review', 'skipped');
    const r = await recorder.read('a', id);
    assert.deepEqual(r.timeline.map(([, s, st]) => [s, st]), [['impl', 'working'], ['impl', 'stuck'], ['impl', 'working'], ['impl', 'done'], ['review', 'skipped']]);
    assert.ok(r.steps.impl.startedAt && r.steps.impl.endedAt);
    assert.deepEqual(r.totals, { cost: 1.5, mtok: 1 });
    assert.throws(() => recorder.setStepState(id, 'impl', 'blocked'), /sessions/);
    assert.throws(() => recorder.updateSession(id, 'nope', { sid: 's1' }), /step/);
    assert.throws(() => recorder.updateSession(id, 'impl', { state: 'done' }), /sid/);
  });
});

test('runs: writes are debounced; events carry only changed fields', async () => {
  await withRecorder({ writeDelayMs: 40 }, async ({ ws, store, recorder, events }) => {
    await store.createFile('a');
    const { id } = await recorder.startRun({ file: 'a', plan: PLAN });
    recorder.updateSession(id, 'impl', { sid: 's1', state: 'working', cost: 1 });
    recorder.updateSession(id, 'impl', { sid: 's1', state: 'working', cost: 2 });
    recorder.updateSession(id, 'impl', { sid: 's1', state: 'working', cost: 2 }); // no change, no event
    const p = runFile(ws, 'a.dpx.json', id);
    assert.equal((await readJson(p)).steps.impl.sessions.length, 0); // not yet
    await sleep(80);
    assert.equal((await readJson(p)).steps.impl.sessions[0].cost, 2);
    const runEvents = events.filter(([e, d]) => e === 'run' && d.session).map(([, d]) => d);
    assert.equal(runEvents.length, 2);
    assert.deepEqual(runEvents[0], { file: 'a.dpx.json', runId: id, step: 'impl', session: { sid: 's1', state: 'working', cost: 1 }, state: 'working' });
    assert.deepEqual(runEvents[1].session, { sid: 's1', cost: 2 });
  });
});

test('runs: events per session are coalesced to the gap', async () => {
  await withRecorder({ eventGapMs: 60 }, async ({ store, recorder, events }) => {
    await store.createFile('a');
    const { id } = await recorder.startRun({ file: 'a', plan: PLAN });
    recorder.updateSession(id, 'impl', { sid: 's1', state: 'working' });
    recorder.updateSession(id, 'impl', { sid: 's1', cost: 1 });
    recorder.updateSession(id, 'impl', { sid: 's1', ctxPct: 5 });
    const sessionEvents = () => events.filter(([, d]) => d.session).map(([, d]) => d.session);
    assert.equal(sessionEvents().length, 1);
    await sleep(100);
    assert.deepEqual(sessionEvents()[1], { sid: 's1', cost: 1, ctxPct: 5 });
  });
});

test('runs: list newest first and read; API shape', async () => {
  await withRecorder({}, async ({ store, recorder, clock }) => {
    await store.createFile('a');
    const r1 = await recorder.startRun({ file: 'a', plan: PLAN });
    await recorder.endRun(r1.id, 'failed');
    clock.advance(1000);
    const r2 = await recorder.startRun({ file: 'a', plan: PLAN });
    const { runs } = await recorder.list('a');
    assert.deepEqual(runs.map((r) => [r.id, r.state]), [[r2.id, 'running'], [r1.id, 'failed']]);
    assert.deepEqual(Object.keys(runs[0]), ['id', 'startedAt', 'endedAt', 'state', 'totals']);
    assert.equal((await recorder.read('a.dpx.json', r1.id)).state, 'failed');
    await assert.rejects(recorder.read('a', '1763000000000-deadbeef'), { status: 404 });
    await assert.rejects(recorder.read('a', '../x'), { status: 400 });
    await assert.rejects(recorder.list('.drawing/x'), { status: 400 });
    assert.deepEqual(await recorder.list('nothing'), { runs: [] });
  });
});

test('runs: prune keeps newest 50 plus anything under 90 days; running runs stay', async () => {
  await withRecorder({ keep: 3 }, async ({ ws, store, recorder, clock }) => {
    await store.createFile('a');
    const dir = join(ws, '.drawing', 'runs', 'a.dpx.json');
    await mkdir(dir, { recursive: true });
    const old = clock.now() - 200 * DAY;
    // five old finished runs, one recent finished run
    for (let i = 0; i < 5; i++) await writeFile(join(dir, `${old + i}-0000000${i}.json`), '{}');
    const live = await recorder.startRun({ file: 'a', plan: PLAN }); // prunes: keeps 3 newest
    let names = (await readdir(dir)).sort();
    assert.deepEqual(names, [`${old + 3}-00000003.json`, `${old + 4}-00000004.json`, `${live.id}.json`]);
    clock.advance(1000);
    // live is now 4th newest but recent; old ones beyond keep go
    await recorder.endRun((await recorder.startRun({ file: 'a', plan: PLAN })).id);
    clock.advance(1000);
    await recorder.startRun({ file: 'a', plan: PLAN });
    names = (await readdir(dir)).sort();
    assert.ok(names.includes(`${live.id}.json`));
    assert.ok(!names.some((n) => n.startsWith(String(old))));
  });
});

test('runs: move, rename, delete and restore carry run records, also a running one', async () => {
  await withRecorder({}, async ({ ws, store, recorder }) => {
    await store.createFile('f/a');
    const done = await recorder.startRun({ file: 'f/a', plan: PLAN });
    await recorder.endRun(done.id);
    const live = await recorder.startRun({ file: 'f/a', plan: PLAN });

    await store.move('f/a.dpx.json', 'f/b.dpx.json');
    assert.deepEqual((await recorder.list('f/b')).runs.length, 2);
    assert.deepEqual((await recorder.list('f/a')).runs, []);
    recorder.updateSession(live.id, 'impl', { sid: 's1', state: 'working' });
    await sleep(50);
    assert.equal((await readJson(runFile(ws, 'f/b.dpx.json', live.id))).file, 'f/b.dpx.json');

    await store.move('f', 'g');
    assert.equal((await recorder.list('g/b')).runs.length, 2);

    await store.removeFile('g/b');
    assert.deepEqual((await recorder.list('g/b')).runs, []);
    recorder.updateSession(live.id, 'impl', { sid: 's1', cost: 3 });
    await sleep(50);
    const { items } = await store.trash();
    const trashRuns = join(ws, '.drawing', 'trash', items[0].id, 'runs');
    assert.equal((await readJson(join(trashRuns, `${live.id}.json`))).steps.impl.sessions[0].cost, 3);

    await store.restoreTrash(items[0].id);
    assert.equal((await recorder.list('g/b')).runs.length, 2);
    await recorder.endRun(live.id, 'stopped');
    assert.equal((await readJson(runFile(ws, 'g/b.dpx.json', live.id))).state, 'stopped');
    // nothing left behind under the old paths
    assert.deepEqual(await readdir(join(ws, '.drawing', 'runs')), ['g']);
  });
});

test('runs: a file deleted with a folder keeps its runs in the trash', async () => {
  await withRecorder({}, async ({ store, recorder }) => {
    await store.createFile('f/a');
    await recorder.endRun((await recorder.startRun({ file: 'f/a', plan: PLAN })).id);
    await store.removeFolder('f');
    const { items } = await store.trash();
    await store.restoreTrash(items[0].id);
    assert.equal((await recorder.list('f/a')).runs.length, 1);
  });
});

test('runs: record over the size cap drops the oldest timeline entries', () => {
  const record = { v: 1, timeline: Array.from({ length: 500 }, (_, i) => [1763000000000 + i, 'impl', 'working']) };
  const text = serializeRecord(record, 8 * 1024);
  assert.ok(Buffer.byteLength(text) <= 8 * 1024);
  const tl = JSON.parse(text).timeline;
  assert.ok(tl.length > 0 && tl.length < 500);
  assert.equal(tl[tl.length - 1][0], 1763000000499);
});

test('runs: bad plans are refused', async () => {
  await withRecorder({}, async ({ store, recorder }) => {
    await store.createFile('a');
    await assert.rejects(recorder.startRun({ file: 'a', plan: { steps: [{ id: 'x' }, { id: 'x' }] } }), { status: 400 });
    await assert.rejects(recorder.startRun({ file: 'a', plan: { steps: [{}] } }), { status: 400 });
    await assert.rejects(recorder.startRun({ file: 'a', plan: null }), { status: 400 });
  });
});

test('runs API: list, read, POST stub', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-runs-api-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: [{ name: 'workspace', setup: workspace.setup }, { name: 'runs', setup: runsModule.setup }] });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const { store } = app.ctx.modules.workspace;
    const { recorder } = app.ctx.modules.runs;
    await store.createFile('a');
    const run = await recorder.startRun({ file: 'a', plan: PLAN });
    let res = await fetch(`${base}/api/runs?path=a.dpx.json`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).runs[0].id, run.id);
    res = await fetch(`${base}/api/runs/run?path=a.dpx.json&id=${run.id}`);
    assert.equal((await res.json()).id, run.id);
    res = await fetch(`${base}/api/runs?path=../x`);
    assert.equal(res.status, 400);
    res = await fetch(`${base}/api/runs`);
    assert.equal(res.status, 400);
    res = await fetch(`${base}/api/runs?path=a.dpx.json`, { method: 'POST', headers: { 'x-drawing': '1' } });
    assert.equal(res.status, 501);
    res = await fetch(`${base}/api/runs?path=a.dpx.json`, { method: 'POST' });
    assert.equal(res.status, 403);
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
});
