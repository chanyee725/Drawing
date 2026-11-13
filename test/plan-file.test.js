// File format v4 `plan` (E18): storage, template create, tree mark and PATCH /api/file/plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { modules } from '../server/modules.js';
import { parseStored, normalizeContent } from '../server/workspace/model.js';

async function withApp(fn) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-plan-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: modules });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body, headers = { 'x-drawing': '1' }) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ ws, base, call, app });
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
}

const block = { id: 'b_pipe', type: 'flowchart', code: 'plan\nimpl\nreview\nplan > impl > review', x: 0, y: 0, w: 640, h: 400 };
const plan = {
  v: 1,
  block: 'b_pipe',
  defaults: { provider: 'claude', perm: 'acceptEdits' },
  steps: [
    { id: 'plan', node: 'plan', role: 'lead', effort: 'high' },
    { id: 'impl', node: 'impl', role: 'impl', n: 2, task: 'Implement section 2.' },
    { id: 'review', node: 'review', role: 'review', perm: 'plan', gate: 'manual' },
  ],
};
const PLAN_URL = (p) => `/api/file/plan?path=${encodeURIComponent(p)}`;

test('a plan saves, reads back clean, and a file without one stays an ordinary drawing', async () => {
  await withApp(async ({ ws, call }) => {
    await call('POST', '/api/file', { path: 'p' });
    let r = await call('PUT', '/api/file?path=p', { revision: 1, title: 'P', blocks: [block], plan: { ...plan, junk: 1 } });
    assert.equal(r.status, 200);
    r = await call('GET', '/api/file?path=p');
    assert.equal(r.body.version, 4);
    assert.deepEqual(r.body.plan, plan);
    // A save without plan removes it (the web always sends what it loaded).
    await call('PUT', '/api/file?path=p', { revision: r.body.revision, title: 'P', blocks: [block] });
    const disk = JSON.parse(await readFile(join(ws, 'p.dpx.json'), 'utf8'));
    assert.equal('plan' in disk, false);
    // Invalid plans get 400 and change nothing.
    const bad = await call('PUT', '/api/file?path=p', { revision: disk.revision, blocks: [block], plan: { ...plan, steps: [{ id: 'a', perm: 'bypassPermissions' }] } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /plan\.steps\[0\]\.perm/);
  });
});

test('a v3 file reads as is and becomes v4 with a plan; a broken stored plan is dropped on read only', () => {
  const v3 = JSON.stringify({ version: 3, title: 't', document: { type: 'doc', content: [] }, canvas: {}, blocks: [block], revision: 2 });
  const f = parseStored(v3);
  assert.equal(f.version, 3);
  assert.equal('plan' in f, false);
  const saved = normalizeContent({ ...f, plan });
  assert.equal(saved.version, 4);
  assert.deepEqual(saved.plan, plan);
  const broken = parseStored(JSON.stringify({ ...JSON.parse(v3), version: 4, plan: { v: 1, block: 'b_pipe', steps: 'nope' } }));
  assert.equal('plan' in broken, false);
  assert.deepEqual(broken.blocks, [block]);
  // A newer plan sub-format is kept verbatim.
  const newer = { v: 2, future: { x: 1 } };
  assert.deepEqual(normalizeContent({ plan: newer }).plan, newer);
});

test('create with a template, and the tree marks pipeline files', async () => {
  await withApp(async ({ call }) => {
    const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '목표' }] }] };
    let r = await call('POST', '/api/file', { path: 'pipelines/new', title: '새 파이프라인', document: doc, blocks: [block], plan });
    assert.equal(r.status, 201);
    assert.equal(r.body.revision, 1);
    assert.deepEqual(r.body.plan, plan);
    assert.deepEqual(r.body.document, doc);
    assert.equal((await call('POST', '/api/file', { path: 'bad', plan: { v: 1 } })).status, 400);
    await call('POST', '/api/file', { path: 'plain' });
    r = await call('GET', '/api/tree');
    const files = r.body.tree.flatMap((n) => (n.type === 'folder' ? n.children : [n]));
    assert.deepEqual(files.find((n) => n.path === 'pipelines/new.dpx.json').pipeline, { state: 'plan' });
    assert.equal('pipeline' in files.find((n) => n.path === 'plain.dpx.json'), false);
  });
});

