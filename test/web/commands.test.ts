import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry, filterCommands, groupCommands, type Command } from '../../web/src/commands.ts';

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({ id, title: id, run: () => {}, ...extra });

test('filter matches title or keyword, case-insensitive; search-only commands wait for a query', () => {
  const items = [cmd('Zoom in', { keywords: ['확대'] }), cmd('Export'), cmd('Plan', { searchOnly: true })];
  assert.deepEqual(filterCommands(items, '').map((c) => c.id), ['Zoom in', 'Export']);
  assert.deepEqual(filterCommands(items, '  zoom ').map((c) => c.id), ['Zoom in']);
  assert.deepEqual(filterCommands(items, '확대').map((c) => c.id), ['Zoom in']);
  assert.deepEqual(filterCommands(items, 'pla').map((c) => c.id), ['Plan']);
  assert.deepEqual(filterCommands(items, 'nothing'), []);
});

test('groups follow the menu order, keep registration order inside and drop empty sections', () => {
  const items = [cmd('f', { group: 'file' }), cmd('a1'), cmd('c', { group: 'canvas' }), cmd('a2', { group: 'action' })];
  const groups = groupCommands(items);
  assert.deepEqual(
    groups.map((g) => [g.id, g.label, g.items.map((c) => c.id)]),
    [
      ['action', '동작', ['a1', 'a2']],
      ['canvas', '캔버스', ['c']],
      ['file', '파일', ['f']],
    ],
  );
});

test('registry lists sources fresh on every call, in registration order, first id wins', () => {
  const r = new CommandRegistry();
  let title = 'old';
  r.register('app', () => [cmd('a', { title })]);
  const off = r.register('plugin', () => [cmd('p'), cmd('a', { title: 'shadow' })]);
  assert.deepEqual(r.list().map((c) => c.title), ['old', 'p']);
  title = 'new';
  assert.equal(r.list()[0].title, 'new');
  off();
  assert.deepEqual(r.list().map((c) => c.id), ['a']);
});

test('re-registering a name replaces it, and a stale unregister leaves the new source alone', () => {
  const r = new CommandRegistry();
  const offOld = r.register('x', () => [cmd('one')]);
  r.register('x', () => [cmd('two')]);
  assert.deepEqual(r.list().map((c) => c.id), ['two']);
  offOld();
  assert.deepEqual(r.list().map((c) => c.id), ['two']);
});
