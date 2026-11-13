import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { modules } from '../server/modules.js';
import { newFile } from '../server/workspace/model.js';
import { nestDocs } from '../server/workspace/projects.js';

// Scratch workspace only (never a real project); the dispatch module stays off outside a git repo.
async function withApp(fn) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-proj-'));
  const outside = await mkdtemp(join(tmpdir(), 'draw-proj-out-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: modules });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-drawing': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ ws, outside, call });
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

const shape = (nodes) => nodes.map((n) => [n.type, n.name, n.count, shape(n.children)]);

test('projects: top-level folders are projects, same-named folders hold sub-docs, root files are loose', async () => {
  await withApp(async ({ ws, call }) => {
    for (const p of ['Alpha/로그인 로직', 'Alpha/로그인 로직/토큰 갱신', 'Alpha/로그인 로직/토큰 갱신/만료', 'Alpha/데이터 수집', 'Alpha/묶음/메모', 'Beta/one', 'loose', 'Alpha2/x']) {
      assert.equal((await call('POST', '/api/file', { path: p, title: p.split('/').pop() })).status, 201);
    }
    await mkdir(join(ws, 'Empty'));
    await writeFile(join(ws, 'Beta', '.project.json'), JSON.stringify({ name: '  베타 프로젝트 ', icon: 'B', description: '설명', owner: 'dropped', extra: 1 }));

    const r = await call('GET', '/api/workspace/projects');
    assert.equal(r.status, 200);
    const { projects, loose } = r.body;
    // Sorted by display name; meta name wins over the folder name.
    assert.deepEqual(projects.map((p) => [p.path, p.name, p.icon, p.description, p.count]), [
      ['Alpha', 'Alpha', null, '', 5],
      ['Alpha2', 'Alpha2', null, '', 1],
      ['Empty', 'Empty', null, '', 0],
      ['Beta', '베타 프로젝트', 'B', '설명', 1],
    ]);
    assert.equal('owner' in projects[3], false);
    const alpha = projects[0];
    assert.deepEqual(shape(alpha.docs), [
      ['doc', '데이터 수집', 0, []],
      ['doc', '로그인 로직', 2, [['doc', '토큰 갱신', 1, [['doc', '만료', 0, []]]]]],
      ['group', '묶음', 1, [['doc', '메모', 0, []]]],
    ]);
    const login = alpha.docs[1];
    assert.equal(login.path, 'Alpha/로그인 로직.dpx.json');
    assert.equal(login.title, '로그인 로직');
    assert.equal(login.revision, 1);
    assert.equal(alpha.docs[2].path, 'Alpha/묶음');
    for (const d of [login, login.children[0], alpha.docs[2]]) {
      assert.ok(!Number.isNaN(Date.parse(d.created)) && !Number.isNaN(Date.parse(d.modified)), d.name);
      assert.ok(Date.parse(d.created) <= Date.parse(d.modified));
      assert.equal('latest' in d, false);
    }
    assert.ok(Date.parse(alpha.modified) >= Date.parse(login.modified));
    assert.deepEqual(shape(loose), [['doc', 'loose', 0, []]]);
    assert.equal(loose[0].path, 'loose.dpx.json');
  });
});

test('projects: created survives saves, modified follows the save', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'P/doc' });
    const before = (await call('GET', '/api/workspace/projects')).body.projects[0].docs[0];
    await new Promise((r) => setTimeout(r, 30));
    const f = (await call('GET', '/api/file?path=P%2Fdoc')).body;
    assert.equal((await call('PUT', '/api/file?path=P%2Fdoc', { ...f, title: 'changed' })).status, 200);
    const after = (await call('GET', '/api/workspace/projects')).body.projects[0].docs[0];
    assert.equal(after.title, 'changed');
    assert.ok(Date.parse(after.created) <= Date.parse(before.created) + 5, `${after.created} vs ${before.created}`);
    assert.ok(Date.parse(after.modified) > Date.parse(before.modified));
  });
});

test('projects: bad, oversized or symlinked .project.json is ignored; hidden and symlinked folders never show', async () => {
  await withApp(async ({ ws, outside, call }) => {
    for (const d of ['Bad', 'Big', 'Link', 'Arr']) await mkdir(join(ws, d));
    await writeFile(join(ws, 'Bad', '.project.json'), '{not json');
    await writeFile(join(ws, 'Big', '.project.json'), JSON.stringify({ name: 'x'.repeat(20000) }));
    await writeFile(join(ws, 'Arr', '.project.json'), JSON.stringify(['name']));
    await writeFile(join(outside, 'meta.json'), JSON.stringify({ name: 'outside' }));
    await symlink(join(outside, 'meta.json'), join(ws, 'Link', '.project.json'));
    await mkdir(join(ws, '.hidden'));
    await writeFile(join(ws, '.hidden', 'a.dpx.json'), JSON.stringify(newFile()));
    await symlink(outside, join(ws, 'Escape'));
    const { projects } = (await call('GET', '/api/workspace/projects')).body;
    assert.deepEqual(projects.map((p) => [p.path, p.name]), [['Arr', 'Arr'], ['Bad', 'Bad'], ['Big', 'Big'], ['Link', 'Link']]);
  });
});

