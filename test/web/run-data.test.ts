import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDataForTests, selectRun, shownRun, watchRun } from '../../web/src/run/runData.ts';
import type { RunSummary } from '../../web/src/run/runModel.ts';

const s = (id: string, state: RunSummary['state']) => ({ id, state, startedAt: Number(id), endedAt: null, totals: { cost: 0, mtok: 0 } }) as unknown as RunSummary;

test('shownRun: the picked run while listed, else the live run, else the newest', () => {
  const runs = [s('3', 'done'), s('2', 'stopped'), s('1', 'done')];
  assert.equal(shownRun(runs, '2')?.id, '2');
  assert.equal(shownRun(runs, null)?.id, '3');
  assert.equal(shownRun(runs, 'gone')?.id, '3');
  assert.equal(shownRun([s('2', 'done'), s('1', 'running')], null)?.id, '1');
  assert.equal(shownRun([], '1'), null);
});

test('selectRun: keeps the picked run across reloads, the default clears it, another file resets it', async () => {
  const runs = [s('3', 'done'), s('2', 'stopped'), s('1', 'done')];
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    if (url.startsWith('/api/runs?')) return new Response(JSON.stringify({ runs }));
    const id = new URL(url, 'http://x').searchParams.get('id');
    return new Response(JSON.stringify({ id, state: runs.find((r) => r.id === id)?.state }));
  }) as unknown as typeof fetch;
  try {
    watchRun('p/a.dpx.json');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(runDataForTests().record?.id, '3');

    await selectRun('2');
    assert.equal(runDataForTests().selected, '2');
    assert.equal(runDataForTests().record?.id, '2');

    await selectRun('3');
    assert.equal(runDataForTests().selected, null, 'the default run clears the choice');
    assert.equal(runDataForTests().record?.id, '3');

    await selectRun('1');
    watchRun('p/b.dpx.json');
    assert.equal(runDataForTests().selected, null);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(asked.some((u) => u.includes('id=1')));
  } finally {
    globalThis.fetch = real;
    watchRun(null);
  }
});
