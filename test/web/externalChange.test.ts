import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalAction } from '../../web/src/externalChange.ts';

const open = 'proj/arch.dpx.json';

test('the open file deleted or moved away closes it, so its save timer is cancelled', () => {
  assert.equal(externalAction({ kind: 'delete', path: 'proj/arch.dpx.json' }, open, true), 'close');
  assert.equal(externalAction({ kind: 'tree', path: 'x/arch.dpx.json', from: 'proj/arch' }, open, false), 'close');
  assert.equal(externalAction({ kind: 'tree', path: 'moved', from: 'proj' }, open, false), 'close');
});

test('a deleted folder closes a file open under it, and only that', () => {
  assert.equal(externalAction({ kind: 'tree', path: 'proj', from: 'proj' }, open, true), 'close');
  assert.equal(externalAction({ kind: 'tree', path: 'proj/sub', from: 'proj/sub' }, open, false), 'refresh');
  assert.equal(externalAction({ kind: 'tree', path: 'pro', from: 'pro' }, open, false), 'refresh');
});

test('a changed open file reloads only when nothing is unsaved', () => {
  assert.equal(externalAction({ kind: 'change', path: open, revision: 4 }, open, false), 'reload');
  assert.equal(externalAction({ kind: 'change', path: open, revision: 4 }, open, true), 'refresh');
});

test('other files only refresh the list', () => {
  assert.equal(externalAction({ kind: 'delete', path: 'proj/other.dpx.json' }, open, false), 'refresh');
  assert.equal(externalAction({ kind: 'create', path: open }, open, false), 'refresh');
  assert.equal(externalAction({ kind: 'tree', path: 'proj2' }, open, false), 'refresh');
  assert.equal(externalAction({ kind: 'delete', path: open }, null, false), 'refresh');
});
