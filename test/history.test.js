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
    const t0 = (await store.readFile('a')).title;
    await save(store, 'a', 'one'); // first save keeps the file as it was
    clock.advance(4 * MIN);
    await save(store, 'a', 'two'); // too soon
    assert.deepEqual(await titles(store, 'a'), [t0]);
    clock.advance(1 * MIN + 1);
    await save(store, 'a', 'three'); // keeps what was on disk before: 'two'
    assert.deepEqual(await titles(store, 'a'), ['two', t0]); // newest first
    // another file has its own clock
    await store.createFile('b');
    const b0 = (await store.readFile('b')).title;
    await save(store, 'b', 'bee');
    assert.deepEqual(await titles(store, 'b'), [b0]);
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
    assert.equal(t[0], 'v54');
    assert.equal(t[49], 'v5');
    assert.equal((await readdir(join(ws, '.drawing/history/a.dpx.json'))).length, 50);
  });
});

test('history: forced snapshot ignores the interval and skips identical content', async () => {
  await withStore({}, async ({ store }) => {
    await store.createFile('a');
    const t0 = (await store.readFile('a')).title;
    await save(store, 'a', 'one');
    await save(store, 'a', 'two'); // throttled
    const s1 = await store.historySnapshotNow('a');
    assert.deepEqual(await titles(store, 'a'), ['two', t0]);
    const s2 = await store.historySnapshotNow('a'); // same content: no new snapshot
    assert.equal(s2.id, s1.id);
    assert.equal((await store.history('a')).versions.length, 2);
  });
});

test('history: hidden folder is not in the tree; move carries it, delete moves it to the trash', async () => {
  await withStore({}, async ({ store, ws }) => {
    await store.createFolder('p');
    await store.createFile('p/a');
    const t0 = (await store.readFile('p/a')).title;
    await save(store, 'p/a', 'one');
    assert.deepEqual((await store.tree()).map((n) => n.name), ['p']); // no .drawing
    await store.move('p/a', 'p/b', 'file');
    assert.equal((await store.history('p/a')).versions.length, 0);
    assert.deepEqual(await titles(store, 'p/b'), [t0]);
    await store.move('p', 'q', 'folder');
    assert.deepEqual(await titles(store, 'q/b'), [t0]);
    await store.removeFile('q/b');
    assert.equal((await store.history('q/b')).versions.length, 0); // not inherited by a new file at that path
    assert.equal((await store.trash()).items.filter((i) => i.path === 'q/b.dpx.json').length, 1);
    await save(store, 'q/b', 'x').catch(() => {});
    await store.createFile('q/c');
    await save(store, 'q/c', 'one');
    await store.removeFolder('q');
    assert.equal((await store.history('q/c')).versions.length, 0);
    assert.equal(await stat(join(ws, '.drawing/history/q')).then(() => true, () => false), false);
    assert.ok((await store.trash()).items.some((i) => i.path === 'q/c.dpx.json'));
  });
});

const trashPaths = async (store) => (await store.trash()).items.map((i) => i.path);
const DAY = 24 * 60 * MIN;

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

test('trash: a trash that cannot be written never breaks a delete', async () => {
  await withStore({}, async ({ store, ws }) => {
    await store.createFile('a');
    // `.drawing/trash` is a file, so the deleted file cannot be kept, but the delete itself still succeeds
    await mkdir(join(ws, '.drawing'), { recursive: true });
    await (await import('node:fs/promises')).writeFile(join(ws, '.drawing/trash'), 'x');
    await store.removeFile('a');
    assert.equal((await store.tree()).some((n) => n.path === 'a.dpx.json'), false);
  });
});

test('trash: a deleted file is listed, restorable with its history, and purged after 30 days', async () => {
  await withStore({}, async ({ store, clock }) => {
    await store.createFile('a');
    const t0 = (await store.readFile('a')).title;
    await save(store, 'a', 'one');
    await save(store, 'a', 'two');
    await store.removeFile('a');
    const { items } = await store.trash();
    assert.deepEqual(items.map((i) => i.path), ['a.dpx.json']);
    assert.equal(items[0].deletedAt, clock.now());
    // a new file at the same path does not inherit the history
    await store.createFile('a');
    assert.equal((await store.history('a')).versions.length, 0);
    await assert.rejects(store.restoreTrash(items[0].id), { status: 409 });
    await store.removeFile('a');
    const id = (await store.trash()).items.find((i) => i.id === items[0].id).id;
    await store.restoreTrash(id);
    const back = await store.readFile('a');
    assert.equal(back.title, 'two');
    assert.deepEqual(await titles(store, 'a'), [t0]); // one snapshot per 5 minutes
    assert.ok((await store.trash()).items.every((i) => i.id !== id));
    // 30 days later the rest is gone
    await store.removeFile('a');
    assert.equal((await store.trash()).items.length >= 1, true);
    clock.advance(30 * DAY + 1);
    assert.deepEqual((await store.trash()).items, []);
  });
});

