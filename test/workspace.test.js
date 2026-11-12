import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat, chmod } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { modules } from '../server/modules.js';
import { newFile } from '../server/workspace/model.js';
import { createStore } from '../server/workspace/store.js';

async function withApp(fn) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const outside = await mkdtemp(join(tmpdir(), 'draw-out-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: modules });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ ws, outside, base, call, app });
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

const q = (p) => encodeURIComponent(p);

test('CRUD: create, read, list, rename, move, delete files and folders', async () => {
  await withApp(async ({ call }) => {
    let r = await call('POST', '/api/folder', { path: 'proj' });
    assert.equal(r.status, 201);
    r = await call('POST', '/api/file', { path: 'proj/arch', title: 'Arch' });
    assert.equal(r.status, 201);
    assert.equal(r.body.path, 'proj/arch.dpx.json');
    assert.deepEqual(
      { v: r.body.version, t: r.body.title, rev: r.body.revision, doc: r.body.document, canvas: r.body.canvas, blocks: r.body.blocks },
      { v: 3, t: 'Arch', rev: 1, doc: { type: 'doc', content: [] }, canvas: { elements: [], appState: {} }, blocks: [] },
    );
    assert.equal((await call('POST', '/api/file', { path: 'proj/arch' })).status, 409);
    assert.equal((await call('POST', '/api/folder', { path: 'proj' })).status, 409);

    r = await call('GET', `/api/file?path=${q('proj/arch.dpx.json')}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.title, 'Arch');
    assert.equal((await call('GET', `/api/file?path=${q('proj/arch')}`)).status, 200); // extension optional

    r = await call('GET', '/api/tree');
    assert.equal(r.body.tree.length, 1);
    assert.equal(r.body.tree[0].type, 'folder');
    assert.equal(r.body.tree[0].children[0].path, 'proj/arch.dpx.json');
    assert.equal(r.body.tree[0].children[0].title, 'Arch');

    r = await call('POST', '/api/move', { from: 'proj/arch.dpx.json', to: 'proj/renamed' });
    assert.equal(r.body.path, 'proj/renamed.dpx.json');
    r = await call('POST', '/api/move', { from: 'proj/renamed.dpx.json', to: 'other/deep/renamed.dpx.json' });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', `/api/file?path=${q('other/deep/renamed')}`)).body.revision, 1);
    r = await call('POST', '/api/move', { from: 'other', to: 'moved' });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', `/api/file?path=${q('moved/deep/renamed')}`)).status, 200);
    assert.equal((await call('POST', '/api/move', { from: 'moved', to: 'moved/inside' })).status, 400);
    await call('POST', '/api/file', { path: 'x' });
    assert.equal((await call('POST', '/api/move', { from: 'x', to: 'moved/deep/renamed' })).status, 409);

    assert.equal((await call('DELETE', `/api/file?path=${q('moved/deep/renamed.dpx.json')}`)).status, 200);
    assert.equal((await call('GET', `/api/file?path=${q('moved/deep/renamed')}`)).status, 404);
    assert.equal((await call('DELETE', `/api/folder?path=${q('moved')}`)).status, 200);
    assert.equal((await call('DELETE', `/api/folder?path=${q('moved')}`)).status, 404);
    r = await call('GET', '/api/tree');
    assert.deepEqual(r.body.tree.map((n) => n.path).sort(), ['proj', 'x.dpx.json']);
  });
});

test('write: whole-file save bumps revision and keeps content; stale write gets 409', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const content = {
      title: 'T',
      document: { type: 'doc', content: [{ type: 'paragraph' }] },
      canvas: { elements: [{ id: 'e1', type: 'rectangle' }], appState: { zoom: 2 } },
      blocks: [{ id: 'b1', type: 'flowchart', code: 'a > b', x: 1, y: 2, w: 300, h: 200 }],
    };
    let r = await call('PUT', `/api/file?path=${q('a')}`, { ...content, revision: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { path: 'a.dpx.json', revision: 2 });
    r = await call('GET', `/api/file?path=${q('a')}`);
    assert.deepEqual({ ...r.body, path: undefined }, { ...content, path: undefined, version: 3, revision: 2 });

    // a second client still holding revision 1 is rejected and told the current revision
    r = await call('PUT', `/api/file?path=${q('a')}`, { ...content, title: 'stale', revision: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.revision, 2);
    assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'T');

    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { ...content })).status, 400); // no revision
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { ...content, revision: 2, blocks: [{ id: 'x' }] })).status, 400);
    assert.equal((await call('PUT', `/api/file?path=${q('missing')}`, { ...content, revision: 1 })).status, 404);
  });
});

test('write: concurrent saves with the same revision let exactly one win', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) => call('PUT', `/api/file?path=${q('a')}`, { title: `t${i}`, revision: 1 })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409]);
  });
});

test('write is atomic: no temp files left, content is always complete JSON', async () => {
  await withApp(async ({ ws, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const big = { title: 'big', canvas: { elements: Array.from({ length: 20000 }, (_, i) => ({ id: i })), appState: {} } };
    let rev = 1;
    const reader = (async () => {
      for (let i = 0; i < 30; i++) {
        JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8')); // would throw on a torn write
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    for (let i = 0; i < 10; i++) rev = (await call('PUT', `/api/file?path=${q('a')}`, { ...big, revision: rev })).body.revision;
    await reader;
    assert.deepEqual(await readdir(ws), ['a.dpx.json']);

    // a failed write (stale) leaves the file untouched and no temp file behind
    const before = await readFile(join(ws, 'a.dpx.json'), 'utf8');
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { title: 'x', revision: 1 })).status, 409);
    assert.equal(await readFile(join(ws, 'a.dpx.json'), 'utf8'), before);
    assert.deepEqual(await readdir(ws), ['a.dpx.json']);
  });
});

test('path traversal, absolute paths, hidden names and symlink escapes are refused', async () => {
  await withApp(async ({ ws, outside, call }) => {
    await writeFile(join(outside, 'secret.dpx.json'), '{}');
    await symlink(outside, join(ws, 'link'));
    await symlink(join(outside, 'secret.dpx.json'), join(ws, 'file-link.dpx.json'));
    const bad = [
      '../x', 'a/../../x', '..', '/etc/passwd', '/tmp/x', 'a//b', './a', 'a/./b', '.hidden', 'a/.git/x',
      'a\\b', '..%2f..%2fx', 'C:/x', 'a\0b', 'link/secret', 'link/new', 'file-link.dpx.json',
    ];
    for (const p of bad) {
      for (const [m, url, body] of [
        ['GET', `/api/file?path=${q(p)}`],
        ['PUT', `/api/file?path=${q(p)}`, { revision: 1 }],
        ['POST', '/api/file', { path: p }],
        ['POST', '/api/folder', { path: p }],
        ['DELETE', `/api/file?path=${q(p)}`],
        ['POST', '/api/move', { from: p, to: 'ok' }],
        ['POST', '/api/move', { from: 'ok', to: p }],
      ]) {
        const r = await call(m, url, body);
        assert.ok([400, 404].includes(r.status), `${m} ${url} ${JSON.stringify(p)} -> ${r.status}`);
      }
    }
    // nothing was created or touched outside
    assert.deepEqual(await readdir(outside), ['secret.dpx.json']);
    assert.equal(await readFile(join(outside, 'secret.dpx.json'), 'utf8'), '{}');
    // symlinks are not listed
    const tree = (await call('GET', '/api/tree')).body.tree;
    assert.deepEqual(tree, []);
  });
});

test('API hardening: JSON content-type required, bad JSON rejected, no path leak in errors', async () => {
  await withApp(async ({ base, ws }) => {
    let res = await fetch(`${base}/api/folder`, { method: 'POST', body: '{"path":"x"}' });
    assert.equal(res.status, 415);
    res = await fetch(`${base}/api/folder`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(res.status, 400);
    assert.deepEqual(await readdir(ws), []);
    res = await fetch(`${base}/api/file?path=nope`);
    assert.ok(!(await res.text()).includes(ws));
  });
});

// ---- external changes ----

function sseReader(base) {
  const events = [];
  const ac = new AbortController();
  const waiters = [];
  const done = (async () => {
    const res = await fetch(`${base}/api/events`, { signal: ac.signal });
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev === 'workspace') {
            events.push(JSON.parse(data));
            waiters.splice(0).forEach((w) => w());
          }
        }
      }
    } catch {}
  })();
  const waitFor = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (!events.some(pred)) {
      if (Date.now() > end) throw new Error(`timeout; got ${JSON.stringify(events)}`);
      await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
    }
    return events.find(pred);
  };
  return { events, waitFor, stop: () => { ac.abort(); return done; } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('external edits emit a workspace SSE event; our own saves and creates do not', async () => {
  await withApp(async ({ ws, base, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const sse = sseReader(base);
    await sleep(100); // let the stream attach
    try {
      // our own operations: silent
      await call('PUT', `/api/file?path=${q('a')}`, { title: 'mine', revision: 1 });
      await call('POST', '/api/file', { path: 'b' });
      await call('POST', '/api/folder', { path: 'dir' });
      await sleep(400);
      assert.deepEqual(sse.events, []);

      // moves and deletes through the API tell other tabs
      await call('POST', '/api/move', { from: 'b', to: 'dir/b' });
      assert.equal((await sse.waitFor((e) => e.path === 'dir/b.dpx.json')).kind, 'tree');
      await call('DELETE', `/api/file?path=${q('dir/b')}`);
      assert.equal((await sse.waitFor((e) => e.path === 'dir/b.dpx.json' && e.kind === 'delete')).kind, 'delete');
      await call('POST', '/api/folder', { path: 'tmpdir' });
      await call('DELETE', `/api/folder?path=${q('tmpdir')}`);
      // `from` is set so a tab with a file under the folder open closes it
      assert.equal((await sse.waitFor((e) => e.path === 'tmpdir' && e.kind === 'tree')).from, 'tmpdir');
      await sleep(400); // the watcher then sees nothing new
      sse.events.length = 0;

      // outside edit of an existing file
      const cur = JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8'));
      await writeFile(join(ws, 'a.dpx.json'), JSON.stringify({ ...cur, title: 'outside', revision: cur.revision + 1 }));
      const ev = await sse.waitFor((e) => e.path === 'a.dpx.json');
      assert.equal(ev.kind, 'change');
      assert.equal(ev.revision, 3);

      // outside create and delete
      await writeFile(join(ws, 'new.dpx.json'), JSON.stringify({ ...cur, revision: 1 }));
      assert.equal((await sse.waitFor((e) => e.path === 'new.dpx.json')).kind, 'create');
      await rm(join(ws, 'new.dpx.json'));
      await sse.waitFor((e) => e.path === 'new.dpx.json' && e.kind === 'delete');

      // outside folder
      await mkdir(join(ws, 'outdir'));
      await sse.waitFor((e) => e.path === 'outdir' && e.kind === 'tree');

      // the changed file reads back with the outside content
      assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'outside');
    } finally {
      await sse.stop();
    }
  });
});

test('unreadable files show in the tree but cannot be read (422)', async () => {
  await withApp(async ({ ws, call }) => {
    await writeFile(join(ws, 'broken.dpx.json'), 'not json');
    await writeFile(join(ws, 'notes.txt'), 'ignored');
    const r = await call('GET', '/api/tree');
    assert.deepEqual(r.body.tree.map((n) => n.name), ['broken.dpx.json']);
    assert.equal((await call('GET', `/api/file?path=${q('broken')}`)).status, 422);
    assert.ok((await stat(join(ws, 'notes.txt'))).isFile());
  });
});

test('DELETE /api/file without extension never removes a same-named folder; kinds do not cross', async () => {
  await withApp(async ({ ws, call }) => {
    await call('POST', '/api/folder', { path: 'sub' });
    await call('POST', '/api/file', { path: 'sub/inner' });
    assert.equal((await call('DELETE', `/api/file?path=${q('sub')}`)).status, 404);
    assert.equal((await call('GET', `/api/file?path=${q('sub/inner')}`)).status, 200);
    assert.equal((await call('DELETE', `/api/file?path=${q('sub/inner')}`)).status, 200); // extension optional for files
    await call('POST', '/api/file', { path: 'f' });
    assert.equal((await call('DELETE', `/api/folder?path=${q('f.dpx.json')}`)).status, 404); // folder route never deletes a file
    assert.equal((await call('DELETE', `/api/folder?path=${q('f')}`)).status, 404);
    assert.ok((await stat(join(ws, 'f.dpx.json'))).isFile());
    assert.ok((await stat(join(ws, 'sub'))).isDirectory());
    assert.equal((await call('DELETE', `/api/folder?path=${q('sub')}`)).status, 200);
  });
});

test('move: file wins over a same-named folder unless type says folder', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/folder', { path: 'sub' });
    await call('POST', '/api/file', { path: 'sub/inner' });
    await call('POST', '/api/file', { path: 'sub' }); // sub.dpx.json next to folder sub/
    let r = await call('POST', '/api/move', { from: 'sub', to: 'renamed' });
    assert.equal(r.body.path, 'renamed.dpx.json');
    assert.equal((await call('GET', `/api/file?path=${q('sub/inner')}`)).status, 200); // folder untouched
    r = await call('POST', '/api/move', { from: 'sub', to: 'folder2', type: 'folder' });
    assert.equal(r.body.path, 'folder2');
    assert.equal((await call('GET', `/api/file?path=${q('folder2/inner')}`)).status, 200);
    assert.equal((await call('POST', '/api/move', { from: 'folder2', to: 'x', type: 'file' })).status, 404);
    assert.equal((await call('POST', '/api/move', { from: 'folder2', to: 'x', type: 'bogus' })).status, 400);
  });
});

test('outside edit that keeps the revision: old-revision PUT is 409, GET then PUT works, SSE carries the raised revision', async () => {
  await withApp(async ({ ws, base, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const sse = sseReader(base);
    await sleep(100);
    try {
      const cur = JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8'));
      await writeFile(join(ws, 'a.dpx.json'), JSON.stringify({ ...cur, title: 'outside' })); // revision untouched
      const ev = await sse.waitFor((e) => e.path === 'a.dpx.json');
      assert.equal(ev.kind, 'change');
      assert.equal(ev.revision, 2);

      let r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale client', revision: 1 });
      assert.equal(r.status, 409);
      assert.equal(r.body.revision, 2);
      r = await call('GET', `/api/file?path=${q('a')}`);
      assert.equal(r.body.title, 'outside');
      assert.equal(r.body.revision, 2);
      r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'merged', revision: 2 });
      assert.equal(r.status, 200);
      assert.equal(r.body.revision, 3);
    } finally {
      await sse.stop();
    }
  });
});

test('outside edit seen first by PUT (no watcher event yet) still cannot be overwritten', async () => {
  await withApp(async ({ ws, call, app }) => {
    await call('POST', '/api/file', { path: 'a' });
    const cur = JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8'));
    await writeFile(join(ws, 'a.dpx.json'), JSON.stringify({ ...cur, title: 'outside' }));
    const r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale client', revision: 1 });
    assert.equal(r.status, 409);
    assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'outside');
  });
});

test('outside save of broken JSON then valid JSON with the same revision: old-revision PUT is 409', async () => {
  await withApp(async ({ ws, base, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { title: 'mine', revision: 1 })).body.revision, 2);
    const cur = JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8'));
    const sse = sseReader(base);
    await sleep(100);
    try {
      await writeFile(join(ws, 'a.dpx.json'), '{ broken');
      await sse.waitFor((e) => e.path === 'a.dpx.json' && e.revision === null);
      await writeFile(join(ws, 'a.dpx.json'), JSON.stringify({ ...cur, title: 'outside' })); // still revision 2
      const ev = await sse.waitFor((e) => e.path === 'a.dpx.json' && e.revision !== null);
      assert.equal(ev.revision, 3);

      const r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale client', revision: 2 });
      assert.equal(r.status, 409);
      assert.equal(r.body.revision, 3);
      assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'outside');
    } finally {
      await sse.stop();
    }
  });
});

test('deleted then recreated file starts above the old revision; old-revision PUT is 409', async () => {
  await withApp(async ({ ws, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    await call('PUT', `/api/file?path=${q('a')}`, { title: 'v2', revision: 1 });
    await call('PUT', `/api/file?path=${q('a')}`, { title: 'v3', revision: 2 });
    assert.equal((await call('DELETE', `/api/file?path=${q('a')}`)).status, 200);

    // recreated through the API
    let r = await call('POST', '/api/file', { path: 'a' });
    assert.equal(r.body.revision, 4);
    r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale', revision: 3 });
    assert.equal(r.status, 409);
    assert.equal(r.body.revision, 4);

    // recreated from outside with a low revision
    assert.equal((await call('DELETE', `/api/file?path=${q('a')}`)).status, 200);
    await writeFile(join(ws, 'a.dpx.json'), JSON.stringify(newFile({ title: 'outside' }))); // revision 1
    r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale', revision: 4 });
    assert.equal(r.status, 409);
    assert.equal(r.body.revision, 5);
    assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'outside');

    // another file moved onto the path
    assert.equal((await call('DELETE', `/api/file?path=${q('a')}`)).status, 200);
    await call('POST', '/api/file', { path: 'b' });
    assert.equal((await call('POST', '/api/move', { from: 'b', to: 'a' })).status, 200);
    r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale', revision: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.revision, 6);
  });
});

// Store without a watcher: a recursive fs.watch would itself trip over the unreadable folder.
test('tree skips entries it cannot stat instead of failing', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const store = createStore(ws);
  try {
    await store.createFile('ok');
    await mkdir(join(ws, 'locked'));
    await writeFile(join(ws, 'locked', 'x.dpx.json'), '{}');
    await chmod(join(ws, 'locked'), 0o444); // names listable (readdir), entries not stat-able
    const tree = await store.tree();
    assert.deepEqual(tree.find((n) => n.path === 'locked').children, []);
    assert.ok(tree.some((n) => n.path === 'ok.dpx.json'));
  } finally {
    await chmod(join(ws, 'locked'), 0o755).catch(() => {});
    await rm(ws, { recursive: true, force: true });
  }
});

test('folders cannot be named like diagram files', async () => {
  await withApp(async ({ ws, call }) => {
    assert.equal((await call('POST', '/api/folder', { path: 'x.dpx.json' })).status, 400);
    assert.equal((await call('POST', '/api/folder', { path: 'p/x.dpx.json/q' })).status, 400);
    assert.deepEqual(await readdir(ws), []);
    assert.equal((await call('POST', '/api/folder', { path: 'p/x.dpx' })).status, 201);
  });
});

test('fs errors become 4xx, and neither response nor server log contains absolute paths', async () => {
  await withApp(async ({ ws, call }) => {
    const logged = [];
    const orig = console.error;
    console.error = (...a) => logged.push(a.join(' '));
    try {
      await call('POST', '/api/file', { path: 'sub.dpx.json' }); // a file named like this makes "sub.dpx.json/child" an ENOTDIR case
      const r = await call('POST', '/api/file', { path: 'sub.dpx.json/child' });
      assert.ok(r.status >= 400 && r.status < 500, `status ${r.status}`);
      for (const [m, url, body] of [
        ['POST', '/api/folder', { path: 'sub.dpx.json/deeper' }],
        ['POST', '/api/move', { from: 'sub', to: 'sub.dpx.json/x' }],
        ['GET', `/api/file?path=${q('sub.dpx.json/child')}`],
        ['PUT', `/api/file?path=${q('sub.dpx.json/child')}`, { revision: 1 }],
        ['DELETE', `/api/folder?path=${q('sub.dpx.json/child')}`],
      ]) {
        const x = await call(m, url, body);
        assert.ok(x.status >= 400 && x.status < 500, `${m} ${url} -> ${x.status}`);
        assert.ok(!JSON.stringify(x.body).includes(ws));
      }
      assert.ok(!JSON.stringify(r.body).includes(ws));
    } finally {
      console.error = orig;
    }
    assert.ok(!logged.join('\n').includes(ws), logged.join('\n'));
  });
});

test('app logs only the error kind for unexpected 500s', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const boom = { name: 'boom', setup: async () => ({ routes: [{ method: 'GET', path: '/api/boom', handler: () => { throw Object.assign(new Error(`lstat '${ws}/x'`), { code: 'EBOOM' }); } }] }) };
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: [boom] });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const res = await fetch(`http://127.0.0.1:${app.server.address().port}/api/boom`);
    assert.equal(res.status, 500);
  } finally {
    console.error = orig;
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
  assert.ok(logged.length > 0);
  assert.ok(!logged.join('\n').includes(ws));
});

test('no folder can be named like a file: create, move and parent segments are all refused', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/folder', { path: 'a' });
    await call('POST', '/api/file', { path: 'f' });
    assert.equal((await call('POST', '/api/folder', { path: 'q.dpx.json/z' })).status, 400);
    assert.equal((await call('POST', '/api/folder', { path: 'a/q.dpx.json' })).status, 400);
    assert.equal((await call('POST', '/api/file', { path: 'q.dpx.json/z' })).status, 400);
    assert.equal((await call('POST', '/api/move', { from: 'a', to: 'y.dpx.json', type: 'folder' })).status, 400);
    assert.equal((await call('POST', '/api/move', { from: 'a', to: 'x/y.dpx.json/a', type: 'folder' })).status, 400);
    assert.equal((await call('POST', '/api/move', { from: 'f', to: 'y.dpx.json/f' })).status, 400);
    const r = await call('GET', '/api/tree');
    assert.deepEqual(r.body.tree.map((n) => n.path).sort(), ['a', 'f.dpx.json']);
  });
});

test('block layout: valid layouts round-trip, unknown fields are dropped, bad ones get 400', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const blk = { id: 'b1', type: 'architecture', code: 'A > B', x: 0, y: 0, w: 10, h: 10 };
    const layout = {
      v: 1,
      basis: { type: 'architecture', direction: 'right', count: 2 },
      items: { A: { cx: 1.5, cy: -2, parent: '' }, B: { cx: 3, cy: 4, parent: 'VPC' } },
    };
    const put = (b, revision) => call('PUT', `/api/file?path=${q('a')}`, { revision, blocks: [b] });
    let r = await put({ ...blk, layout: { ...layout, junk: 1, items: { ...layout.items, A: { ...layout.items.A, extra: 1 } } } }, 1);
    assert.equal(r.status, 200);
    assert.deepEqual((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].layout, layout);
    // no layout stays absent
    r = await put(blk, 2);
    assert.equal('layout' in (await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0], false);
    const bad = [
      null, 'x', [], {}, { v: 0 }, { v: 1.5 }, { v: 1, items: [] },
      { v: 1, items: { A: { cx: 'x', cy: 0, parent: '' } } },
      { v: 1, items: { A: { cx: 0, cy: null, parent: '' } } },
      { v: 1, items: { A: { cx: 0, cy: 0 } } },
      { v: 1, items: { '': { cx: 0, cy: 0, parent: '' } } },
      { v: 1, items: { ['k'.repeat(201)]: { cx: 0, cy: 0, parent: '' } } },
      { v: 1, basis: { type: 'a', direction: 'right', count: -1 } },
      { v: 1, basis: { type: 'a', count: 1 } },
      JSON.parse('{"v":1,"items":{"__proto__":{"cx":0,"cy":0,"parent":""}}}'),
      { v: 1, items: { A: { cx: 0, cy: 0, parent: 'p'.repeat(201) } } },
      { v: 1, basis: { type: 't'.repeat(201), direction: 'right', count: 1 } },
      { v: 1, basis: { type: 'a', direction: 'd'.repeat(201), count: 1 } },
    ];
    let rev = 3;
    for (const l of bad) {
      assert.equal((await put({ ...blk, layout: l }, rev)).status, 400, JSON.stringify(l));
    }
    const many = {};
    for (let i = 0; i < 2001; i++) many[`n${i}`] = { cx: 0, cy: 0, parent: '' };
    assert.equal((await put({ ...blk, layout: { v: 1, items: many } }, rev)).status, 400);
  });
});

