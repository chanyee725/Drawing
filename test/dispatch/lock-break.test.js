// The .break mutex that guards replacing a stale lock (#199, from the #161 review). Three or more
// servers starting on a dead .break used to let two of them into the critical section: a waiter
// that judged the dead holder, then resumed after someone else had cleared it and taken the break,
// moved or removed the live holder's .break. These tests drive that interleaving in one process with
// owner names instead of pids, so the order is fixed and the test fails on the old behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireBreak } from '../../server/lock.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDead = async (name) => name.startsWith('dead-');

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-199-'));
  return { dir, brk: join(dir, 'x.lock.break') };
}

test('acquireBreak: a waiter that judged a dead holder and resumes late cannot let a second holder in', async () => {
  const { dir, brk } = scratch();
  try {
    await acquireBreak(brk, { owner: 'dead-D', isDead }); // D takes the break and dies holding it
    let judged;
    const judgedP = new Promise((r) => { judged = r; });
    let resume;
    const gate = new Promise((r) => { resume = r; });
    // A reads the break, judges D dead, and stalls before it acts on that judgement.
    const a = acquireBreak(brk, {
      owner: 'live-A',
      isDead: async (name) => {
        if (name === 'dead-D') { judged(); await gate; }
        return isDead(name);
      },
    });
    let aIn = false;
    a.then(() => { aIn = true; });
    await judgedP;
    // B clears D and takes the break while A is stalled.
    const releaseB = await acquireBreak(brk, { owner: 'live-B', isDead });
    assert.deepEqual(readdirSync(brk), ['live-B']);
    // A resumes with its stale judgement; C arrives too. Neither may get in while B holds.
    resume();
    let cIn = false;
    const c = acquireBreak(brk, { owner: 'live-C', isDead });
    c.then(() => { cIn = true; });
    await sleep(200);
    assert.equal(aIn, false, 'A stays out while B holds');
    assert.equal(cIn, false, 'C stays out while B holds');
    assert.deepEqual(readdirSync(brk), ['live-B'], "B's break is untouched");
    // B lets go: A and C get in one at a time.
    await releaseB();
    const [first, release1] = await Promise.race([a.then((r) => ['A', r]), c.then((r) => ['C', r])]);
    await sleep(100);
    assert.equal(aIn && cIn, false, 'only one of A and C holds');
    assert.deepEqual(readdirSync(brk), [`live-${first}`]);
    await release1();
    const release2 = await (first === 'A' ? c : a);
    await release2();
    assert.deepEqual(readdirSync(dir), [], 'no break, staging or aside files left behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: several waiters on one dead holder enter one at a time', async () => {
  const { dir, brk } = scratch();
  try {
    await acquireBreak(brk, { owner: 'dead-D', isDead });
    let inside = 0;
    let most = 0;
    await Promise.all(Array.from({ length: 6 }, async (_, i) => {
      const release = await acquireBreak(brk, { owner: `live-${i}`, isDead });
      inside++;
      most = Math.max(most, inside);
      await sleep(5);
      inside--;
      await release();
    }));
    assert.equal(most, 1);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: a release never removes a break someone else holds', async () => {
  const { dir, brk } = scratch();
  try {
    const releaseA = await acquireBreak(brk, { owner: 'live-A', isDead });
    // A was wrongly judged gone and its break was replaced by B's; A's late release must not touch B's.
    rmSync(brk, { recursive: true });
    const releaseB = await acquireBreak(brk, { owner: 'live-B', isDead });
    await releaseA();
    assert.deepEqual(readdirSync(brk), ['live-B']);
    await releaseB();
    assert.equal(existsSync(brk), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: an old-style .break file is cleared when its pid is dead and waited on when it is live', async () => {
  const { dir, brk } = scratch();
  try {
    writeFileSync(brk, JSON.stringify({ pid: 2 ** 22 + 54321 }));
    const release = await acquireBreak(brk, { owner: 'live-A', isDead });
    assert.deepEqual(readdirSync(brk), ['live-A']);
    await release();
    writeFileSync(brk, JSON.stringify({ pid: process.pid }));
    await assert.rejects(acquireBreak(brk, { owner: 'live-B', isDead, tries: 5 }), { name: 'LockBreakTimeoutError' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
