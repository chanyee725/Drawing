import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, highlightKind, playable, stepIndex, timeline, whoLabel } from '../web/src/history/timeline.ts';

const v = (seq, at, extra = {}) => ({
  seq,
  at,
  source: { kind: 'main', label: 'main' },
  agent: null,
  page: { id: 'p', name: 'P' },
  kinds: [],
  summary: '',
  cellCount: 1,
  snapshot: true,
  ...extra,
});

test('timeline: versions and commits merged newest first, versions win ties', () => {
  const items = timeline([v(1, 100), v(2, 300), v(3, 300)], [{ sha: 'a', at: 200, subject: 's' }, { sha: 'b', at: 300, subject: 't' }]);
  assert.deepEqual(
    items.map((i) => (i.type === 'version' ? `v${i.version.seq}` : `g${i.commit.sha}`)),
    ['v3', 'v2', 'gb', 'ga', 'v1'],
  );
});

test('playable: oldest first, only versions with content', () => {
  assert.deepEqual(playable([v(3, 3), v(1, 1), v(2, 2, { snapshot: false })]).map((x) => x.seq), [1, 3]);
});

test('stepIndex: from live, forward starts at the first step, back at the last; clamps at the ends', () => {
  assert.equal(stepIndex(-1, 1, 12), 0);
  assert.equal(stepIndex(-1, -1, 12), 11);
  assert.equal(stepIndex(0, -1, 12), 0);
  assert.equal(stepIndex(5, 1, 12), 6);
  assert.equal(stepIndex(11, 1, 12), 11);
  assert.equal(stepIndex(0, 1, 0), -1);
});

test('highlightKind and labels', () => {
  assert.equal(highlightKind(['added']), 'added');
  assert.equal(highlightKind(['removed']), 'removed');
  assert.equal(highlightKind(['moved', 'text']), 'changed');
  assert.equal(whoLabel(v(1, 1)), '메인');
  assert.equal(whoLabel(v(1, 1, { source: { kind: 'worktree', label: 'impl-2' } })), 'impl-2');
  assert.equal(whoLabel(v(1, 1, { agent: { name: 'impl-2', role: 'implementer' } })), 'impl-2 · implementer');
  const now = new Date(2026, 10, 12, 15, 0, 0).getTime();
  assert.equal(formatTime(new Date(2026, 10, 12, 9, 5, 7).getTime(), now), '09:05:07');
  assert.equal(formatTime(new Date(2026, 10, 3, 14, 3).getTime(), now), '11월 3일 14:03');
  assert.equal(formatTime(new Date(2025, 0, 2, 8, 0).getTime(), now), '2025년 1월 2일 08:00');
});