test('block layout: 200-character names are the limit and a "__proto__" key is refused by name', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const blk = { id: 'b1', type: 'architecture', code: 'A', x: 0, y: 0, w: 10, h: 10 };
    const n = 'n'.repeat(200);
    const layout = { v: 1, basis: { type: 't'.repeat(200), direction: 'd'.repeat(200), count: 1 }, items: { [n]: { cx: 0, cy: 0, parent: 'p'.repeat(200) } } };
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { revision: 1, blocks: [{ ...blk, layout }] })).status, 200);
    assert.deepEqual((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].layout, layout);
    const proto = JSON.parse('{"v":1,"items":{"__proto__":{"cx":0,"cy":0,"parent":""}}}');
    const r = await call('PUT', `/api/file?path=${q('a')}`, { revision: 2, blocks: [{ ...blk, layout: proto }] });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /__proto__/);
  });
});

test('block layout: a layout with a newer sub-format version is kept verbatim', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const layout = { v: 2, items: { A: { x: 1 } }, shape: ['new'] };
    const blk = { id: 'b1', type: 'flowchart', code: 'a', x: 0, y: 0, w: 1, h: 1, layout };
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { revision: 1, blocks: [blk] })).status, 200);
    assert.deepEqual((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].layout, layout);
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { revision: 2, blocks: [{ ...blk, layout: { v: 2.5 } }] })).status, 400);
  });
});

