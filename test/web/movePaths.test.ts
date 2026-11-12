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

import { moveErrorText, nameProblem } from '../../web/src/movePaths.ts';

test('name problems are Korean and specific', () => {
  assert.match(nameProblem(file, 'a/b')!, /\//);
  assert.match(nameProblem(file, 'a\\b')!, /\\/);
  assert.ok(!nameProblem(file, 'a\\b')!.includes('/를 넣을 수 없어요'));
  assert.match(nameProblem(file, '..')!, /\.\./);
  assert.match(nameProblem(file, '.')!, /\./);
  assert.match(nameProblem(file, '.hidden')!, /점/);
  assert.match(nameProblem(folder, 'x.dpx.json')!, /\.dpx/);
  assert.equal(nameProblem(file, 'x.dpx.json'), null);
  assert.equal(nameProblem(file, '  '), null);
});

test('server errors become Korean text', () => {
  assert.equal(moveErrorText(409, 'target already exists'), '같은 이름이 이미 있어요.');
  assert.match(moveErrorText(400, 'hidden names are not allowed'), /점/);
  assert.match(moveErrorText(400, 'folder names cannot end with .dpx.json'), /\.dpx/);
  assert.doesNotMatch(moveErrorText(500, 'boom'), /[a-z]{4}/);
});

test('session.rename can take the revision the server raised', () => {
  const s = createFileSession({ saveFile: async () => ({ revision: 1 }) });
  s.load('a.dpx.json', { version: 2, title: 't', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 1 });
  s.rename('b.dpx.json', 5);
  assert.equal(s.getState().file?.revision, 5);
});

test('the rename field starts from the file name without the extension, not the title', async () => {
  const { renameInitial } = await import('../../web/src/movePaths.ts');
  assert.equal(renameInitial({ type: 'file', name: 'arch.dpx.json' }), 'arch');
  assert.equal(renameInitial({ type: 'folder', name: 'team.notes' }), 'team.notes');
});
