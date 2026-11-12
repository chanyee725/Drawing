import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitLogArgs, parseGitLog, createGitReader } from '../server/history/git.js';
import { createVersionStore, highlightCells } from '../server/history/versions.js';
import { createApp } from '../server/app.js';
import * as watch from '../server/watch/index.js';
import * as history from '../server/history/index.js';

const model = (cells) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const box = (id, { x = 0, y = 0, w = 100, h = 40, value = 'A' } = {}) =>
  `<mxCell id="${id}" value="${value}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const file = (pages) =>
  `<?xml version="1.0"?><mxfile host="test">${pages.map(([id, name, body]) => `<diagram id="${id}" name="${name}">${body}</diagram>`).join('')}</mxfile>`;

// Fake identity used for commits in tests: must never come out of the API.
const AUTHOR = { name: 'Zed Testperson', email: 'zed.testperson@example.invalid' };
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: AUTHOR.name,
  GIT_AUTHOR_EMAIL: AUTHOR.email,
  GIT_COMMITTER_NAME: AUTHOR.name,
  GIT_COMMITTER_EMAIL: AUTHOR.email,
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: tmpdir(),
};
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'draw-git-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

test('git: log format asks only for hash, time and subject', () => {
  const args = gitLogArgs('a.drawio');
  const fmt = args.find((a) => a.startsWith('--format='));
  assert.equal(fmt, '--format=%x1e%H%x1f%ct%x1f%s');
  assert.doesNotMatch(args.join(' '), /%a[nNeElL]|%c[nNeElL]|%G|%b|%B/);
  assert.ok(args.includes('--follow'));
  assert.deepEqual(args.slice(-2), ['--', 'a.drawio']);
});

test('git: parseGitLog reads commits, renamed paths, merges without a path and strips control chars', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const c = 'c'.repeat(40);
  const out =
    `\x1e${a}\x1f1700000100\x1fdocs: rename\x07 diagram\x1fextra\0\ndocs/new.drawio\0` +
    `\x1e${b}\x1f1700000000\x1fmerge: T3\0` +
    `\x1enot-a-sha\x1f1\x1fjunk\0\nx\0` +
    `\x1e${c}\x1f1699999999\x1ffeat: first\0\ndocs/old.drawio\0`;
  assert.deepEqual(parseGitLog(out), [
    { sha: a, at: 1700000100000, subject: 'docs: rename  diagram extra', path: 'docs/new.drawio' },
    { sha: b, at: 1700000000000, subject: 'merge: T3', path: null },
    { sha: c, at: 1699999999000, subject: 'feat: first', path: 'docs/old.drawio' },
  ]);
  assert.deepEqual(parseGitLog(''), []);
});

test('git: reader follows renames, reads old content and leaks no author name or email', async () => {
  const dir = await repo();
  try {
    await writeFile(join(dir, 'old.drawio'), file([['p', 'P', model(box('a'))]]));
    sh(dir, 'add', '.');
    sh(dir, 'commit', '-q', '-m', 'feat: first diagram');
    await rename(join(dir, 'old.drawio'), join(dir, 'new.drawio'));
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'chore: rename diagram');
    await writeFile(join(dir, 'new.drawio'), file([['p', 'P', model(box('a') + box('b', { x: 200 }))]]));
    sh(dir, 'commit', '-q', '-am', 'feat: add box b');

    const git = createGitReader(dir);
    const { available, commits } = await git.log('new.drawio');
    assert.equal(available, true);
    assert.deepEqual(commits.map((c) => c.subject), ['feat: add box b', 'chore: rename diagram', 'feat: first diagram']);
    assert.deepEqual(commits.map((c) => c.path), ['new.drawio', 'new.drawio', 'old.drawio']);
    assert.ok(commits.every((c) => /^[0-9a-f]{40}$/.test(c.sha) && c.at > 1e12));
    const json = JSON.stringify(commits);
    assert.ok(!json.includes(AUTHOR.name) && !json.includes(AUTHOR.email) && !json.includes('Testperson'));
    assert.match(await git.show(commits[2].sha, 'old.drawio'), /<mxCell id="a"/);
    await assert.rejects(git.show('HEAD', 'new.drawio'), /bad revision/);

    assert.deepEqual(await createGitReader(tmpdir()).log('x.drawio').then((r) => r.available), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('versions: each change keeps its page after-XML and links to the previous one as before', () => {
  let current = { pages: [{ id: 'p', name: 'P', xml: 'v0' }, { id: 'q', name: 'Q', xml: 'q0' }] };
  const store = createVersionStore({
    getParsed: () => current,
    agentFor: (dir) => (dir === '/wt/impl-2' ? { name: 'impl-2', role: 'implementer', email: 'x@y' } : null),
  });
  store.baseline('f');
  const change = (pageId, extra = {}) => ({ fileId: 'f', page: { id: pageId, name: pageId.toUpperCase() }, kinds: ['text'], cellIds: ['a'], summary: '1개 글자 변경', at: 5, source: { kind: 'main', label: 'main', dir: '/main' }, ...extra });

  current = { pages: [{ id: 'p', name: 'P', xml: 'v1' }, { id: 'q', name: 'Q', xml: 'q0' }] };
  store.record(change('p'));
  current = { pages: [{ id: 'p', name: 'P', xml: 'v2' }, { id: 'q', name: 'Q', xml: 'q1' }] };
  store.record(change('p', { source: { kind: 'worktree', label: 'impl-2', dir: '/wt/impl-2' } }));
  store.record(change('q'));

  assert.deepEqual([1, 2, 3].map((s) => [store.get('f', s).before, store.get('f', s).after]), [['v0', 'v1'], ['v1', 'v2'], ['q0', 'q1']]);
  const list = store.list('f');
  assert.deepEqual(list.map((v) => v.seq), [1, 2, 3]);
  assert.ok(list.every((v) => !('before' in v) && !('after' in v)));
  assert.deepEqual(list[1].agent, { name: 'impl-2', role: 'implementer' }); // whitelisted fields only
  assert.deepEqual(list[1].source, { kind: 'worktree', label: 'impl-2' }); // no dir
  assert.equal(store.list('nope'), null);
});

test('versions: per-file limit and the global budget drop the oldest snapshots', () => {
  let n = 0;
  const store = createVersionStore({ getParsed: () => ({ pages: [{ id: 'p', name: 'P', xml: `x${String(n).padStart(9, '0')}` }] }), budget: 35, limit: 4 });
  for (n = 1; n <= 6; n++) store.record({ fileId: 'f', page: { id: 'p', name: 'P' }, source: { kind: 'main', label: 'main' }, at: n });
  const list = store.list('f');
  assert.deepEqual(list.map((v) => v.seq), [3, 4, 5, 6]);
  assert.deepEqual(list.map((v) => v.snapshot), [false, true, true, true]); // 10 chars each, budget 35
  assert.equal(store.used, 30);
});

test('versions: highlightCells marks kinds and keeps a removed cell at its old place', async () => {
  const before = model(box('a') + box('b', { x: 200 }) + box('c', { x: 400, y: 50 }));
  const after = model(box('a', { value: 'B' }) + box('b', { x: 250 }) + box('d', { x: 10, y: 300 }));
  const cells = await highlightCells(before, after);
  const by = Object.fromEntries(cells.map((c) => [c.id, c]));
  assert.deepEqual(by.d, { id: 'd', kinds: ['added'], box: { x: 10, y: 300, w: 100, h: 40 } });
  assert.deepEqual(by.c, { id: 'c', kinds: ['removed'], box: { x: 400, y: 50, w: 100, h: 40 } });
  assert.deepEqual(by.b.kinds, ['moved']);
  assert.deepEqual(by.b.box, { x: 250, y: 0, w: 100, h: 40 });
  assert.deepEqual(by.a.kinds, ['text']);
  assert.equal((await highlightCells('', model(box('a')))).length, 1);
});

async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('api: 12 recorded edits replay in order; git endpoints give subjects only', async () => {
  const dir = await repo();
  const path = join(dir, 'flow.drawio');
  const version = (i) => file([['p', 'P', model(Array.from({ length: i + 1 }, (_, k) => box(`c${k}`, { x: k * 120 })).join(''))], ['q', 'Q', model(box('z'))]]);
  await writeFile(path, version(0));
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'feat: start flow');
  await writeFile(path, version(1));
  sh(dir, 'commit', '-q', '-am', 'feat: second box');

  const moduleList = [
    { name: 'watch', setup: (ctx) => watch.setup(ctx, { pollMs: 15, quietMs: 30, rescanMs: 1e9 }) },
    { name: 'history', setup: history.setup },
  ];
  const app = await createApp({ projectDir: dir }, { publicDir: dir, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const get = async (p) => {
    const res = await fetch(base + p);
    return { status: res.status, body: await res.json() };
  };
  try {
    const [f] = (await get('/api/files')).body;
    assert.deepEqual((await get(`/api/versions?file=${f.id}`)).body, { versions: [] });
    for (let i = 2; i <= 13; i++) {
      await writeFile(path, version(i));
      await until(async () => (await get(`/api/versions?file=${f.id}`)).body.versions.length === i - 1);
    }
    const { versions } = (await get(`/api/versions?file=${f.id}`)).body;
    assert.equal(versions.length, 12);
    assert.deepEqual(versions.map((v) => v.seq), Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(versions.every((v) => v.page.id === 'p' && v.summary === '1개 추가' && v.source.kind === 'main'));
    for (const v of versions) {
      const one = (await get(`/api/versions/${v.seq}?file=${f.id}`)).body;
      const added = `c${v.seq + 1}`;
      assert.deepEqual(one.cells.map((c) => [c.id, c.kinds]), [[added, ['added']]]);
      assert.equal((one.xml.match(/vertex="1"/g) ?? []).length, v.seq + 2);
    }
    assert.equal((await get(`/api/versions/99?file=${f.id}`)).status, 404);
    assert.equal((await get('/api/versions?file=zzz')).status, 404);

    const log = (await get(`/api/git-log?file=${f.id}`)).body;
    assert.equal(log.available, true);
    assert.deepEqual(log.commits.map((c) => c.subject), ['feat: second box', 'feat: start flow']);
    assert.deepEqual(Object.keys(log.commits[0]).sort(), ['at', 'sha', 'subject']);
    const gv = (await get(`/api/git-version?file=${f.id}&commit=${log.commits[0].sha}&page=p`)).body;
    assert.deepEqual(gv.pages, [{ id: 'p', name: 'P' }, { id: 'q', name: 'Q' }]);
    assert.deepEqual(gv.cells.map((c) => [c.id, c.kinds]), [['c1', ['added']]]);
    const first = (await get(`/api/git-version?file=${f.id}&commit=${log.commits[1].sha}`)).body;
    assert.deepEqual(first.page, { id: 'p', name: 'P' });
    assert.equal(first.cells.length, 1); // first commit: everything added
    assert.equal((await get(`/api/git-version?file=${f.id}&commit=${'0'.repeat(40)}`)).status, 404);
    assert.equal((await get(`/api/git-version?file=${f.id}&commit=HEAD`)).status, 404);
    const missing = (await get(`/api/git-version?file=${f.id}&commit=${log.commits[0].sha}&page=nope`)).body;
    assert.equal(missing.page, null);

    const everything = JSON.stringify([versions, log, gv, first]);
    assert.ok(!everything.includes(AUTHOR.name) && !everything.includes(AUTHOR.email) && !everything.includes(dir));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
