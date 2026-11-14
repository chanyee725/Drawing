// Plans and approval (E20): write_plan, the create_sessions gate, 시작하기, set_task.step and note_step.
// Runs against a scratch git repo with one commit in a temp dir; agent sessions use the fake CLIs only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import * as workspace from '../server/workspace/index.js';
import * as runs from '../server/runs/index.js';
import * as dispatch from '../server/dispatch/index.js';
import * as pipeline from '../server/pipeline/index.js';
import { fakeCliBin, fakeSpawner, until } from './fixtures/fake-cli/index.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'drawing-e20-'));
  dirs.push(root);
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'ws');
  mkdirSync(ws);
  return { root, ws };
}

/** A server on a fresh scratch repo, or with `again`, a restart on the same repo, workspace and fake CLIs. */
async function start(again = null) {
  const { root, ws } = again ?? scratchRepo();
  const bin = again?.bin ?? fakeCliBin();
  if (!again) dirs.push(bin.dir);
  const p = { installed: true, connected: true, busy: false, url: null, error: null };
  const deps = {
    limitsFile: join(root, 'limits.json'),
    providerStatus: async () => ({ claude: { ...p }, openai: { ...p, connected: false }, gemini: { ...p, connected: false } }),
    codexModels: async () => [],
    login: () => {},
    logout: async () => {},
    cancelLogin: () => {},
    spawnCli: fakeSpawner(bin),
  };
  const moduleList = [
    { name: 'workspace', setup: workspace.setup },
    { name: 'runs', setup: runs.setup },
    { name: 'dispatch', setup: (ctx) => dispatch.setup(ctx, deps) },
    { name: 'pipeline', setup: pipeline.setup },
  ];
  const pub = mkdtempSync(join(tmpdir(), 'drawing-e20-pub-'));
  dirs.push(pub);
  writeFileSync(join(pub, 'index.html'), '<!doctype html>');
  const app = await createApp({ workspaceDir: ws }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const W = { 'content-type': 'application/json', 'x-drawing': '1' };
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: method === 'GET' ? {} : W, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  // Connect Claude the way the UI does (the CLI reports itself logged in).
  assert.equal((await call('POST', '/api/providers/claude/login')).body.connected, true);
  const d = app.ctx.modules.dispatch;
  const lead = again?.lead ?? (await call('POST', '/api/sessions', { items: [{ role: 'lead', task: 'plan it' }], worktree: false })).body.sessions[0];
  if (!again) await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
  return { app, call, d, lead, root, ws, bin, stop: () => app.close() };
}

const STEPS = [
  { id: 'api', title: '서버 API', role: 'impl', model: 'claude-haiku-5-5', done: 'auth.test 통과', files: ['server/auth.js'] },
  { id: 'ui', title: '로그인 화면', role: 'impl', model: 'claude-haiku-5-5' },
  { id: 'review', title: '리뷰', role: 'review', model: 'claude-haiku-5-5', after: ['api', 'ui'] },
];

test('write_plan writes a draft, gates create_sessions, and 시작하기 hands the approved revision to the lead', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws } = t;
    // Bad input is refused with a plain reason and writes nothing.
    const bad = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '', steps: STEPS });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /goal/);
    // Only a lead may write a plan.
    assert.equal((await call('POST', '/api/pipeline/plan', { lead: 'nobody', goal: 'x', steps: STEPS })).status, 400);

    const w = await call('POST', '/api/pipeline/plan', { lead: lead.id, title: '로그인 개편', goal: '매직 링크로 로그인해요', steps: STEPS, risks: ['쿠키 이름이 바뀌어요'], asks: ['링크 유효 시간은 15분?'] });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.path, 'pipelines/로그인-개편.dpx.json');
    assert.equal(w.body.state, 'plan');
    const file = JSON.parse(readFileSync(join(ws, w.body.path), 'utf8'));
    assert.deepEqual(file.plan.steps.map((s) => s.id), ['api', 'ui', 'review']);
    assert.equal(file.blocks[0].id, file.plan.block);
    assert.equal(file.blocks[0].type, 'flowchart');

    // Status: in plan, nothing blocks, 3 sessions; the draft has no changes yet.
    let st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.equal(st.body.state, 'plan');
    assert.deepEqual(st.body.blockers, []);
    assert.equal(st.body.sessions, 3);
    assert.deepEqual(st.body.changes, []);

    // The gate: no teammates before approval.
    const gated = await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'x' }], worktree: false, parent: lead.id });
    assert.equal(gated.status, 409);
    assert.match(gated.body.error, /계획 승인 전이에요/);
    // set_task with a step needs a running plan.
    const early = await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api' });
    assert.equal(early.status, 409);

    // The person edits the plan (model of one step), so the start shows the change.
    const cur = (await call('GET', `/api/file?path=${encodeURIComponent(w.body.path)}`)).body;
    cur.plan.steps[1].model = 'claude-sonnet-5-5';
    const saved = await call('PUT', `/api/file?path=${encodeURIComponent(w.body.path)}`, { ...cur });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.deepEqual(st.body.changes, ['단계 ui 모델 claude-haiku-5-5 → claude-sonnet-5-5']);

    // A stale revision is refused; the current one starts.
    const stale = await call('POST', '/api/pipeline/start', { path: w.body.path, revision: w.body.revision });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.revision, saved.body.revision);
    // The refused start did not start anything: still a plan, no run, lead not told.
    st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.equal(st.body.state, 'plan');
    assert.equal(st.body.runId, null);
    assert.doesNotMatch(d.hub.transcript(lead.id).filter((m) => m.kind === 'user').map((m) => m.text).join('\n'), /계획 승인/);
    const go = await call('POST', '/api/pipeline/start', { path: w.body.path, revision: saved.body.revision });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    assert.equal(go.body.state, 'running');
    assert.ok(go.body.runId);
    const told = d.hub.transcript(lead.id).filter((m) => m.kind === 'user').map((m) => m.text).join('\n');
    assert.match(told, new RegExp(`\\[계획 승인 · rev ${saved.body.revision}\\]`));
    assert.match(told, /단계 ui 모델/);
    assert.equal((await call('POST', '/api/pipeline/start', { path: w.body.path, revision: saved.body.revision })).status, 409);
    // Running plans are not rewritten.
    assert.equal((await call('POST', '/api/pipeline/plan', { lead: lead.id, path: w.body.path, goal: 'x', steps: STEPS })).status, 409);

    // After approval: teammates, tasks tied to steps, notes.
    await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
    const made = await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const mate = made.body.sessions[0];
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, title: '없는 단계', step: 'nope' })).status, 409);
    const task = await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, stage: 'impl' });
    assert.equal(task.status, 200, JSON.stringify(task.body));
    assert.equal(task.body.step, 'api');
    const noted = await call('POST', '/api/pipeline/note', { lead: lead.id, step: 'api', text: '  리뷰 must-fix 1건\n고쳐서 다시 올림 ' });
    assert.equal(noted.status, 200, JSON.stringify(noted.body));
    assert.equal(noted.body.note, '리뷰 must-fix 1건 고쳐서 다시 올림');
    assert.equal((await call('POST', '/api/pipeline/note', { lead: lead.id, step: 'nope', text: 'x' })).status, 409);

    // The teammate's session lands in the run record under its step (metadata only).
    const runId = go.body.runId;
    await until(() => t.app.ctx.modules.pipeline && d.store.data.pipelines[w.body.path].links[mate.id] === 'api', 10_000);
    await t.app.ctx.modules.runs.recorder.endRun(runId, 'done');
    const rec = (await call('GET', `/api/runs/run?path=${encodeURIComponent(w.body.path)}&id=${runId}`)).body;
    assert.equal(rec.steps.api.note, '리뷰 must-fix 1건 고쳐서 다시 올림');
    assert.equal(rec.steps.api.sessions[0].sid, mate.id);
    assert.equal(rec.steps.api.sessions[0].name, mate.name);
    assert.equal(rec.plan.revision, saved.body.revision);
  } finally {
    await t.stop();
  }
});