test('the tree mark follows runs: running while one is live, then done or paused from the newest record', async () => {
  await withApp(async ({ call, app }) => {
    const recorder = app.ctx.modules.runs.recorder;
    await call('POST', '/api/file', { path: 'p', blocks: [block], plan });
    const mark = async () => (await call('GET', '/api/tree')).body.tree.find((n) => n.path === 'p.dpx.json').pipeline;
    assert.deepEqual(await mark(), { state: 'plan' });
    const a = await recorder.startRun({ file: 'p', plan, revision: 1 });
    assert.deepEqual(await mark(), { state: 'running' });
    await recorder.endRun(a.id, 'done');
    assert.deepEqual(await mark(), { state: 'done' });
    const b = await recorder.startRun({ file: 'p', plan, revision: 1 });
    await recorder.endRun(b.id, 'stopped');
    assert.deepEqual(await mark(), { state: 'paused' });
    const c = await recorder.startRun({ file: 'p', plan, revision: 1 });
    await recorder.endRun(c.id, 'failed');
    assert.deepEqual(await mark(), { state: 'paused' });
    // The projects view carries the same mark.
    const projects = await call('GET', '/api/workspace/projects');
    assert.ok(JSON.stringify(projects.body).includes('"pipeline":{"state":"paused"}'));
  });
});

test('tree mark and /api/runs/active agree: a finished or trashed run is not running', async () => {
  await withApp(async ({ call, app }) => {
    const recorder = app.ctx.modules.runs.recorder;
    await call('POST', '/api/file', { path: 'p', blocks: [block], plan });
    const mark = async () => (await call('GET', '/api/tree')).body.tree.find((n) => n.path === 'p.dpx.json')?.pipeline;
    const active = async () => (await call('GET', '/api/runs/active')).body.files;
    const a = await recorder.startRun({ file: 'p', plan, revision: 1 });
    assert.deepEqual(await mark(), { state: 'running' });
    assert.deepEqual(await active(), ['p.dpx.json']);
    // endRun marks the record finished before its last write; it is still in memory but no longer running.
    const ending = recorder.endRun(a.id, 'done');
    assert.notDeepEqual(await recorder.markOf('p.dpx.json'), { state: 'running' });
    assert.deepEqual(recorder.runningFiles(), []);
    await ending;
    assert.deepEqual(await mark(), { state: 'done' });
    assert.deepEqual(await active(), []);
    // A live run whose file is in the trash is not running anywhere.
    const b = await recorder.startRun({ file: 'p', plan, revision: 1 });
    await app.ctx.modules.workspace.store.removeFile('p');
    assert.notDeepEqual(await recorder.markOf('p.dpx.json'), { state: 'running' });
    assert.deepEqual(await active(), []);
    await recorder.endRun(b.id, 'stopped');
  });
});

function sseReader(base) {
  const events = [];
  const ac = new AbortController();
  (async () => {
    const res = await fetch(`${base}/api/events`, { signal: ac.signal });
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const blockText = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (/^event: workspace$/m.test(blockText)) events.push(JSON.parse(/^data: (.+)$/m.exec(blockText)[1]));
        }
      }
    } catch {}
  })();
  const waitFor = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (!events.some(pred)) {
      if (Date.now() > end) throw new Error(`timeout; got ${JSON.stringify(events)}`);
      await new Promise((r) => setTimeout(r, 30));
    }
    return events.find(pred);
  };
  return { waitFor, stop: () => ac.abort() };
}