test('projects: long meta values are capped', async () => {
  await withApp(async ({ ws, call }) => {
    await mkdir(join(ws, 'P'));
    await writeFile(join(ws, 'P', '.project.json'), JSON.stringify({ name: '가'.repeat(300), icon: '🙂'.repeat(40), description: 7 }));
    const [p] = (await call('GET', '/api/workspace/projects')).body.projects;
    assert.equal([...p.name].length, 100);
    assert.equal([...p.icon].length, 16);
    assert.equal(p.description, '');
  });
});

test('nestDocs: a folder without its document is a group; a document without a folder has no children', async () => {
  const f = (path, mtime) => ({ type: 'file', name: path.split('/').pop() + '.dpx.json', path: path + '.dpx.json', title: '', revision: 1, mtime, created: mtime });
  const nodes = [
    { type: 'folder', name: 'G', path: 'G', children: [f('G/a', '2026-01-02T00:00:00.000Z'), f('G/b', '2026-01-05T00:00:00.000Z')] },
    f('z', '2026-01-01T00:00:00.000Z'),
  ];
  const out = await nestDocs(nodes, async (x) => Date.parse(x.created));
  assert.deepEqual(shape(out), [['group', 'G', 2, [['doc', 'a', 0, []], ['doc', 'b', 0, []]]], ['doc', 'z', 0, []]]);
  assert.equal(out[0].created, '2026-01-02T00:00:00.000Z');
  assert.equal(out[0].modified, '2026-01-05T00:00:00.000Z');
});

test('projects: created follows the file through move, delete and restore', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'P/doc' });
    const first = (await call('GET', '/api/workspace/projects')).body.projects[0].docs[0].created;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await call('POST', '/api/move', { from: 'P/doc', to: 'Q/moved' })).status, 200);
    const projectQ = async () => (await call('GET', '/api/workspace/projects')).body.projects.find((p) => p.path === 'Q');
    let q = await projectQ();
    assert.equal(q.docs[0].created, first);
    assert.equal((await call('DELETE', '/api/file?path=Q%2Fmoved')).status, 200);
    const [item] = (await call('GET', '/api/trash')).body.items;
    assert.equal((await call('POST', '/api/trash/restore', { id: item.id })).status, 200);
    q = await projectQ();
    assert.equal(q.docs[0].created, first);
    // The mark is not a version.
    assert.deepEqual((await call('GET', '/api/history?path=Q%2Fmoved')).body.versions, []);
  });
});