test('blockers: unknown role, cycle, no lead; moving the file keeps its approval state', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead } = t;
    const w = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '순환', steps: [{ id: 'a', title: 'A', role: 'nobody' }] });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    let st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.match(st.body.blockers.join('|'), /역할 "nobody"을 몰라요/);
    const refused = await call('POST', '/api/pipeline/start', { path: w.body.path, revision: w.body.revision });
    assert.equal(refused.status, 409);
    assert.ok(refused.body.blockers.length);

    // Writing again without a path revises the same draft.
    const again = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '순환', steps: [{ id: 'a', title: 'A', role: 'impl', after: ['b'] }, { id: 'b', title: 'B', role: 'impl', after: ['a'] }] });
    assert.equal(again.body.path, w.body.path);
    st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.match(st.body.blockers.join('|'), /서로를 기다려요/);
    assert.deepEqual(st.body.changes, []);

    // A file nobody's lead wrote cannot start.
    const plain = await call('POST', '/api/file', { path: 'pipelines/hand', plan: { v: 1, block: 'b1', steps: [{ id: 's', node: 's', role: 'impl' }] }, blocks: [{ id: 'b1', type: 'flowchart', code: 's', x: 0, y: 0, w: 0, h: 0 }] });
    assert.equal(plain.status, 201, JSON.stringify(plain.body));
    st = await call('GET', `/api/pipeline?path=${encodeURIComponent(plain.body.path)}`);
    assert.equal(st.body.state, 'plan');
    assert.match(st.body.blockers.join('|'), /관리자가 쓴 계획이 아니에요/);

    // Move: the approval state follows the file.
    const mv = await call('POST', '/api/move', { from: w.body.path, to: 'done/cycle.dpx.json', type: 'file' });
    assert.equal(mv.status, 200, JSON.stringify(mv.body));
    assert.equal(d.store.data.pipelines['done/cycle.dpx.json']?.lead, lead.id);
    assert.equal(d.store.data.pipelines[w.body.path], undefined);
  } finally {
    await t.stop();
  }
});

