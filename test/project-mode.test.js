// Other-project mode (E30a): --project-mode flag, /api/info mode, and plugin/scripts/start.sh.
// Everything runs in a temp dir with a scratch git repo; no agent CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { parseArgs } from '../server/cli.js';

const START = new URL('../plugin/scripts/start.sh', import.meta.url).pathname;

test('parseArgs: --project-mode flag and DRAW_MODE', () => {
  assert.equal(parseArgs(['/w'], {}).projectMode, false);
  assert.equal(parseArgs(['--project-mode', '/w'], {}).projectMode, true);
  assert.equal(parseArgs(['/w'], { DRAW_MODE: 'project' }).projectMode, true);
  assert.throws(() => parseArgs(['--nope', '/w'], {}), /Unknown option/);
});

test('/api/info reports the mode', async () => {
  for (const [projectMode, mode] of [[false, 'drawing'], [true, 'project']]) {
    const app = await createApp({ workspaceDir: '/tmp/x', projectMode }, { moduleList: [] });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    try {
      const info = await (await fetch(`http://127.0.0.1:${app.server.address().port}/api/info`)).json();
      assert.equal(info.mode, mode);
    } finally {
      await app.close();
    }
  }
});

test('start.sh starts project mode on <project>/pipelines, remembers the port and reuses the server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  const project = join(dir, 'proj');
  const home = join(dir, 'home');
  execFileSync('mkdir', ['-p', project, home]);
  const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(project, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const env = { ...process.env, HOME: home, DISPATCH_PORT: '', DRAW_PORT: '' };
  const run = () => spawnSync('bash', [START, project], { env, encoding: 'utf8' });
  let port = null;
  try {
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    port = readFileSync(join(project, '.dispatch', 'server.port'), 'utf8').trim();
    assert.equal(first.stdout.trim(), `http://127.0.0.1:${port}/dispatch`);
    assert.ok(existsSync(join(project, 'pipelines')));
    const pid = Number(readFileSync(join(project, '.dispatch', 'server.pid'), 'utf8'));
    assert.doesNotThrow(() => process.kill(pid, 0), 'server.pid names the running server');
    const info = await (await fetch(`http://127.0.0.1:${port}/api/info`)).json();
    assert.deepEqual(info, { workspace: 'pipelines', mode: 'project' });
    // Second call reuses the running server: same port, no new process.
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout.trim(), first.stdout.trim());
    assert.equal(readFileSync(join(project, '.dispatch', 'server.port'), 'utf8').trim(), port);
  } finally {
    if (port) {
      try {
        const lock = JSON.parse(readFileSync(join(project, 'pipelines', '.drawing', 'server.lock'), 'utf8'));
        process.kill(lock.pid, 'SIGTERM');
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh honors DISPATCH_PORT when it is free and stop.sh-style kill by server.pid ends it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  const project = join(dir, 'proj');
  execFileSync('mkdir', ['-p', project, join(dir, 'home')]);
  const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(project, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const want = probe.address().port;
  await new Promise((r) => probe.close(r));
  const r = spawnSync('bash', [START, project], { env: { ...process.env, HOME: join(dir, 'home'), DRAW_PORT: '', DISPATCH_PORT: String(want) }, encoding: 'utf8' });
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), `http://127.0.0.1:${want}/dispatch`);
  } finally {
    try { process.kill(Number(readFileSync(join(project, '.dispatch', 'server.pid'), 'utf8')), 'SIGTERM'); } catch {}
    await new Promise((res) => setTimeout(res, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh: DRAW_PORT wins over DISPATCH_PORT', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  const project = join(dir, 'proj');
  execFileSync('mkdir', ['-p', project, join(dir, 'home')]);
  const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(project, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const free = async () => {
    const s = createServer();
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const p = s.address().port;
    await new Promise((r) => s.close(r));
    return p;
  };
  const [a, b] = [await free(), await free()];
  const r = spawnSync('bash', [START, project], { env: { ...process.env, HOME: join(dir, 'home'), DRAW_PORT: String(a), DISPATCH_PORT: String(b) }, encoding: 'utf8' });
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), `http://127.0.0.1:${a}/dispatch`);
    assert.equal(existsSync(join(dir, 'home', '.dispatch', 'servers')), false, 'no registry written');
  } finally {
    try { process.kill(Number(readFileSync(join(project, '.dispatch', 'server.pid'), 'utf8')), 'SIGTERM'); } catch {}
    await new Promise((res) => setTimeout(res, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("start.sh does not reuse another project's server that took the remembered port", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  const home = join(dir, 'home');
  execFileSync('mkdir', ['-p', home]);
  const makeProject = (name) => {
    const project = join(dir, name);
    execFileSync('mkdir', ['-p', project]);
    const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
    git('init', '-q', '-b', 'develop');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(project, 'README.md'), 'scratch\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    return project;
  };
  const a = makeProject('a');
  const b = makeProject('b');
  const fakeCli = new URL('./fixtures/fake-cli', import.meta.url).pathname;
  const env = (port = '') => ({ ...process.env, HOME: home, PATH: `${fakeCli}:${process.env.PATH}`, DISPATCH_PORT: '', DRAW_PORT: port });
  const start = (project, port) => spawnSync('bash', [START, project], { env: env(port), encoding: 'utf8' });
  const lockPid = (project) => JSON.parse(readFileSync(join(project, 'pipelines', '.drawing', 'server.lock'), 'utf8')).pid;
  const pids = new Set();
  try {
    const first = start(a);
    assert.equal(first.status, 0, first.stderr);
    const port = readFileSync(join(a, '.dispatch', 'server.port'), 'utf8').trim();
    // Kill A hard: its lock stays behind, naming the port with a dead pid.
    const pidA = Number(readFileSync(join(a, '.dispatch', 'server.pid'), 'utf8'));
    process.kill(pidA, 'SIGKILL');
    for (let i = 0; i < 50; i++) {
      try { process.kill(pidA, 0); } catch { break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    // B takes A's old port.
    const other = start(b, port);
    assert.equal(other.status, 0, other.stderr);
    assert.equal(other.stdout.trim(), `http://127.0.0.1:${port}/dispatch`);
    pids.add(lockPid(b));
    // A again: B answers on the remembered port as project mode on "pipelines", but it is not ours.
    const again = start(a);
    assert.equal(again.status, 0, again.stderr);
    pids.add(lockPid(a));
    assert.notEqual(again.stdout.trim(), `http://127.0.0.1:${port}/dispatch`, "reused another project's server");
    const newPort = readFileSync(join(a, '.dispatch', 'server.port'), 'utf8').trim();
    assert.notEqual(newPort, port);
    assert.equal(again.stdout.trim(), `http://127.0.0.1:${newPort}/dispatch`);
    const lockA = JSON.parse(readFileSync(join(a, 'pipelines', '.drawing', 'server.lock'), 'utf8'));
    assert.equal(String(lockA.port), newPort);
    assert.equal(lockA.pid, Number(readFileSync(join(a, '.dispatch', 'server.pid'), 'utf8')));
    // And A's own live server is still reused.
    const reuse = start(a);
    assert.equal(reuse.status, 0, reuse.stderr);
    assert.equal(reuse.stdout.trim(), again.stdout.trim());
  } finally {
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh refuses a folder that is not a git project top', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  try {
    const r = spawnSync('bash', [START, dir], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Not a git project/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