test('a stored file with a broken layout still reads; only that layout is dropped', async () => {
  const { parseStored } = await import('../server/workspace/model.js');
  const blk = { id: 'b1', type: 'flowchart', code: 'a', x: 0, y: 0, w: 1, h: 1 };
  const text = JSON.stringify({ version: 3, title: 't', document: { type: 'doc', content: [] }, canvas: {}, revision: 2,
    blocks: [{ ...blk, layout: { v: 1, items: { A: { cx: 'oops' } } } }, { ...blk, id: 'b2', layout: { v: 1, items: { B: { cx: 1, cy: 2, parent: '' } } } }] });
  const f = parseStored(text);
  assert.equal('layout' in f.blocks[0], false);
  assert.deepEqual(f.blocks[1].layout, { v: 1, items: { B: { cx: 1, cy: 2, parent: '' } } });
});

test('a v2 file reads as is and its next save is stored as v3 with a layout', async () => {
  const { parseStored, normalizeContent, FORMAT_VERSION } = await import('../server/workspace/model.js');
  const blk = { id: 'b1', type: 'flowchart', code: 'a', x: 0, y: 0, w: 1, h: 1 };
  const v2 = JSON.stringify({ version: 2, title: 't', document: { type: 'doc', content: [] }, canvas: {}, revision: 4, blocks: [blk] });
  const f = parseStored(v2);
  assert.equal(f.version, 2);
  assert.equal('layout' in f.blocks[0], false);
  const layout = { v: 1, basis: { type: 'flowchart', direction: 'right', count: 1 }, items: { a: { cx: 1, cy: 2, parent: '' } } };
  const saved = normalizeContent({ ...f, blocks: [{ ...f.blocks[0], layout }] });
  assert.equal(saved.version, FORMAT_VERSION);
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.blocks[0].layout, layout);
});