test('move with subdocs: a document and its sub-documents folder move together', async () => {
  await withApp(async ({ ws, outside, call }) => {
    for (const p of ['A/로그인', 'A/로그인/토큰', 'A/로그인/토큰/만료', 'A/solo', 'B/keep', 'B/clash', 'B/clash/x']) assert.equal((await call('POST', '/api/file', { path: p })).status, 201);
    const docsOf = async (name) => (await call('GET', '/api/workspace/projects')).body.projects.find((p) => p.path === name)?.docs ?? [];

    let r = await call('POST', '/api/move', { from: 'A/로그인.dpx.json', to: 'B/로그인.dpx.json', type: 'file', withSubdocs: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.path, 'B/로그인.dpx.json');
    assert.deepEqual(shape(await docsOf('B')).find((d) => d[1] === '로그인'), ['doc', '로그인', 2, [['doc', '토큰', 1, [['doc', '만료', 0, []]]]]]);
    assert.deepEqual(shape(await docsOf('A')), [['doc', 'solo', 0, []]]);

    // A document without sub-documents moves alone.
    assert.equal((await call('POST', '/api/move', { from: 'A/solo.dpx.json', to: 'B/solo.dpx.json', type: 'file', withSubdocs: true })).status, 200);

    // Into its own sub-documents: refused, nothing moves.
    r = await call('POST', '/api/move', { from: 'B/로그인.dpx.json', to: 'B/로그인/토큰/로그인.dpx.json', type: 'file', withSubdocs: true });
    assert.equal(r.status, 400);
    assert.equal(shape(await docsOf('B')).find((d) => d[1] === '로그인')[2], 2);

    // The sub-documents folder name is taken at the target: refused before the file moves.
    await mkdir(join(ws, 'A', 'clash'));
    r = await call('POST', '/api/move', { from: 'B/clash.dpx.json', to: 'A/clash.dpx.json', type: 'file', withSubdocs: true });
    assert.equal(r.status, 409);
    assert.equal(shape(await docsOf('B')).find((d) => d[1] === 'clash')[2], 1);

    // Outside the workspace: refused.
    for (const to of ['../escape.dpx.json', `${outside}/x.dpx.json`]) {
      r = await call('POST', '/api/move', { from: 'B/로그인.dpx.json', to, type: 'file', withSubdocs: true });
      assert.equal(r.status, 400, to);
    }
    await symlink(outside, join(ws, 'link'));
    r = await call('POST', '/api/move', { from: 'B/로그인.dpx.json', to: 'link/로그인.dpx.json', type: 'file', withSubdocs: true });
    assert.ok(r.status >= 400, `symlink target status ${r.status}`);
    assert.equal(shape(await docsOf('B')).find((d) => d[1] === '로그인')[2], 2);

    // withSubdocs only goes with a file move.
    assert.equal((await call('POST', '/api/move', { from: 'B', to: 'C', type: 'folder', withSubdocs: true })).status, 400);
  });
});

test('delete with subdocs: a document and its sub-documents folder go to the trash together', async () => {
  await withApp(async ({ ws, call }) => {
    for (const p of ['A/plan', 'A/plan/step', 'A/plan/step/deep', 'A/solo', 'A/keep']) assert.equal((await call('POST', '/api/file', { path: p })).status, 201);
    await mkdir(join(ws, 'A', 'empty'));
    assert.equal((await call('POST', '/api/file', { path: 'A/empty' })).status, 201);
    const docsOf = async () => shape((await call('GET', '/api/workspace/projects')).body.projects.find((p) => p.path === 'A')?.docs ?? []);

    assert.equal((await call('DELETE', '/api/file?path=A%2Fplan.dpx.json&withSubdocs=1')).status, 200);
    // Without withSubdocs only the file goes (the old behaviour): A/solo has no folder anyway.
    assert.equal((await call('DELETE', '/api/file?path=A%2Fsolo.dpx.json')).status, 200);
    // An empty sub-documents folder goes too, so it does not stay behind as a group.
    assert.equal((await call('DELETE', '/api/file?path=A%2Fempty.dpx.json&withSubdocs=1')).status, 200);
    assert.deepEqual(await docsOf(), [['doc', 'keep', 0, []]]);
    const trashed = (await call('GET', '/api/trash')).body.items.map((i) => i.path).sort();
    assert.deepEqual(trashed, ['A/empty.dpx.json', 'A/plan.dpx.json', 'A/plan/step.dpx.json', 'A/plan/step/deep.dpx.json', 'A/solo.dpx.json']);
    // Each one restores on its own.
    const step = (await call('GET', '/api/trash')).body.items.find((i) => i.path === 'A/plan/step.dpx.json');
    assert.equal((await call('POST', '/api/trash/restore', { id: step.id })).status, 200);
    assert.equal((await call('GET', '/api/file?path=A%2Fplan%2Fstep.dpx.json')).status, 200);
  });
});

test('delete with subdocs: files other than documents under X/ are never lost', async () => {
  await withApp(async ({ ws, call }) => {
    for (const p of ['A/plan', 'A/plan/step', 'A/plan/sub/deep', 'A/plan/only/doc']) assert.equal((await call('POST', '/api/file', { path: p })).status, 201);
    await writeFile(join(ws, 'A', 'plan', 'notes.md'), 'keep me\n');
    await writeFile(join(ws, 'A', 'plan', 'sub', '.hidden'), 'keep me too\n');

    assert.equal((await call('DELETE', '/api/file?path=A%2Fplan.dpx.json&withSubdocs=1')).status, 200);
    const trashed = (await call('GET', '/api/trash')).body.items.map((i) => i.path).sort();
    assert.deepEqual(trashed, ['A/plan.dpx.json', 'A/plan/only/doc.dpx.json', 'A/plan/step.dpx.json', 'A/plan/sub/deep.dpx.json']);
    // The documents are gone; the other files stay with the folders that hold them; emptied folders go.
    const { readdir: ls, readFile: read } = await import('node:fs/promises');
    assert.equal(await read(join(ws, 'A', 'plan', 'notes.md'), 'utf8'), 'keep me\n');
    assert.equal(await read(join(ws, 'A', 'plan', 'sub', '.hidden'), 'utf8'), 'keep me too\n');
    assert.deepEqual((await ls(join(ws, 'A', 'plan'))).sort(), ['notes.md', 'sub']);
    assert.deepEqual(await ls(join(ws, 'A', 'plan', 'sub')), ['.hidden']);
  });
});
