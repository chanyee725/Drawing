import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { modules } from '../server/modules.js';
import { createStore } from '../server/workspace/store.js';

const MIN = 60 * 1000;

async function withStore(opts, fn) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-hist-'));
  let t = 1_700_000_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const store = createStore(ws, { now: clock.now, ...opts });
  try {
    await fn({ ws, store, clock });
  } finally {
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
}

// Save `title` against the file's current revision.
async function save(store, path, title) {
  const cur = await store.readFile(path);
  await store.writeFile(path, { revision: cur.revision, title });
}
const titles = async (store, path) => {
  const { versions } = await store.history(path);
  return Promise.all(versions.map(async (v) => (await store.historyVersion(path, v.id)).title));
};

test('history: at most one snapshot per file per 5 minutes', async () => {
  await withStore({}, async ({ store, clock }) => {
    await store.createFile('a');
    await save(store, 'a', 'one'); // first save always snapshots
    clock.advance(4 * MIN);
    await save(store, 'a', 'two'); // too soon
    assert.deepEqual(await titles(store, 'a'), ['one']);
    clock.advance(1 * MIN + 1);
    await save(store, 'a', 'three');
    assert.deepEqual(await titles(store, 'a'), ['three', 'one']); // newest first
    // another file has its own clock
    await store.createFile('b');
    await save(store, 'b', 'bee');
    assert.deepEqual(await titles(store, 'b'), ['bee']);
  });
});

test('history: keeps the newest 50 and drops the oldest', async () => {
  await withStore({}, async ({ store, clock, ws }) => {
    await store.createFile('a');
    for (let i = 1; i <= 55; i++) {
      await save(store, 'a', `v${i}`);
      clock.advance(6 * MIN);
    }
    const t = await titles(store, 'a');
    assert.equal(t.length, 50);
    assert.equal(t[0], 'v55');
    assert.equal(t[49], 'v6');
    assert.equal((await readdir(join(ws, '.drawing/history/a.dpx.json'))).length, 50);
  });
});

test('history: forced snapshot ignores the interval and skips identical content', async () => {
  await withStore({}, async ({ store }) => {
    await store.createFile('a');
    await save(store, 'a', 'one');
    await save(store, 'a', 'two'); // throttled
    const s1 = await store.historySnapshotNow('a');
    assert.deepEqual(await titles(store, 'a'), ['two', 'one']);
    const s2 = await store.historySnapshotNow('a'); // same content: no new snapshot
    assert.equal(s2.id, s1.id);
    assert.equal((await store.history('a')).versions.length, 2);
  });
});

test('history: hidden folder is not in the tree; move carries it, delete removes it', async () => {
  await withStore({}, async ({ store, ws }) => {
    await store.createFolder('p');
    await store.createFile('p/a');
    await save(store, 'p/a', 'one');
    assert.deepEqual((await store.tree()).map((n) => n.name), ['p']); // no .drawing
    await store.move('p/a', 'p/b', 'file');
    assert.equal((await store.history('p/a')).versions.length, 0);
    assert.deepEqual(await titles(store, 'p/b'), ['one']);
    await store.move('p', 'q', 'folder');
    assert.deepEqual(await titles(store, 'q/b'), ['one']);
    await store.removeFile('q/b');
    assert.equal((await store.history('q/b')).versions.length, 0);
    await save(store, 'q/b', 'x').catch(() => {});
    await store.createFile('q/c');
    await save(store, 'q/c', 'one');
    await store.removeFolder('q');
    assert.equal((await store.history('q/c')).versions.length, 0);
    assert.equal(await stat(join(ws, '.drawing/history/q')).then(() => true, () => false), false);
  });
});

test('history: failures never break a save', async () => {
  await withStore({}, async ({ store, ws }) => {
    await store.createFile('a');
    // `.drawing/history` is a file, so snapshots cannot be written
    await mkdir(join(ws, '.drawing'));
    await (await import('node:fs/promises')).writeFile(join(ws, '.drawing/history'), 'x');
    await save(store, 'a', 'one');
    assert.equal((await store.readFile('a')).title, 'one');
  });
});

test('history API: list, read, snapshot, traversal and bad ids are refused', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-hist-'));
  const outside = await mkdtemp(join(tmpdir(), 'draw-out-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: modules });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const f = (await call('POST', '/api/file', { path: 'a', title: 'A' })).body;
    await call('PUT', '/api/file?path=a', { ...f, title: 'A2' });
    const list = await call('GET', '/api/history?path=a');
    assert.equal(list.status, 200);
    assert.equal(list.body.versions.length, 1);
    const { id } = list.body.versions[0];
    const v = await call('GET', `/api/history/version?path=a&id=${id}`);
    assert.equal(v.body.title, 'A2');
    assert.equal((await call('POST', '/api/history?path=a', {})).status, 200);
    assert.equal((await call('GET', '/api/history/version?path=a&id=../../x')).status, 400);
    assert.equal((await call('GET', '/api/history/version?path=a&id=1234567890123')).status, 404);
    for (const p of ['../x', '/etc/passwd', '.drawing/history', 'a/../../x', '..%2Fx']) {
      assert.equal((await call('GET', `/api/history?path=${encodeURIComponent(p)}`)).status, 400, p);
    }
    assert.equal((await call('GET', '/api/history')).status, 400);
    // a symlinked .drawing pointing outside the workspace is refused
    await rm(join(ws, '.drawing'), { recursive: true, force: true });
    await symlink(outside, join(ws, '.drawing'));
    const g = (await call('POST', '/api/file', { path: 'g', title: 'G' })).body;
    await call('PUT', '/api/file?path=g', { ...g, title: 'G2' }); // save still works, snapshot is dropped
    assert.deepEqual(await readdir(outside), []);
    assert.equal((await call('POST', '/api/history?path=g', {})).status, 400);
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
