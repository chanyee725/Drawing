import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packBundle } from '../scripts/pack.mjs';

function fakeRoot({ version = '1.2.3', withPublic = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pack-src-'));
  const put = (rel, text = 'x') => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put('package.json', JSON.stringify({ name: 'drawing', version, type: 'module', engines: { node: '>=22' }, devDependencies: { vite: '1' } }));
  put('NOTICE.md');
  put('server/index.js');
  put('server/node_modules/dep/index.js');
  put('shared/dispatch/plan.ts');
  put('plugin/.claude-plugin/plugin.json', JSON.stringify({ name: 'dispatch', version: '0.0.0' }));
  put('plugin/hooks/hooks.json', '{}');
  put('plugin/skills/dispatch/SKILL.md');
  put('plugin/.env', 'SECRET=1');
  put('test/a.test.js');
  put('web/src/main.tsx');
  if (withPublic) put('public/index.html', '<html></html>');
  return root;
}

const list = (file) => execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('pack: bundle holds server, shared, public, plugin and nothing else', () => {
  const root = fakeRoot();
  const out = mkdtempSync(join(tmpdir(), 'pack-out-'));
  try {
    const file = packBundle({ root, out });
    assert.equal(file, join(out, 'drawing-1.2.3.tgz'));
    const names = list(file);
    for (const want of ['server/index.js', 'shared/dispatch/plan.ts', 'public/index.html', 'plugin/hooks/hooks.json', 'plugin/skills/dispatch/SKILL.md', 'package.json', 'NOTICE.md']) {
      assert.ok(names.includes(`drawing-1.2.3/${want}`), `missing ${want}`);
    }
    for (const bad of ['node_modules', '.env', 'test/', 'web/']) {
      assert.ok(!names.some((n) => n.includes(bad)), `must not ship ${bad}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('pack: plugin version follows package.json and dev dependencies are dropped', () => {
  const root = fakeRoot({ version: '2.0.1' });
  const out = mkdtempSync(join(tmpdir(), 'pack-out-'));
  const dest = mkdtempSync(join(tmpdir(), 'pack-x-'));
  try {
    execFileSync('tar', ['-xzf', packBundle({ root, out }), '-C', dest]);
    const plugin = JSON.parse(readFileSync(join(dest, 'drawing-2.0.1/plugin/.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(plugin.version, '2.0.1');
    const pkg = JSON.parse(readFileSync(join(dest, 'drawing-2.0.1/package.json'), 'utf8'));
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.devDependencies, undefined);
  } finally {
    for (const d of [root, out, dest]) rmSync(d, { recursive: true, force: true });
  }
});

test('pack: same inputs give the same bytes', () => {
  const root = fakeRoot();
  const out = mkdtempSync(join(tmpdir(), 'pack-out-'));
  try {
    const a = readFileSync(packBundle({ root, out }));
    const b = readFileSync(packBundle({ root, out }));
    assert.ok(a.equals(b));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('pack: refuses without a built public/ or a semver version', () => {
  const noPublic = fakeRoot({ withPublic: false });
  const badVersion = fakeRoot({ version: 'next' });
  const out = mkdtempSync(join(tmpdir(), 'pack-out-'));
  try {
    assert.throws(() => packBundle({ root: noPublic, out }), /npm run build/);
    assert.throws(() => packBundle({ root: badVersion, out }), /semver/);
  } finally {
    for (const d of [noPublic, badVersion, out]) rmSync(d, { recursive: true, force: true });
  }
});

test('pack: shipped plugin has valid manifests, hooks.json and skills', () => {
  const dir = new URL('../plugin/', import.meta.url).pathname;
  const mp = JSON.parse(readFileSync(join(dir, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(mp.name, 'dispatch');
  assert.equal(JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).name, 'dispatch');
  assert.ok(JSON.parse(readFileSync(join(dir, 'hooks/hooks.json'), 'utf8')).hooks.PostToolUse);
  for (const s of ['dispatch', 'dispatch-team', 'dispatch-update']) {
    assert.match(readFileSync(join(dir, 'skills', s, 'SKILL.md'), 'utf8'), new RegExp(`^---\\nname: ${s}\\n`));
  }
});

test('dispatch-update: unpacks the release bundle that gh serves, into DRAWING_HOME', () => {
  const root = fakeRoot({ version: '3.1.4' });
  const work = mkdtempSync(join(tmpdir(), 'upd-'));
  try {
    const bundle = packBundle({ root, out: join(work, 'rel') });
    const bin = join(work, 'bin');
    mkdirSync(bin);
    // Fake gh: `release view` prints a tag, `release download` copies the bundle to --dir.
    writeFileSync(join(bin, 'gh'), `#!/bin/sh
if [ "$2" = view ]; then echo v3.1.4; exit 0; fi
while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done
cp "${bundle}" "$dir/"
`, { mode: 0o755 });
    const home = join(work, 'home');
    mkdirSync(home);
    const script = new URL('../plugin/skills/dispatch-update/scripts/update.sh', import.meta.url).pathname;
    const out = execFileSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, DRAWING_HOME: join(home, 'd') },
    });
    assert.match(out, /drawing-3\.1\.4/);
    assert.match(readFileSync(join(home, 'd/current/plugin/.claude-plugin/plugin.json'), 'utf8'), /"version": "3.1.4"/);
    assert.ok(readFileSync(join(home, 'd/current/server/index.js'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