test('a file reads back with the version it was written with; a write stores the current one', async () => {
  const { parseStored, normalizeContent, FORMAT_VERSION } = await import('../server/workspace/model.js');
  const old = JSON.stringify({ version: 1, title: 'old', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 3 });
  assert.equal(parseStored(old).version, 1);
  assert.equal(parseStored(JSON.stringify({ title: 'x', revision: 1 })).version, 1);
  assert.equal(normalizeContent({ version: 1 }).version, FORMAT_VERSION);
  assert.equal(FORMAT_VERSION, 3);
});

test('a file written with a newer format version is not overwritten as version 3', async () => {
  await withApp(async ({ ws, call }) => {
    const text = JSON.stringify({ version: 4, title: 'future', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 1, extra: 'keep' });
    await writeFile(join(ws, 'f.dpx.json'), text);
    const r = await call('GET', `/api/file?path=${q('f')}`);
    assert.equal(r.body.version, 4);
    const w = await call('PUT', `/api/file?path=${q('f')}`, { title: 'x', revision: r.body.revision });
    assert.equal(w.status, 422);
    assert.match(w.body.error ?? JSON.stringify(w.body), /더 새 버전에서 만든 파일이라 저장하지 않았어요/);
    assert.equal(await readFile(join(ws, 'f.dpx.json'), 'utf8'), text);
  });
});

