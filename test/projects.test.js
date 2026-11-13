import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { buildProjects, parseProjectMeta } from '../server/projects/model.js';

const file = (path, title = '') => ({ type: 'file', name: path.split('/').pop(), path, title, revision: 1 });
const folder = (path, children) => ({ type: 'folder', name: path.split('/').pop(), path, children });

test('buildProjects nests sub-docs under the same-named file, bundles folders without a parent file, and keeps unfiled', () => {
  const tree = [
    folder('A', [file('A/login.dpx.json', '로그인'), folder('A/login', [file('A/login/token.dpx.json')]), folder('A/misc', [file('A/misc/x.dpx.json')])]),
    file('top.dpx.json', 'Top'),
  ];
  const { projects, unfiled } = buildProjects(tree, (p) => ({ createdAt: 1, modifiedAt: p === 'A/login/token.dpx.json' ? 9 : 2 }), { A: { icon: '🔐' } });
  const [a] = projects;
  assert.equal(a.name, 'A');
  assert.equal(a.icon, '🔐');
  assert.equal(a.docCount, 3);
  const login = a.docs.find((d) => d.path === 'A/login.dpx.json');
  assert.equal(login.children[0].title, 'token');
  assert.equal(a.docs.find((d) => d.name === 'misc').bundle, true);
  assert.equal(unfiled.length, 1);
});

test('parseProjectMeta keeps only name, icon and description', () => {
  assert.deepEqual(parseProjectMeta('{"name":" N ","icon":"X","description":"d","email":"a@b.c"}'), { name: 'N', icon: 'X', description: 'd' });
  assert.deepEqual(parseProjectMeta('nope'), {});
});

test('/api/projects and /api/recent over a scratch workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'draw-proj-'));
  const app = await createApp({ workspaceDir: dir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'x-drawing': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await mkdir(join(dir, 'P'));
    await writeFile(join(dir, 'P', '.project.json'), '{"name":"프로젝트 P"}');
    assert.equal((await post('/api/file', { path: 'P/a.dpx.json', title: 'A' })).status, 201);
    assert.equal((await post('/api/file', { path: 'loose.dpx.json', title: 'L' })).status, 201);
    const { projects, unfiled } = await (await fetch(`${base}/api/projects`)).json();
    assert.equal(projects[0].name, '프로젝트 P');
    assert.equal(projects[0].docCount, 1);
    assert.equal(unfiled[0].title, 'L');
    const { files } = await (await fetch(`${base}/api/recent?limit=5`)).json();
    assert.deepEqual(files.map((f) => f.path).sort(), ['P/a.dpx.json', 'loose.dpx.json']);
    assert.equal(files.find((f) => f.path === 'P/a.dpx.json').project, 'P');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