test('PATCH /api/file/plan applies step ops, bumps the revision, keeps history and announces the change', async () => {
  await withApp(async ({ ws, base, call }) => {
    await call('POST', '/api/file', { path: 'p', blocks: [block] });
    const sse = sseReader(base);
    await new Promise((r) => setTimeout(r, 100));
    try {
      // No plan yet: a step op is refused, `plan` starts one.
      assert.equal((await call('PATCH', PLAN_URL('p'), { ops: [{ op: 'add', step: { id: 'a' } }] })).status, 400);
      let r = await call('PATCH', PLAN_URL('p'), {
        revision: 1,
        ops: [
          { op: 'plan', block: 'b_pipe', defaults: { perm: 'plan' } },
          { op: 'add', step: { id: 'impl', role: 'impl' } },
          { op: 'add', step: { id: 'plan', role: 'lead' }, before: 'impl' },
          { op: 'add', step: { id: 'review', after: ['impl'] } },
        ],
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.revision, 2);
      assert.deepEqual(r.body.plan.steps.map((s) => s.id), ['plan', 'impl', 'review']);
      assert.equal((await sse.waitFor((e) => e.path === 'p.dpx.json' && e.revision === 2)).kind, 'change');

      // set: null removes a field, a new id is renamed in `after` too and keeps the node link.
      r = await call('PATCH', PLAN_URL('p'), { ops: [{ op: 'set', id: 'impl', step: { id: 'build', role: null, n: 2 } }] });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.plan.steps[1], { id: 'build', node: 'impl', n: 2 });
      assert.deepEqual(r.body.plan.steps[2].after, ['build']);
      // remove drops the id from every `after`.
      r = await call('PATCH', PLAN_URL('p'), { ops: [{ op: 'remove', id: 'build' }] });
      assert.deepEqual(r.body.plan.steps, [{ id: 'plan', node: 'plan', role: 'lead' }, { id: 'review', node: 'review', after: [] }]);
      assert.equal(r.body.revision, 4);

      // Stale revision, bad ops, unknown step and an invalid result all leave the file alone.
      const before = await readFile(join(ws, 'p.dpx.json'), 'utf8');
      const stale = await call('PATCH', PLAN_URL('p'), { revision: 1, ops: [{ op: 'remove', id: 'plan' }] });
      assert.deepEqual([stale.status, stale.body.revision], [409, 4]);
      assert.equal((await call('PATCH', PLAN_URL('p'), { ops: [] })).status, 400);
      assert.equal((await call('PATCH', PLAN_URL('p'), { ops: [{ op: 'nuke' }] })).status, 400);
      assert.match((await call('PATCH', PLAN_URL('p'), { ops: [{ op: 'remove', id: 'ghost' }] })).body.error, /no step "ghost"/);
      assert.equal((await call('PATCH', PLAN_URL('p'), { ops: [{ op: 'add', step: { id: 'plan' } }] })).status, 400);
      assert.equal((await call('PATCH', PLAN_URL('p'), { ops: [{ op: 'set', id: 'plan', step: { perm: 'bypassPermissions' } }] })).status, 400);
      assert.equal(await readFile(join(ws, 'p.dpx.json'), 'utf8'), before);
      // Needs the write header like every other non-GET call.
      assert.equal((await call('PATCH', PLAN_URL('p'), { ops: [{ op: 'remove', id: 'plan' }] }, {})).status, 403);
      assert.equal((await call('PATCH', PLAN_URL('nope'), { ops: [{ op: 'remove', id: 'plan' }] })).status, 404);

      // Each patch kept the previous file as a version.
      assert.ok((await readdir(join(ws, '.drawing', 'history', 'p.dpx.json'))).length >= 1);
    } finally {
      sse.stop();
    }
  });
});

test('PATCH refuses files and plans from a newer version', async () => {
  await withApp(async ({ ws, call }) => {
    const head = { title: 't', document: { type: 'doc', content: [] }, canvas: {}, blocks: [block], revision: 1 };
    await writeFile(join(ws, 'newer.dpx.json'), JSON.stringify({ ...head, version: 5 }));
    await writeFile(join(ws, 'newplan.dpx.json'), JSON.stringify({ ...head, version: 4, plan: { v: 2, x: 1 } }));
    const op = { ops: [{ op: 'plan', block: 'b_pipe' }] };
    assert.equal((await call('PATCH', PLAN_URL('newer'), op)).status, 422);
    assert.equal((await call('PATCH', PLAN_URL('newplan'), op)).status, 422);
    assert.deepEqual(JSON.parse(await readFile(join(ws, 'newplan.dpx.json'), 'utf8')).plan, { v: 2, x: 1 });
  });
});
