import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileStem } from '../../web/src/fileName.ts';

test('fileStem strips a typed .dpx or .dpx.json suffix', () => {
  assert.equal(fileStem('demo'), 'demo');
  assert.equal(fileStem(' demo.dpx '), 'demo');
  assert.equal(fileStem('demo.dpx.json'), 'demo');
  assert.equal(fileStem('sub/Demo.DPX'), 'sub/Demo');
  assert.equal(fileStem('demo.json'), 'demo.json');
  assert.equal(fileStem('demo.dpx.dpx'), 'demo.dpx');
});
