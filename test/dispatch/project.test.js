// Project mode (E13): workspace inside git, Dispatch off outside git, one server per workspace and
// one Dispatch per project. Scratch git repos in temp dirs; HOME points at a temp dir for the real
// server processes, and no agent CLI is started (no provider is connected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimLock, claimWorkspace, pidAlive } from '../../server/lock.js';
import { claimProject, findProject } from '../../server/dispatch/project.js';
import { gitTop } from '../../server/dispatch/index.js';

const SERVER = fileURLToPath(new URL('../../server/index.js', import.meta.url));

function scratchRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-')));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'pipelines');
  mkdirSync(ws);
  return { root, ws };
}

/** A process that stays alive until killed, and one that has already exited. */
function liveChild() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  return child;
}
async function deadPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((r) => child.on('exit', r));
  return child.pid;
}

/** An HTTP server on a free loopback port answering GET <path> with body. */
async function fakeServer(routes) {
  const srv = createServer((req, res) => {
    const body = routes[req.url];
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, close: () => new Promise((r) => srv.close(r)) };
}

async function freePort() {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

test('findProject: git subfolder and top level count, a plain folder does not', async () => {
  const { root, ws } = scratchRepo();
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-plain-')));
  try {
    assert.deepEqual(await findProject(ws, { gitTop }), { root });
    assert.deepEqual(await findProject(root, { gitTop }), { root });
    assert.deepEqual(await findProject(plain, { gitTop }), { reason: 'not-git' });
    assert.deepEqual(await findProject(null, { gitTop }), { reason: 'no-workspace' });
    assert.deepEqual(await findProject(join(plain, 'missing'), { gitTop }), { reason: 'no-workspace' });
    // Inside .git there is no work tree.
    assert.deepEqual(await findProject(join(root, '.git'), { gitTop }), { reason: 'not-git' });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

test('findProject: a symlinked workspace resolves to the real project; GIT_DIR from the environment is ignored', async () => {
  const { root, ws } = scratchRepo();
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-plain-')));
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  try {
    const link = join(plain, 'ws-link');
    symlinkSync(ws, link);
    assert.deepEqual(await findProject(link, { gitTop }), { root });

    process.env.GIT_DIR = join(root, '.git');
    process.env.GIT_WORK_TREE = root;
    assert.deepEqual(await findProject(join(plain), { gitTop }), { reason: 'not-git' });
    // A gitTop that answers a folder not holding the workspace is not trusted either.
    assert.deepEqual(await findProject(plain, { gitTop: async () => root }), { reason: 'not-git' });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(root, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

test('claimLock: takes a free lock, refuses a live holder, replaces a dead or impostor holder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e13-lock-'));
  const file = join(dir, 'sub', 'x.lock');
  const child = liveChild();
  try {
    const first = await claimLock(file, { isLive: async () => true });
    assert.equal(first.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, port: null });
    await first.lock.setPort(4567);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, port: 4567 });
    await first.lock.release();
    assert.equal(existsSync(file), false);

    // Someone else (a live process) holds it.
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: 1234 }));
    const busy = await claimLock(file, { isLive: async (h) => pidAlive(h.pid) });
    assert.deepEqual(busy, { ok: false, holder: { pid: child.pid, port: 1234 } });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, child.pid, 'a refused claim leaves the lock alone');

    // Its pid runs but the port does not answer as that server (pid reused): stale.
    const impostor = await claimLock(file, { isLive: async () => false });
    assert.equal(impostor.ok, true);
    await impostor.lock.release();

    // Holder died (crash, kill -9): stale, replaced.
    writeFileSync(file, JSON.stringify({ pid: await deadPid(), port: 1 }));
    const after = await claimLock(file, { isLive: async (h) => pidAlive(h.pid) });
    assert.equal(after.ok, true);
    // A lock that is no longer ours is not removed by our release.
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: 2 }));
    await after.lock.release();
    after.lock.releaseSync();
    assert.equal(existsSync(file), true);

    // Garbage in the file counts as stale.
    writeFileSync(file, '{not json');
    assert.equal((await claimLock(file, { isLive: async () => true })).ok, true);
    assert.deepEqual(readdirSync(join(dir, 'sub')), ['x.lock'], 'no temp files left behind');
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claimWorkspace: a live server answering /api/info for this folder holds it', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'drawing-e13-ws-'));
  const name = ws.split('/').pop();
  const child = liveChild();
  const other = await fakeServer({ '/api/info': { workspace: name } });
  const wrong = await fakeServer({ '/api/info': { workspace: 'someone-else' } });
  const file = join(ws, '.drawing', 'server.lock');
  try {
    mkdirSync(join(ws, '.drawing'));
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: other.port }));
    assert.deepEqual(await claimWorkspace(ws), { ok: false, holder: { pid: child.pid, port: other.port } });
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: null }));
    assert.equal((await claimWorkspace(ws)).ok, false, 'a live pid that has not listened yet holds it');
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: wrong.port }));
    const taken = await claimWorkspace(ws);
    assert.equal(taken.ok, true, 'a port serving another workspace means the pid was reused');
    await taken.lock.release();
  } finally {
    child.kill();
    await other.close();
    await wrong.close();
    rmSync(ws, { recursive: true, force: true });
  }
});