test('trash: deleting a folder keeps each file; restore recreates the folder', async () => {
  await withStore({}, async ({ store }) => {
    await store.createFolder('p/q');
    await store.createFile('p/q/a');
    await store.createFile('p/b');
    await store.removeFolder('p');
    assert.deepEqual((await trashPaths(store)).sort(), ['p/b.dpx.json', 'p/q/a.dpx.json']);
    const item = (await store.trash()).items.find((i) => i.path === 'p/q/a.dpx.json');
    await store.restoreTrash(item.id);
    assert.equal((await store.readFile('p/q/a')).title, 'a');
    assert.deepEqual(await trashPaths(store), ['p/b.dpx.json']);
    await assert.rejects(store.restoreTrash('nope'), { status: 400 });
    await assert.rejects(store.restoreTrash('1234567890123-deadbeef'), { status: 404 });
  });
});

test('trash: deleting a folder of 205 files keeps all of them restorable; the next ordinary delete trims to the cap', async () => {
  await withStore({}, async ({ store }) => {
    await store.createFolder('big');
    for (let i = 0; i < 205; i++) await store.createFile(`big/f${i}`);
    await store.removeFolder('big');
    assert.equal((await store.trash()).items.length, 205); // listing does not trim
    for (const item of (await store.trash()).items) await store.restoreTrash(item.id);
    assert.equal((await store.trash()).items.length, 0);
    for (let i = 0; i < 205; i++) await store.readFile(`big/f${i}`); // exists again
    // the ordinary cap still holds for single deletes
    await store.removeFolder('big');
    await store.createFile('x');
    await store.removeFile('x');
    assert.equal((await store.trash()).items.length, 200);
  });
});

test('trash: a stale tab holding the pre-delete revision gets 409 after restore', async () => {
  await withStore({}, async ({ store }) => {
    await store.createFile('a');
    const stale = (await store.readFile('a')).revision;
    await store.removeFile('a');
    await store.restoreTrash((await store.trash()).items[0].id);
    await assert.rejects(store.writeFile('a', { revision: stale, title: 'late' }), { status: 409 });
  });
});

test('trash: a file deleted outside the app (watcher) hands its history to the trash, not to a new file', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-hist-'));
  let fire;
  const changes = [];
  const store = createStore(ws, {
    watchDebounceMs: 0,
    watchFn: (_d, _o, cb) => ((fire = cb), { on() {}, close() {} }),
    onExternalChange: (c) => changes.push(c),
  });
  try {
    await store.createFile('a');
    await save(store, 'a', 'one');
    await store.startWatching();
    await rm(join(ws, 'a.dpx.json'));
    fire('change', 'a.dpx.json');
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(changes.some((c) => c.kind === 'delete'));
    await store.createFile('a');
    assert.equal((await store.history('a')).versions.length, 0);
    assert.deepEqual(await trashPaths(store), ['a.dpx.json']);
  } finally {
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
});

test('history: a snapshot that is a symlink is not read', async () => {
  await withStore({}, async ({ store, ws }) => {
    await store.createFile('a');
    await save(store, 'a', 'one');
    const { versions } = await store.history('a');
    const snap = join(ws, '.drawing/history/a.dpx.json', `${versions[0].id}.json`);
    const outside = await mkdtemp(join(tmpdir(), 'draw-out-'));
    try {
      await rm(snap);
      await symlink(join(ws, 'a.dpx.json'), snap);
      await assert.rejects(store.historyVersion('a', versions[0].id), { status: 404 });
      assert.equal((await store.history('a')).versions.length, 0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('trash API: list and restore over HTTP', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-hist-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: modules });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    await call('POST', '/api/file', { path: 'a', title: 'A' });
    assert.equal((await call('DELETE', '/api/file?path=a')).status, 200);
    const list = await call('GET', '/api/trash');
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].path, 'a.dpx.json');
    assert.equal((await call('POST', '/api/trash/restore', {})).status, 400);
    assert.equal((await call('POST', '/api/trash/restore', { id: '../x' })).status, 400);
    assert.equal((await call('POST', '/api/trash/restore', { id: list.body.items[0].id })).status, 200);
    assert.equal((await call('GET', '/api/file?path=a')).body.title, 'A');
    assert.deepEqual((await call('GET', '/api/trash')).body.items, []);
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
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
    assert.equal(v.body.title, 'A'); // the file as it was before the save
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

test('history: the state at the end of an edit session is kept (snapshot the file before it is overwritten)', async () => {
  await withStore({}, async ({ store, clock }) => {
    await store.createFile('a');
    await save(store, 'a', 'C1');
    clock.advance(1 * MIN);
    await save(store, 'a', 'C2');
    clock.advance(1 * MIN);
    await save(store, 'a', 'C4-session-end');
    clock.advance(24 * 60 * MIN);
    await save(store, 'a', 'C5-next-day');
    assert.ok((await titles(store, 'a')).includes('C4-session-end'));
  });
});
