import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { nowLine } from '../../web/src/dispatch/lib/turn.ts';

test('nowLine returns only the activity label and its start', () => {
  const s = { activity: { label: '단위 테스트', since: 5, command: 'npm test -- secret' }, last: 'rm -rf x', pending: [] };
  assert.deepEqual(nowLine(s as never), { label: '단위 테스트', since: 5 });
});

test('nowLine is null without an activity label', () => {
  assert.equal(nowLine({ activity: null }), null);
  assert.equal(nowLine({}), null);
  assert.equal(nowLine({ activity: { label: '', since: 1 } }), null);
  assert.equal(nowLine({ last: 'git push' } as never), null);
});

test('inside web/src/dispatch only lib/turn.ts reads .activity', () => {
  const root = join(import.meta.dirname, '../../web/src/dispatch');
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
  const files = walk(root);
  assert.ok(files.length > 5);
  const readers = files.filter(f => /\.activity\b/.test(readFileSync(f, 'utf8'))).map(f => relative(root, f).split(sep).join('/'));
  assert.deepEqual(readers, ['lib/turn.ts']);
});
