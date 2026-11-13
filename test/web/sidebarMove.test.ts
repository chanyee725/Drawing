import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveDestinations, moveItemOf, moveTarget, subdocsMove } from '../../web/src/sidebarMove.ts';
import type { DocNode, Project, ProjectsView } from '../../web/src/api.ts';

const doc = (path: string, children: DocNode[] = []): DocNode => ({
  type: 'doc',
  path,
  name: path.split('/').pop()!.replace('.dpx.json', ''),
  title: '',
  revision: 1,
  created: null,
  modified: null,
  count: children.length,
  children,
});
const group = (path: string, children: DocNode[] = []): DocNode => ({ ...doc(path, children), type: 'group', name: path.split('/').pop()! });
const project = (path: string, name: string, docs: DocNode[]): Project => ({ path, name, icon: null, description: '', created: null, modified: null, count: 0, docs });

const login = doc('A/login.dpx.json', [doc('A/login/token.dpx.json'), group('A/login/inner', [doc('A/login/inner/n.dpx.json')])]);
const g = group('A/g', [doc('A/g/m.dpx.json'), group('A/g/deep')]);
const view: ProjectsView = { projects: [project('A', 'Alpha', [login, g, doc('A/solo.dpx.json')]), project('B', 'Beta', [])], loose: [] };

test('moveItemOf: documents and groups can move, with a sub-documents flag', () => {
  assert.deepEqual(moveItemOf(login), { kind: 'doc', path: 'A/login.dpx.json', label: 'login', subdocs: true });
  assert.deepEqual(moveItemOf(doc('A/solo.dpx.json')), { kind: 'doc', path: 'A/solo.dpx.json', label: 'solo', subdocs: false });
  assert.deepEqual(moveItemOf(g), { kind: 'group', path: 'A/g', label: 'g', subdocs: false });
});

test('moveTarget: into another project or group; refused onto itself, its own folder or its sub-documents', () => {
  const l = moveItemOf(login);
  assert.equal(moveTarget(l, 'B'), 'B/login.dpx.json');
  assert.equal(moveTarget(l, 'A/g'), 'A/g/login.dpx.json');
  assert.equal(moveTarget(l, 'A'), null, 'already there');
  assert.equal(moveTarget(l, 'A/login'), null, 'its own sub-documents folder');
  assert.equal(moveTarget(l, 'A/login/inner'), null, 'below its own sub-documents');
  assert.equal(moveTarget(l, ''), null, 'never to the workspace root');
  const gi = moveItemOf(g);
  assert.equal(moveTarget(gi, 'B'), 'B/g');
  assert.equal(moveTarget(gi, 'A/g'), null);
  assert.equal(moveTarget(gi, 'A/g/deep'), null);
  assert.equal(moveTarget(gi, 'A'), null);
  // A name that only starts like the folder is a different folder.
  assert.equal(moveTarget(moveItemOf(group('A/gg')), 'A/g'), 'A/g/gg');
});

test('moveDestinations: every project and group the item can go to, labelled with its place', () => {
  assert.deepEqual(
    moveDestinations(view, moveItemOf(login)).map((d) => [d.path, d.label]),
    [
      ['A/g', 'Alpha / g'],
      ['A/g/deep', 'Alpha / g / deep'],
      ['B', 'Beta'],
    ],
  );
  assert.deepEqual(
    moveDestinations(view, moveItemOf(g)).map((d) => d.path),
    ['A/login/inner', 'B'],
  );
  assert.deepEqual(moveDestinations(null, moveItemOf(g)), []);
});

test('subdocsMove: the sub-documents folder follows a document', () => {
  assert.deepEqual(subdocsMove(moveItemOf(login), 'B/login.dpx.json'), { from: 'A/login', to: 'B/login' });
  assert.equal(subdocsMove(moveItemOf(doc('A/solo.dpx.json')), 'B/solo.dpx.json'), null);
  assert.equal(subdocsMove(moveItemOf(g), 'B/g'), null);
});