test('a one-step plan with autostart starts at once', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, lead } = t;
    const w = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '오타 고치기', steps: [{ title: '오타', role: 'impl', model: 'claude-haiku-5-5' }], autostart: true });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.state, 'running');
    assert.ok(w.body.runId);
    // Two steps with autostart stay a draft.
    const two = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '둘', steps: [{ title: 'a', role: 'impl' }, { title: 'b', role: 'impl' }], autostart: true });
    assert.equal(two.body.state, 'plan');
  } finally {
    await t.stop();
  }
});

// ---- E27: 멈추기, 이어서 하기, 계획 다시 열기, the limit guard ----

async function running(t, steps = STEPS) {
  const { call, d, lead } = t;
  const w = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '멈춤 연습', steps });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const go = await call('POST', '/api/pipeline/start', { path: w.body.path, revision: w.body.revision });
  assert.equal(go.status, 200, JSON.stringify(go.body));
  await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
  return { path: w.body.path, runId: go.body.runId };
}
const told = (d, id) => d.hub.transcript(id).filter((m) => m.kind === 'user').map((m) => m.text).join('\n');
const statusOf = async (call, path) => (await call('GET', `/api/pipeline?path=${encodeURIComponent(path)}`)).body;

test('멈추기 pauses the plan and holds the team; 이어서 하기 hands the open steps back to the lead', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws } = t;
    const { path, runId } = await running(t);
    assert.equal((await call('POST', '/api/pipeline/resume', { path })).status, 409);
    const mate = (await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id })).body.sessions[0];
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, stage: 'done' });
    await until(() => ['idle', 'done'].includes(d.hub.get(mate.id).status), 10_000);

    // No header, no stop.
    const base = `http://127.0.0.1:${t.app.server.address().port}`;
    const bare = await fetch(`${base}/api/pipeline/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
    assert.equal(bare.status, 403);

    const interrupted = [];
    const real = d.hub.interrupt.bind(d.hub);
    d.hub.interrupt = (id) => {
      interrupted.push(id);
      return real(id);
    };
    d.hub.get(mate.id).status = 'running'; // mid-turn, as far as the hub knows
    const stopped = await call('POST', '/api/pipeline/stop', { path });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
    assert.equal(stopped.body.state, 'paused');
    assert.equal(stopped.body.pause.by, 'stop');
    assert.deepEqual(interrupted, [mate.id]);
    assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 409);
    const rec = JSON.parse(readFileSync(join(ws, '.drawing', 'runs', ...path.split('/'), `${runId}.json`), 'utf8'));
    assert.equal(rec.state, 'paused');
    assert.equal(rec.pause.by, 'stop');
    // Paused: no new teammates, no plan rewrite, and teammate reports wait.
    const gated = await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'x' }], worktree: false, parent: lead.id });
    assert.equal(gated.status, 409);
    assert.match(gated.body.error, /멈춰 있어요/);
    assert.equal((await call('POST', '/api/pipeline/plan', { lead: lead.id, path, goal: 'x', steps: STEPS })).status, 409);
    d.hub.rt(mate.id).pendingReport = '[mate 보고] 끝';
    d.hub.deliverReport(d.hub.get(mate.id));
    assert.doesNotMatch(told(d, lead.id), /\[mate 보고\]/);

    const go = await call('POST', '/api/pipeline/resume', { path });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    assert.equal(go.body.state, 'running');
    assert.equal(go.body.pause, null);
    const said = told(d, lead.id);
    assert.match(said, /\[계획 이어서 하기 · rev \d+\]/);
    assert.match(said, /끝나지 않은 단계: ui, review/);
    assert.match(said, /\[mate 보고\] 끝/);
    const live = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${runId}`)).body;
    assert.equal(live.state, 'running');
  } finally {
    await t.stop();
  }
});

