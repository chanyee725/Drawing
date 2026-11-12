import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropTarget, pathAfterMove, renameTarget } from '../../web/src/movePaths.ts';
import { createFileSession } from '../../web/src/fileSession.ts';

const file = { type: 'file' as const, path: 'a/b/arch.dpx.json' };
const folder = { type: 'folder' as const, path: 'a/b' };

test('dropping on a folder keeps the base name; same folder is a no-op', () => {
  assert.equal(dropTarget(file, 'x'), 'x/arch.dpx.json');
  assert.equal(dropTarget(file, ''), 'arch.dpx.json');
  assert.equal(dropTarget(file, 'a/b'), null);
  assert.equal(dropTarget(folder, 'x'), 'x/b');
  assert.equal(dropTarget({ type: 'file', path: 'top.dpx.json' }, ''), null);
});

test('a folder cannot drop into itself or a descendant', () => {
  assert.equal(dropTarget(folder, 'a/b'), null);
  assert.equal(dropTarget(folder, 'a/b/c'), null);
  assert.equal(dropTarget(folder, 'a/bc'), 'a/bc/b');
});

test('rename keeps the folder and the file extension', () => {
  assert.equal(renameTarget(file, 'new'), 'a/b/new.dpx.json');
  assert.equal(renameTarget(file, ' new.dpx '), 'a/b/new.dpx.json');
  assert.equal(renameTarget(file, 'arch'), null);
  assert.equal(renameTarget(folder, 'c'), 'a/c');
  assert.equal(renameTarget({ type: 'folder', path: 'top' }, 'other'), 'other');
});

test('rename refuses empty names, slashes and dot names', () => {
  for (const bad of ['', '  ', 'x/y', 'x\\y', '.', '..']) assert.equal(renameTarget(file, bad), null, bad);
});

test('the open path follows its file or its folder', () => {
  assert.equal(pathAfterMove('a/b/arch', 'a/b/arch.dpx.json', 'a/c/arch.dpx.json', 'file'), 'a/c/arch.dpx.json');
  assert.equal(pathAfterMove('a/b/arch.dpx.json', 'a/b/arch', 'z.dpx.json', 'file'), 'z.dpx.json');
  assert.equal(pathAfterMove('a/b/arch.dpx.json', 'a/b', 'x/b', 'folder'), 'x/b/arch.dpx.json');
  assert.equal(pathAfterMove('a/bc/arch.dpx.json', 'a/b', 'x/b', 'folder'), null);
  assert.equal(pathAfterMove('other.dpx.json', 'a/b', 'x', 'folder'), null);
  assert.equal(pathAfterMove(null, 'a', 'b', 'file'), null);
});

test('session.rename changes the save path without dropping the content', async () => {
  const saved: string[] = [];
  const s = createFileSession({ saveFile: async (p) => (saved.push(p), { revision: 2 }) });
  s.load('a.dpx.json', { version: 2, title: 't', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 1 });
  s.edit({ title: 'changed' });
  s.rename('b/a.dpx.json');
  assert.equal(s.getState().path, 'b/a.dpx.json');
  assert.equal(s.getState().file?.title, 'changed');
  await s.flush();
  assert.deepEqual(saved, ['b/a.dpx.json']);
  const closed = createFileSession({ saveFile: async () => ({ revision: 1 }) });
  closed.rename('x');
  assert.equal(closed.getState().path, null);
});
