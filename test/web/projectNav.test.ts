import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asTreeNode, newFileDir, openPathsFor, percent, projectOf, shellKey, subFolderOf } from '../../web/src/projectNav.ts';
import type { DocNode, ProjectsView } from '../../web/src/api.ts';

const doc = (path: string, children: DocNode[] = []): DocNode => ({
  type: 'doc',
  path,
  name: path.split('/').pop()!.replace('.dpx.json', ''),
  title: 't',
  revision: 1,
  created: null,
  modified: null,
  count: children.length,
  children,
});
const view: ProjectsView = {
  projects: [
    {
      path: 'A',
      name: 'Alpha',
      icon: null,
      description: '',
      created: null,
      modified: null,
      count: 3,
      docs: [doc('A/login.dpx.json', [doc('A/login/token.dpx.json', [doc('A/login/token/exp.dpx.json')])]), { ...doc('A/g'), type: 'group', children: [doc('A/g/m.dpx.json')] }],
    },
  ],
  loose: [doc('x.dpx.json')],
};

test('projectOf and openPathsFor find the project and the rows above a document', () => {
  assert.equal(projectOf(view, 'A/login/token.dpx.json')?.path, 'A');
  assert.equal(projectOf(view, 'x.dpx.json'), null);
  assert.equal(projectOf(null, 'A/x.dpx.json'), null);
  assert.deepEqual(openPathsFor(view, 'A/login/token/exp.dpx.json').sort(), ['A', 'A/login.dpx.json', 'A/login/token.dpx.json']);
  assert.deepEqual(openPathsFor(view, 'A/g/m.dpx.json').sort(), ['A', 'A/g']);
  assert.deepEqual(openPathsFor(view, 'x.dpx.json'), []);
});

test('asTreeNode, subFolderOf and newFileDir', () => {
  assert.deepEqual(asTreeNode(doc('A/login.dpx.json')), { type: 'file', name: 'login.dpx.json', path: 'A/login.dpx.json', title: 't', revision: 1 });
  assert.deepEqual(asTreeNode(view.projects[0]), { type: 'folder', name: 'A', path: 'A', children: [] });
  assert.equal(subFolderOf('A/login.dpx.json'), 'A/login');
  assert.equal(newFileDir({ kind: 'project', path: 'A' }, view, null), 'A');
  assert.equal(newFileDir({ kind: 'doc' }, view, 'A/login.dpx.json'), 'A');
  assert.equal(newFileDir({ kind: 'doc' }, view, 'x.dpx.json'), '');
  assert.equal(newFileDir({ kind: 'all' }, view, 'A/login.dpx.json'), '');
});

const key = (code: string, more: Record<string, unknown> = {}) =>
  shellKey({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, target: null, ...more });
const inside = (match: boolean) => ({ closest: () => (match ? {} : null) }) as unknown as EventTarget;

test('shellKey: A R B N , outside fields, editors, the canvas and dialogs only', () => {
  assert.deepEqual(['KeyA', 'KeyR', 'KeyB', 'KeyN', 'Comma'].map((c) => key(c)), ['all', 'recent', 'archive', 'new', 'settings']);
  assert.equal(key('KeyX'), null);
  for (const m of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing', 'repeat', 'defaultPrevented']) assert.equal(key('KeyA', { [m]: true }), null, m);
  assert.equal(key('KeyA', { target: inside(true) }), null);
  assert.equal(key('KeyA', { target: inside(false) }), 'all');
});

test('percent clamps and rounds', () => {
  assert.equal(percent(0.424), 42);
  assert.equal(percent(1.4), 100);
  assert.equal(percent(null), null);
  assert.equal(percent(Number.NaN), null);
});
