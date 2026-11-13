import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownView, toCanvas } from '../../web/src/viewMode.ts';

test('shownView: narrow screens show the document instead of both panes', () => {
  assert.equal(shownView('both', true), 'doc');
  assert.equal(shownView('doc', true), 'doc');
  assert.equal(shownView('canvas', true), 'canvas');
  assert.equal(shownView('both', false), 'both');
  assert.equal(shownView('doc', false), 'doc');
});

test('toCanvas: wide screens open the canvas next to the document', () => {
  assert.equal(toCanvas('doc', false), 'both');
  assert.equal(toCanvas('both', false), 'both');
  assert.equal(toCanvas('canvas', false), 'canvas');
});

test('toCanvas: narrow screens switch to the canvas, even from a stored both', () => {
  assert.equal(toCanvas('doc', true), 'canvas');
  assert.equal(toCanvas('both', true), 'canvas');
  assert.equal(shownView(toCanvas('both', true), true), 'canvas');
});

test('toCanvas: from the 실행 view, wide screens open both panes and narrow screens the canvas', () => {
  assert.equal(toCanvas('run', false), 'both');
  assert.equal(toCanvas('run', true), 'canvas');
  assert.equal(shownView('run', true), 'run');
});
