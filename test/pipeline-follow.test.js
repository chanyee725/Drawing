// follow() (E206e): how a session is linked to a step of its lead's plan while a paused run's carried steps are
// still being read from disk after a restart. Unit level: fake workspace, recorder and hub, no server, no CLIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as pipeline from '../server/pipeline/index.js';

/**
 * A pipeline module on fakes. `readCarried` stays pending until `release()`; after that isCarried() answers, or,
 * with `readOk: false`, the read fails (missing or corrupt record) and isCarried() keeps answering null.
 */
async function rig(plans, tasks, { readOk = true } = {}) {
  const known = new Set();
  let release;
  const gate = new Promise((r) => (release = r));
  const updates = [];
  const reads = [];
  const recorder = {
    isCarried: (runId, step) => (runId === 'r-old' && !known.has(runId) ? null : false),
    readCarried: (_path, runId) => (reads.push(runId), gate).then(() => (readOk && known.add(runId), readOk)),
    updateSession: (runId, step, meta) => updates.push({ runId, step, cost: meta.cost }),
  };
  const sessions = {};
  const hub = Object.assign(new EventEmitter(), {
    tasks,
    get sessions() { return Object.values(sessions); },
    get: (id) => sessions[id],
    publicSession: (s) => ({ ...s }),
    limitHit: () => null,
  });
  const store = { data: { pipelines: plans }, save() {} };
  const ctx = {
    hub: { broadcast() {} },
    modules: {
      workspace: { store: { runs: { onChange: () => () => {} }, readFile: async () => null } },
      runs: { recorder },
      dispatch: { status: () => ({ enabled: true }), store, hub },
    },
  };
  const mod = await pipeline.setup(ctx);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { mod, hub, sessions, plans, updates, reads, release, settle };
}

const mate = { id: 'm1', name: 'impl-1', parent: 'lead', provider: 'claude', model: 'm', state: 'working', cost: 1 };

test('a session is not linked to a running plan while the lead\'s paused plan is still reading its run record (E206e)', async () => {
  const plans = {
    'a.drawing': { lead: 'lead', state: 'paused', approvedAt: 2, runId: 'r-old', steps: ['api'] },
    'b.drawing': { lead: 'lead', state: 'running', approvedAt: 1, runId: 'r-new', steps: ['api'] },
  };
  const t = await rig(plans, [{ lead: 'lead', step: 'api', owner: mate.name, stage: 'impl' }]);
  try {
    t.sessions[mate.id] = { ...mate };
    t.hub.emit('session', { ...mate });
    await t.settle();
    assert.equal(plans['b.drawing'].links?.[mate.id], undefined, 'linked to the other plan before the record was read');
    t.release();
    await t.settle();
    assert.equal(plans['a.drawing'].links?.[mate.id], 'api');
    assert.equal(plans['b.drawing'].links?.[mate.id], undefined);
    assert.deepEqual([...new Set(t.updates.map((u) => u.runId))], ['r-old']);
  } finally {
    t.mod.close();
  }
});

test('after the run record is read, the session is recorded as it is now, not as it was when the read began (E206e)', async () => {
  const plans = { 'a.drawing': { lead: 'lead', state: 'paused', approvedAt: 1, runId: 'r-old', steps: ['api'] } };
  const t = await rig(plans, [{ lead: 'lead', step: 'api', owner: mate.name, stage: 'impl' }]);
  try {
    t.sessions[mate.id] = { ...mate, cost: 1 };
    t.hub.emit('session', { ...mate, cost: 1 });
    await t.settle();
    // The session moves on while the record is read.
    t.sessions[mate.id] = { ...mate, cost: 2 };
    t.release();
    await t.settle();
    assert.equal(plans['a.drawing'].links?.[mate.id], 'api');
    assert.equal(t.updates.at(-1)?.cost, 2);
  } finally {
    t.mod.close();
  }
});

test('a paused plan whose run record cannot be read is skipped, so the running plan still gets the session (E206f)', async () => {
  const plans = {
    'a.drawing': { lead: 'lead', state: 'paused', approvedAt: 2, runId: 'r-old', steps: ['api'] },
    'b.drawing': { lead: 'lead', state: 'running', approvedAt: 1, runId: 'r-new', steps: ['api'] },
  };
  const t = await rig(plans, [{ lead: 'lead', step: 'api', owner: mate.name, stage: 'impl' }], { readOk: false });
  try {
    t.sessions[mate.id] = { ...mate, cost: 1 };
    t.hub.emit('session', { ...mate, cost: 1 });
    await t.settle();
    t.sessions[mate.id] = { ...mate, cost: 2 };
    t.release();
    await t.settle();
    assert.equal(plans['a.drawing'].links?.[mate.id], undefined);
    assert.equal(plans['b.drawing'].links?.[mate.id], 'api');
    assert.deepEqual(t.updates, [{ runId: 'r-new', step: 'api', cost: 2 }]);
  } finally {
    t.mod.close();
  }
});

test('a run record that failed to read is read once, not again on every later session event (E206g)', async () => {
  const plans = {
    'a.drawing': { lead: 'lead', state: 'paused', approvedAt: 2, runId: 'r-old', steps: ['api'] },
    'b.drawing': { lead: 'lead', state: 'running', approvedAt: 1, runId: 'r-new', steps: ['api'] },
  };
  const t = await rig(plans, [{ lead: 'lead', step: 'api', owner: mate.name, stage: 'impl' }], { readOk: false });
  try {
    t.sessions[mate.id] = { ...mate };
    t.release();
    t.hub.emit('session', { ...mate });
    await t.settle();
    assert.deepEqual(t.reads, ['r-old'], 'the first event reads the record once');
    for (let i = 0; i < 3; i++) {
      t.hub.emit('session', { ...mate, cost: 2 + i });
      await t.settle();
      assert.deepEqual(t.reads, ['r-old'], `event ${i + 2} read the failed record again`);
    }
    assert.equal(plans['b.drawing'].links?.[mate.id], 'api');
  } finally {
    t.mod.close();
  }
});
