import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDENT, ROW_HEIGHT, filterDocs, pollWhileVisible, relativeTime, runningBelow, runningIn, subCount } from '../../web/src/home/model.ts';
import type { ProjectDoc } from '../../web/src/api.ts';

const d = (path: string, title: string, children: ProjectDoc[] = []): ProjectDoc => ({ path, name: path, title, bundle: false, createdAt: 1, modifiedAt: 2, children });
const docs = [d('a', 'Login', [d('a/t', 'Token', [d('a/t/r', 'Refresh')])]), d('b', 'Collect')];

test('subCount counts sub-docs at every level; runningBelow sees a run anywhere under a parent but not the parent itself', () => {
  assert.equal(subCount(docs[0]), 2);
  assert.equal(subCount(docs[1]), 0);
  assert.equal(runningBelow(docs[0], new Set(['a/t/r'])), true);
  assert.equal(runningBelow(docs[0], new Set(['a'])), false);
  assert.equal(runningBelow(docs[1], new Set(['a/t'])), false);
});

function fakePage(state: 'visible' | 'hidden') {
  const listeners = new Set<() => void>();
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    doc: {
      visibilityState: state as string,
      addEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.add(fn),
      removeEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.delete(fn),
    },
    timers: { setInterval: (fn: () => void) => (timers.set(++id, fn), id), clearInterval: (t: unknown) => void timers.delete(t as number) },
    tick: () => [...timers.values()].forEach((fn) => fn()),
    show(next: 'visible' | 'hidden') {
      this.doc.visibilityState = next;
      listeners.forEach((fn) => fn());
    },
    get counts() {
      return { timers: timers.size, listeners: listeners.size };
    },
  };
}

test('pollWhileVisible: polls while visible, stops while hidden, loads at once when shown again', () => {
  const page = fakePage('visible');
  let loads = 0;
  const stop = pollWhileVisible(() => loads++, 10_000, page.doc, page.timers);
  assert.equal(loads, 1, 'loads right away');
  page.tick();
  assert.equal(loads, 2);
  page.show('hidden');
  assert.equal(page.counts.timers, 0, 'no timer while hidden');
  page.tick();
  assert.equal(loads, 2);
  page.show('visible');
  assert.equal(loads, 3, 'catches up as soon as it shows');
  assert.equal(page.counts.timers, 1);
  stop();
  assert.deepEqual(page.counts, { timers: 0, listeners: 0 });
});

test('pollWhileVisible: a page opened hidden waits until it shows', () => {
  const page = fakePage('hidden');
  let loads = 0;
  pollWhileVisible(() => loads++, 10_000, page.doc, page.timers);
  assert.equal(loads, 0);
  assert.equal(page.counts.timers, 0);
  page.show('visible');
  assert.equal(loads, 1);
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