test('reading a newer-format file after an outside edit leaves it untouched, and saving is still refused', async () => {
  await withApp(async ({ ws, call }) => {
    const file = join(ws, 'f.dpx.json');
    // The server knows this file (created here) before the newer app replaces it on disk.
    const made = await call('POST', '/api/file', { path: 'f' });
    assert.equal(made.status, 201);
    const base = { version: 4, title: 'future', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: made.body.revision };
    await writeFile(file, JSON.stringify(base));
    // Outside edit that keeps the revision: a v2 file would get its revision raised on disk here.
    const edited = JSON.stringify({ ...base, title: 'edited outside', extra: 'keep' });
    await writeFile(file, edited);
    const again = await call('GET', `/api/file?path=${q('f')}`);
    assert.equal(again.body.title, 'edited outside');
    assert.equal(await readFile(file, 'utf8'), edited);
    const w = await call('PUT', `/api/file?path=${q('f')}`, { title: 'x', revision: again.body.revision });
    assert.equal(w.status, 422);
    const stale = await call('PUT', `/api/file?path=${q('f')}`, { title: 'x', revision: 99 });
    assert.equal(stale.status, 422);
    assert.equal(await readFile(file, 'utf8'), edited);
  });
});

test('a typed .dpx suffix is dropped: demo.dpx is the file demo.dpx.json', async () => {
  await withApp(async ({ ws, call }) => {
    const r = await call('POST', '/api/file', { path: 'a/demo.dpx', title: 'Demo' });
    assert.equal(r.status, 201);
    assert.equal(r.body.path, 'a/demo.dpx.json');
    assert.deepEqual(await readdir(join(ws, 'a')), ['demo.dpx.json']);
    assert.equal((await call('GET', `/api/file?path=${q('a/demo.dpx')}`)).status, 200);
    assert.equal((await call('POST', '/api/file', { path: 'a/demo' })).status, 409);
  });
});