test('the limit guard pauses a running plan and resumes it after the reset; 이어서 하기 waits for it', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead } = t;
    const pipe = t.app.ctx.modules.pipeline;
    const { path, runId } = await running(t);
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', stage: 'impl' });
    const resetAt = Date.now() + 60 * 60 * 1000;
    d.hub.limitHit = () => ({ key: 'five:x', reason: '5시간 한도 93%', resetAt });
    d.hub.checkTickets(); // saves the lead's open work as a ticket, like a real rate_limit_event
    await pipe.syncLimit();
    let st = await statusOf(call, path);
    assert.equal(st.state, 'paused');
    assert.equal(st.pause.by, 'limit');
    assert.equal(st.pause.resetAt, resetAt);
    assert.match(st.blockers[0], /한도에 걸려 있어요/);
    const refused = await call('POST', '/api/pipeline/resume', { path });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /한도에 걸려 있어요/);
    const rec = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${runId}`)).body;
    assert.equal(rec.state, 'paused');
    assert.deepEqual(Object.keys(rec.pause).sort(), ['at', 'by', 'resetAt']);

    // The window clears: one message to the lead (the ticket), carrying the plan's open steps.
    d.hub.limitHit = () => null;
    await pipe.syncLimit();
    st = await statusOf(call, path);
    assert.equal(st.state, 'running');
    const said = told(d, lead.id);
    assert.equal(said.match(/\[Dispatch 티켓 재개\]/g)?.length, 1);
    assert.match(said, /\[계획 이어서 하기 · rev \d+\][^\n]*\n끝나지 않은 단계: api, ui, review/);
    assert.equal(said.match(/\[계획 이어서 하기/g).length, 1);
    // A second look changes nothing.
    await pipe.syncLimit();
    assert.equal(told(d, lead.id).match(/\[계획 이어서 하기/g).length, 1);
  } finally {
    await t.stop();
  }
});

test('계획 다시 열기 ends the stopped run and the next 시작하기 carries the finished steps over', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, root } = t;
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal((await call('POST', '/api/pipeline/reopen', { path })).status, 409); // running: stop first
    const mate = (await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id })).body.sessions[0];
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, commit: head, stage: 'done' });
    await until(() => d.store.data.pipelines[path].links[mate.id] === 'api', 10_000);
    await until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api')?.mergeCheck?.ok === true, 10_000);
    assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);

    const re = await call('POST', '/api/pipeline/reopen', { path });
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.equal(re.body.state, 'plan');
    assert.equal(re.body.runId, null);
    assert.deepEqual(re.body.changes, []);
    assert.match(told(d, lead.id), /\[계획 다시 열림\][^]*이미 끝난 단계: api/);
    const old = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${runId}`)).body;
    assert.equal(old.state, 'stopped');
    // A plan again: no teammates until 시작하기; the lead may revise it and the carry survives.
    assert.equal((await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'x' }], worktree: false, parent: lead.id })).status, 409);
    const rev = await call('POST', '/api/pipeline/plan', { lead: lead.id, path, goal: '멈춤 연습 2', steps: STEPS });
    assert.equal(rev.status, 200, JSON.stringify(rev.body));

    const go = await call('POST', '/api/pipeline/start', { path, revision: rev.body.revision });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    assert.notEqual(go.body.runId, runId);
    // The task board speaks again (a merge check, another set_task): the mate that finished api does not relink to
    // the new run through its old, closed task (E205); the carried step keeps the sessions it ran with.
    d.hub.emit('tasks', d.hub.tasks);
    d.hub.emit('session', { ...d.hub.publicSession(d.hub.get(mate.id)), cost: 7.5 });
    const next = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.equal(d.store.data.pipelines[path].links[mate.id], undefined);
    assert.equal(next.steps.api.state, 'done');
    assert.equal(next.steps.api.carried, runId);
    assert.equal(next.steps.api.sessions[0].sid, mate.id);
    assert.notEqual(next.steps.api.sessions[0].cost, 7.5);
    assert.equal(next.steps.ui.state, 'pending');

    // The lead reopens that old, closed task (same id, same carried step) and closes it again in this run: the mate
    // still does not link to the carried step, so nothing new lands there (E206).
    const oldApi = d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api');
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, id: oldApi.id, stage: 'impl' })).status, 200);
    d.hub.emit('session', { ...d.hub.publicSession(d.hub.get(mate.id)), cost: 7.5 });
    assert.equal(d.store.data.pipelines[path].links[mate.id], undefined);
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, id: oldApi.id, commit: head, stage: 'done' })).status, 200);
    await until(() => d.hub.tasks.find((x) => x.id === oldApi.id)?.stage === 'done', 10_000);
    d.hub.emit('session', { ...d.hub.publicSession(d.hub.get(mate.id)), cost: 7.5 });
    assert.equal(d.store.data.pipelines[path].links[mate.id], undefined);
    const still = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.deepEqual(still.steps.api.sessions, next.steps.api.sessions);

    // The lead reuses that mate for new work: its session links to the new step, and its cost and tokens land there,
    // not on the carried step.
    const carriedApi = next.steps.api.sessions[0];
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', owner: mate.name, stage: 'impl' });
    await until(() => d.store.data.pipelines[path].links[mate.id] === 'ui', 10_000);
    // Its new turn's numbers, kept on the session so the fake CLI's own events carry the same ones.
    await until(() => ['idle', 'done'].includes(d.hub.get(mate.id).status), 10_000);
    Object.assign(d.hub.get(mate.id), { cost: 7.5, usage: { input: 1234, output: 56 } });
    d.hub.emit('session', d.hub.publicSession(d.hub.get(mate.id)));
    await until(async () => (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body.steps.ui.sessions[0]?.cost === 7.5, 10_000);
    const reused = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.equal(reused.steps.ui.sessions[0].sid, mate.id);
    assert.deepEqual(reused.steps.ui.sessions[0].tokens, { input: 1234, output: 56 });
    assert.deepEqual(reused.steps.api.sessions, [carriedApi]);
    assert.equal(reused.steps.api.state, 'done');
    assert.match(told(d, lead.id), /지난 실행에서 끝난 단계\(다시 하지 마라\): api/);
    assert.equal(d.store.data.pipelines[path].carry, undefined);

    // The rest closes: the run ends done and the carried step keeps how the earlier run merged it.
    for (const [step, title] of [['ui', '로그인 화면'], ['review', '리뷰']]) {
      await call('POST', '/api/tasks', { lead: lead.id, title, step, commit: head, stage: 'done' });
    }
    await until(async () => (await statusOf(call, path)).state === 'done', 10_000);
    const fin = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.equal(fin.state, 'done');
    assert.equal(fin.steps.api.result?.commit, head);
    await until(() => JSON.parse(readFileSync(join(t.ws, path), 'utf8')).document.content[0]?.attrs?.id === 'run-summary', 10_000);
  } finally {
    await t.stop();
  }
});

