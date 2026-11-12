import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_PREF_KEY, activityQuery, gateActivity, readActivityPref, writeActivityPref } from '../web/src/agents/activityPref.ts';

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

test('activity pref: off by default, on after writing, survives a re-read', () => {
  const s = memStore();
  assert.equal(readActivityPref(s), false);
  assert.equal(readActivityPref(null), false);
  writeActivityPref(s, true);
  assert.equal(s.m.get(ACTIVITY_PREF_KEY), '1');
  assert.equal(readActivityPref(s), true);
  writeActivityPref(s, false);
  assert.equal(readActivityPref(s), false);
});

test('activity pref: blocked storage reads as off and writing does not throw', () => {
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readActivityPref(bad), false);
  assert.doesNotThrow(() => writeActivityPref(bad, true));
});

test('activityQuery asks the server only when on', () => {
  assert.equal(activityQuery(false), '');
  assert.equal(activityQuery(true), '?activity=1');
});

test('gateActivity blanks the line when off, keeps name/role/status', () => {
  const a = { id: 'a', name: 'impl-1', role: 'impl', roleName: '구현자', status: 'running', activity: 'hello', activityAt: 5, lastChange: null };
  const [off] = gateActivity([a], false);
  assert.equal(off.activity, '');
  assert.equal(off.activityAt, null);
  assert.equal(off.name, 'impl-1');
  assert.equal(off.roleName, '구현자');
  assert.equal(off.status, 'running');
  assert.equal(gateActivity([a], true)[0].activity, 'hello');
});
