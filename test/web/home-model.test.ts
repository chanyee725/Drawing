import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDENT, ROW_HEIGHT, filterDocs, flattenRows, relativeTime, runningIn } from '../../web/src/home/model.ts';
import type { ProjectDoc } from '../../web/src/api.ts';

const d = (path: string, title: string, children: ProjectDoc[] = []): ProjectDoc => ({ path, name: path, title, bundle: false, createdAt: 1, modifiedAt: 2, children });
const docs = [d('a', 'Login', [d('a/t', 'Token', [d('a/t/r', 'Refresh')])]), d('b', 'Collect')];

test('flattenRows shows children only under an expanded parent, with depth and sub-doc counts', () => {
  const rows = flattenRows(docs, new Set());
  assert.deepEqual(rows.map((r) => [r.doc.title, r.depth]), [['Login', 0], ['Token', 1], ['Refresh', 2], ['Collect', 0]]);
  assert.equal(rows[0].subs, 2);
  const closed = flattenRows(docs, new Set(['a']));
  assert.deepEqual(closed.map((r) => r.doc.title), ['Login', 'Collect']);
  assert.equal(closed[0].expanded, false);
});

test('filterDocs keeps a matching sub-doc under its parents, and a matching parent with its subtree', () => {
  assert.deepEqual(filterDocs(docs, 'refresh').map((x) => x.title), ['Login']);
  assert.equal(filterDocs(docs, 'refresh')[0].children[0].children[0].title, 'Refresh');
  assert.equal(filterDocs(docs, 'login')[0].children.length, 1);
  assert.equal(filterDocs(docs, 'zzz').length, 0);
});

test('relativeTime in Korean, and row metrics match the spec (41px rows, 24px indent)', () => {
  const now = 1_000_000_000_000;
  assert.equal(relativeTime(now - 5 * 60_000, now), '5분 전');
  assert.equal(relativeTime(now - 3 * 3_600_000, now), '3시간 전');
  assert.equal(relativeTime(0, now), '-');
  assert.equal(ROW_HEIGHT, 41);
  assert.equal(INDENT, 24);
});

test('runningIn counts running files inside the project folder only', () => {
  const running = new Set(['pay/a.dpx.json', 'pay/a/b.dpx.json', 'payroll/c.dpx.json', 'loose.dpx.json']);
  assert.equal(runningIn({ path: 'pay' }, running), 2);
  assert.equal(runningIn({ path: 'other' }, running), 0);
});