test('계획 다시 열기 twice keeps what the first run finished and how it merged (E28)', { timeout: 90_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, root } = t;
    const { path, runId: a } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const merged = (step) => until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.step === step && x.commit)?.mergeCheck?.ok === true, 10_000);
    const runOf = async (id) => (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${id}`)).body;
    const reopenAndStart = async () => {
      assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);
      const re = await call('POST', '/api/pipeline/reopen', { path });
      assert.equal(re.status, 200, JSON.stringify(re.body));
      const go = await call('POST', '/api/pipeline/start', { path, revision: re.body.draftRevision ?? re.body.revision });
      assert.equal(go.status, 200, JSON.stringify(go.body));
      return go.body.runId;
    };

    // Run A merges api.
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', commit: head, stage: 'done' });
    await merged('api');
    const b = await reopenAndStart();
    assert.equal((await runOf(b)).steps.api.carried, a);

    // Run B merges ui and closes api again without a commit: the earlier merge stays.
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', commit: head, stage: 'done' });
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API 다시', step: 'api', stage: 'done' });
    await merged('ui');
    const c = await reopenAndStart();
    assert.match(told(d, lead.id), /이미 끝난 단계: api, ui/);
    assert.match(told(d, lead.id), /지난 실행에서 끝난 단계\(다시 하지 마라\): api, ui/);
    const runC = await runOf(c);
    for (const id of ['api', 'ui']) {
      assert.equal(runC.steps[id].state, 'done', id);
      assert.equal(runC.steps[id].carried, b, id);
      assert.deepEqual(runC.steps[id].result, { commit: head, base: 'develop' }, id);
    }
    assert.equal(runC.steps.review.state, 'pending');

    // Run C closes review: both carried steps count as merged in the record.
    await call('POST', '/api/tasks', { lead: lead.id, title: '리뷰', step: 'review', commit: head, stage: 'done' });
    await until(async () => (await statusOf(call, path)).state === 'done', 10_000);
    const fin = await runOf(c);
    assert.equal(fin.steps.api.result.commit, head);
    assert.equal(fin.steps.ui.result.commit, head);
    assert.equal(fin.steps.api.state, 'done');
  } finally {
    await t.stop();
  }
});

test('계획 다시 열기, then a server restart: the next 시작하기 still carries the finished steps and how they merged (E28)', { timeout: 90_000 }, async () => {
  let t = await start();
  try {
    const { call, d, lead, root } = t;
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', commit: head, stage: 'done' });
    await until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api')?.mergeCheck?.ok === true, 10_000);
    assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);
    const re = await call('POST', '/api/pipeline/reopen', { path });
    assert.equal(re.status, 200, JSON.stringify(re.body));

    // Restart on the same workspace: the carry is kept on disk, not only in memory.
    await t.stop();
    t = await start(t);
    const reopened = await statusOf(t.call, path);
    assert.equal(reopened.state, 'plan');
    const go = await t.call('POST', '/api/pipeline/start', { path, revision: reopened.draftRevision ?? reopened.revision });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    const next = (await t.call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.equal(next.steps.api.state, 'done');
    assert.equal(next.steps.api.carried, runId);
    assert.deepEqual(next.steps.api.result, { commit: head, base: 'develop' });
    assert.equal(next.steps.ui.state, 'pending');
    assert.equal(t.d.store.data.pipelines[path].carry, undefined);
  } finally {
    await t.stop();
  }
});

test('a paused run with a carried step, then a server restart: its reopened old task links nothing and costs nothing there (E206d)', { timeout: 90_000 }, async () => {
  let t = await start();
  try {
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', t.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const mate = (await t.call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: t.lead.id })).body.sessions[0];
    await t.call('POST', '/api/tasks', { lead: t.lead.id, title: '서버 API', step: 'api', owner: mate.name, commit: head, stage: 'done' });
    await until(() => t.d.store.data.pipelines[path].links[mate.id] === 'api', 10_000);
    await until(() => t.d.hub.tasks.find((x) => x.lead === t.lead.id && x.step === 'api')?.mergeCheck?.ok === true, 10_000);
    await until(() => ['idle', 'done'].includes(t.d.hub.get(mate.id).status), 10_000);
    assert.equal((await t.call('POST', '/api/pipeline/stop', { path })).status, 200);
    const re = await t.call('POST', '/api/pipeline/reopen', { path });
    assert.equal(re.status, 200, JSON.stringify(re.body));
    const go = await t.call('POST', '/api/pipeline/start', { path, revision: re.body.draftRevision ?? re.body.revision });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    const runOf = async () => (await t.call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    const before = await runOf();
    assert.equal(before.steps.api.carried, runId);
    assert.equal((await t.call('POST', '/api/pipeline/stop', { path })).status, 200);

    // Restart: the paused run is on disk only. The lead reopens the old api task before 이어서 하기.
    await t.stop();
    t = await start(t);
    const { call, d, lead } = t;
    assert.equal((await statusOf(call, path)).state, 'paused');
    const oldApi = d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api');
    assert.ok(oldApi);
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, id: oldApi.id, stage: 'impl' })).status, 200);
    const sess = () => ({ ...d.hub.publicSession(d.hub.get(mate.id)), cost: 7.5, usage: { input: 1234, output: 56 } });
    d.hub.emit('session', sess());
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(d.store.data.pipelines[path].links?.[mate.id], undefined);

    // 이어서 하기: the session reports again; nothing lands on the carried step.
    assert.equal((await call('POST', '/api/pipeline/resume', { path })).status, 200);
    d.hub.emit('session', sess());
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(d.store.data.pipelines[path].links?.[mate.id], undefined);
    const after = await runOf();
    assert.deepEqual(after.steps.api.sessions, before.steps.api.sessions);
    assert.equal(after.steps.api.state, 'done');
  } finally {
    await t.stop();
  }
});

test('a carried step closed again with a new commit keeps the new commit (E28)', { timeout: 90_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, root } = t;
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
    const { path } = await running(t);
    const first = git('rev-parse', 'HEAD');
    const runOf = async (id) => (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${id}`)).body;
    const merged = (commit) => until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.commit === commit)?.mergeCheck?.ok === true, 10_000);
    const reopenAndStart = async () => {
      assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);
      const re = await call('POST', '/api/pipeline/reopen', { path });
      assert.equal(re.status, 200, JSON.stringify(re.body));
      const go = await call('POST', '/api/pipeline/start', { path, revision: re.body.draftRevision ?? re.body.revision });
      assert.equal(go.status, 200, JSON.stringify(go.body));
      return go.body.runId;
    };

    // Run A merges api at the first commit.
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', commit: first, stage: 'done' });
    await merged(first);
    const b = await reopenAndStart();
    assert.equal((await runOf(b)).steps.api.result.commit, first);

    // Run B closes the carried api step again at a newer commit on develop.
    writeFileSync(join(root, 'api.txt'), 'fix\n');
    git('add', 'api.txt');
    git('commit', '-qm', 'fix api');
    const second = git('rev-parse', 'HEAD');
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API 다시', step: 'api', commit: second, stage: 'done' });
    await merged(second);
    const c = await reopenAndStart();
    const runC = await runOf(c);
    assert.equal(runC.steps.api.carried, b);
    assert.deepEqual(runC.steps.api.result, { commit: second, base: 'develop' });
    assert.equal(runC.steps.ui.state, 'pending');
  } finally {
    await t.stop();
  }
});