test('names like a:memo are fine; only drive paths are refused', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('POST', '/api/file', { path: 'a:memo' })).status, 201);
    assert.equal((await call('GET', `/api/file?path=${q('a:memo')}`)).status, 200);
    if (process.platform !== 'win32') assert.equal((await call('POST', '/api/file', { path: 'C:/x' })).status, 400);
  });
});

test('the revision floors of deleted files are bounded, newest kept', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const store = createStore(ws, {});
  try {
    for (const name of ['old', 'recent']) {
      await store.createFile(name, {});
      const f = await store.readFile(name);
      await store.writeFile(name, { ...f, revision: f.revision });
    }
    await store.removeFile('old');
    for (let i = 0; i < 1100; i++) {
      await store.createFile(`x${i}`, {});
      await store.removeFile(`x${i}`);
    }
    await store.removeFile('recent');
    assert.equal((await store.createFile('old', {})).revision, 1, 'the oldest floor was dropped');
    assert.equal((await store.createFile('recent', {})).revision, 3, 'a recent deletion keeps its floor');
  } finally {
    store.close();
    await rm(ws, { recursive: true, force: true });
  }
});

test('an async fs.watch error is logged once, by code only, and does not crash', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const fake = Object.assign(new EventEmitter(), { close() {} });
  const store = createStore(ws, { watchFn: () => fake });
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    await store.startWatching();
    const err = Object.assign(new Error(`ENOSPC: watch limit reached at ${ws}`), { code: 'ENOSPC' });
    fake.emit('error', err);
    fake.emit('error', err);
    assert.equal(warn.mock.callCount(), 1);
    const line = String(warn.mock.calls[0].arguments[0]);
    assert.match(line, /ENOSPC/);
    assert.ok(!line.includes(ws), 'no absolute path in the log');
  } finally {
    warn.mock.restore();
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
});