test('claimProject: a standalone Dispatch on .dispatch/server.port turns Dispatch off and nothing is written', async () => {
  const { root } = scratchRepo();
  const home = process.env.HOME;
  const shown = home && root.startsWith(home) ? root.replace(home, '~') : root;
  const standalone = await fakeServer({ '/api/state': { project: { path: shown } } });
  const elsewhere = await fakeServer({ '/api/state': { project: { path: '/somewhere/else' } } });
  try {
    mkdirSync(join(root, '.dispatch'));
    writeFileSync(join(root, '.dispatch', 'server.port'), `${standalone.port}\n`);
    assert.deepEqual(await claimProject(root), { ok: false, reason: 'standalone', port: standalone.port });
    assert.deepEqual(readdirSync(join(root, '.dispatch')), ['server.port']);

    // The remembered port now serves another project, or nothing: not ours to worry about.
    writeFileSync(join(root, '.dispatch', 'server.port'), `${elsewhere.port}\n`);
    const ok = await claimProject(root);
    assert.equal(ok.ok, true);
    await ok.lock.release();
    writeFileSync(join(root, '.dispatch', 'server.port'), `${await freePort()}\n`);
    const ok2 = await claimProject(root);
    assert.equal(ok2.ok, true);
    await ok2.lock.release();
  } finally {
    await standalone.close();
    await elsewhere.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimProject: another live Drawing server holding .dispatch/drawing.lock turns Dispatch off', async () => {
  const { root } = scratchRepo();
  const child = liveChild();
  const drawing = await fakeServer({ '/api/state': { project: { path: root } } });
  try {
    mkdirSync(join(root, '.dispatch'));
    writeFileSync(join(root, '.dispatch', 'drawing.lock'), JSON.stringify({ pid: child.pid, port: drawing.port }));
    assert.deepEqual(await claimProject(root), { ok: false, reason: 'other-drawing', port: drawing.port });
    child.kill();
    await new Promise((r) => child.on('exit', r));
    const ok = await claimProject(root);
    assert.equal(ok.ok, true, 'the holder exited: its lock is stale');
    await ok.lock.release();
  } finally {
    child.kill();
    await drawing.close();
    rmSync(root, { recursive: true, force: true });
  }
});

/** Starts the real server (node server/index.js) on a free port; resolves once it prints its URL or exits. */
async function startServer(ws, home) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER, ws], {
    env: { PATH: process.env.PATH, HOME: home, DRAW_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 10_000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
    child.stdout.on('data', () => { if (out.includes('Drawing: http://')) { clearTimeout(timer); resolve(null); } });
  });
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
  };
  return { port, child, code, output: () => out, stop, base: `http://127.0.0.1:${port}` };
}

test('real server: a second server on the same workspace refuses; a second workspace in the project runs without Dispatch', async () => {
  const { root, ws } = scratchRepo();
  const home = mkdtempSync(join(tmpdir(), 'drawing-e13-home-'));
  const docs = join(root, 'docs');
  mkdirSync(docs);
  const servers = [];
  try {
    const a = await startServer(ws, home);
    servers.push(a);
    assert.equal(a.code, null, a.output());
    assert.deepEqual(await (await fetch(`${a.base}/api/dispatch`)).json(), { enabled: true });
    assert.equal((await fetch(`${a.base}/api/state`)).status, 200);
    // Wait for listening() to record the port in both locks.
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(JSON.parse(readFileSync(join(ws, '.drawing', 'server.lock'), 'utf8')), { pid: a.child.pid, port: a.port });
    assert.deepEqual(JSON.parse(readFileSync(join(root, '.dispatch', 'drawing.lock'), 'utf8')), { pid: a.child.pid, port: a.port });

    const b = await startServer(ws, home);
    servers.push(b);
    assert.equal(b.code, 1);
    assert.match(b.output(), new RegExp(`Another Drawing server is already running for this workspace: http://127.0.0.1:${a.port}/`));

    const c = await startServer(docs, home);
    servers.push(c);
    assert.equal(c.code, null, c.output());
    const status = await (await fetch(`${c.base}/api/dispatch`)).json();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'other-drawing');
    assert.equal(status.port, a.port);
    assert.match(status.message, /다른 Drawing 서버/);
    assert.equal((await fetch(`${c.base}/api/state`)).status, 404);
    assert.equal((await fetch(`${c.base}/api/tree`)).status, 200, 'drawing still works');
    const extra = c.output().split('\n').filter((l) => !l.startsWith('Drawing: '));
    assert.ok(!extra.some((l) => l.includes(root)), 'no project path in the log besides the workspace line');

    // Stopping the first server frees both locks.
    await a.stop();
    assert.equal(existsSync(join(ws, '.drawing', 'server.lock')), false);
    assert.equal(existsSync(join(root, '.dispatch', 'drawing.lock')), false);
    const d = await startServer(ws, home);
    servers.push(d);
    assert.equal(d.code, null, d.output());
  } finally {
    for (const s of servers) await s.stop();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('real server: outside git Dispatch is off with a reason, and a stale lock from a crash does not block', async () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-nogit-')));
  const home = mkdtempSync(join(tmpdir(), 'drawing-e13-home-'));
  let s;
  try {
    mkdirSync(join(ws, '.drawing'));
    writeFileSync(join(ws, '.drawing', 'server.lock'), JSON.stringify({ pid: await deadPid(), port: 4330 }));
    s = await startServer(ws, home);
    assert.equal(s.code, null, s.output());
    const status = await (await fetch(`${s.base}/api/dispatch`)).json();
    assert.deepEqual(Object.keys(status).sort(), ['enabled', 'message', 'reason']);
    assert.equal(status.reason, 'not-git');
    assert.match(s.output(), /Dispatch off: not-git/);
    assert.equal((await fetch(`${s.base}/api/state`)).status, 404);
    assert.equal(existsSync(join(ws, '.dispatch')), false);
  } finally {
    await s?.stop();
    rmSync(ws, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