test('계획 다시 열기 logs (metadata only) when the run record cannot be read, and still reopens (E28)', { timeout: 90_000 }, async () => {
  let t = await start();
  const logged = [];
  const error = console.error;
  try {
    const { call, d, lead, root } = t;
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', commit: head, stage: 'done' });
    await until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api')?.mergeCheck?.ok === true, 10_000);
    assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);
    // Restart so the paused run is no longer in memory, then lose its record on disk.
    await t.stop();
    t = await start(t);
    const files = readdirSync(t.ws, { recursive: true }).filter((f) => f.endsWith(`${runId}.json`));
    assert.equal(files.length, 1, JSON.stringify(files));
    rmSync(join(t.ws, files[0]));

    console.error = (...a) => logged.push(a.map(String).join(' '));
    const re = await t.call('POST', '/api/pipeline/reopen', { path });
    console.error = error;
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.equal(re.body.state, 'plan');
    const line = logged.find((l) => l.startsWith('pipeline reopen record:'));
    assert.ok(line, JSON.stringify(logged));
    // Metadata only: an error code, never the plan path, run id or text.
    assert.equal(line.includes(path) || line.includes(runId), false, line);
  } finally {
    console.error = error;
    await t.stop();
  }
});

test('완료: closing every step ends the run done, writes the summary block once and labels the versions (E28)', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws, root } = t;
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const mate = (await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id })).body.sessions[0];
    // api merged at a commit on develop, ui closed without a commit (abandoned), review still open.
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, commit: head, stage: 'done' })).status, 200);
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', stage: 'done' });
    await call('POST', '/api/tasks', { lead: lead.id, title: '리뷰', step: 'review', stage: 'review' });
    assert.equal((await statusOf(call, path)).state, 'running');
    const review = d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'review');
    await call('POST', '/api/tasks', { lead: lead.id, id: review.id, commit: head, stage: 'done' });
    await until(async () => (await statusOf(call, path)).state === 'done', 10_000);
    const st = await statusOf(call, path);
    assert.ok(st.doneAt > 0);
    assert.deepEqual(st.blockers, []);

    const rec = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${runId}`)).body;
    assert.equal(rec.state, 'done');
    assert.equal(rec.steps.api.result.commit, head);
    assert.equal(rec.steps.api.result.base, 'develop');
    assert.deepEqual(rec.steps.ui.result, { abandoned: true });
    assert.equal(rec.steps.ui.state, 'skipped');

    // The summary block is first in the document, written once.
    await until(() => JSON.parse(readFileSync(join(ws, path), 'utf8')).document.content[0]?.attrs?.id === 'run-summary', 10_000);
    const file = JSON.parse(readFileSync(join(ws, path), 'utf8'));
    const text = JSON.stringify(file.document);
    assert.match(text, /✓ 완료/);
    assert.match(text, /그만둠/);
    assert.match(text, new RegExp(`develop ${head.slice(0, 7)}`));
    assert.equal(file.document.content.filter((n) => n.attrs?.id === 'run-summary').length, 1);
    // Metadata only: no session transcript text reaches the file.
    assert.doesNotMatch(text, /plan it/);

    // History: draft, approved and done versions are labelled.
    await until(async () => {
      const h = (await call('GET', `/api/history?path=${encodeURIComponent(path)}`)).body;
      return h.versions.some((v) => v.labels?.includes('done'));
    }, 10_000);
    const labels = (await call('GET', `/api/history?path=${encodeURIComponent(path)}`)).body.versions.flatMap((v) => v.labels ?? []);
    for (const l of ['draft', 'approved', 'done']) assert.ok(labels.includes(l), `label ${l}`);

    // A done plan does not run or change again.
    assert.equal((await call('POST', '/api/pipeline/start', { path, revision: file.revision })).status, 409);
    assert.equal((await call('POST', '/api/pipeline/plan', { lead: lead.id, path, goal: 'again', steps: STEPS })).status, 409);

    // 복제해서 새 계획: a fresh draft next to it, same plan, no summary, owned by the same lead.
    const dup = await call('POST', '/api/pipeline/duplicate', { path });
    assert.equal(dup.status, 200, JSON.stringify(dup.body));
    assert.notEqual(dup.body.path, path);
    assert.match(dup.body.path, /^pipelines\/.*복사.*\.dpx\.json$/);
    assert.equal(dup.body.lead, lead.id);
    const copy = JSON.parse(readFileSync(join(ws, dup.body.path), 'utf8'));
    assert.deepEqual(copy.plan, file.plan);
    assert.equal(copy.document.content.filter((n) => n.attrs?.id === 'run-summary').length, 0);
    const cst = await statusOf(call, dup.body.path);
    assert.equal(cst.state, 'plan');
    assert.deepEqual(cst.blockers, []);

    // The copy runs on its own: the first run's closed tasks (same lead, same step ids) do not finish it.
    const st2 = await call('POST', '/api/pipeline/start', { path: dup.body.path, revision: dup.body.revision });
    assert.equal(st2.status, 200, JSON.stringify(st2.body));
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API 2', step: 'api', stage: 'impl' });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await statusOf(call, dup.body.path)).state, 'running');
    for (const [title, step] of [['서버 API 2', 'api'], ['로그인 화면 2', 'ui'], ['리뷰 2', 'review']]) {
      await call('POST', '/api/tasks', { lead: lead.id, title, step, stage: 'done' });
    }
    await until(async () => (await statusOf(call, dup.body.path)).state === 'done', 10_000);
    const rec2 = (await call('GET', `/api/runs/run?path=${encodeURIComponent(dup.body.path)}&id=${st2.body.runId}`)).body;
    for (const id of ['api', 'ui', 'review']) assert.deepEqual(rec2.steps[id].result, { abandoned: true }, id);
    assert.doesNotMatch(JSON.stringify(rec2), new RegExp(head));
    assert.equal((await call('POST', '/api/pipeline/duplicate', { path: 'nope.dpx.json' })).status, 404);
    assert.equal((await call('POST', '/api/pipeline/duplicate', {})).status, 400);
  } finally {
    await t.stop();
  }
});
