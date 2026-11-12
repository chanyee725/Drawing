import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EXPORT, describeExport, exportBackground, exportSuffix, normalizeExport } from '../../web/src/export/options.ts';

test('defaults are 2x, light, with a background', () => {
  assert.deepEqual(DEFAULT_EXPORT, { scale: 2, transparent: false, dark: false });
  assert.equal(exportSuffix(DEFAULT_EXPORT, 'png'), '');
});

test('normalizeExport repairs bad input', () => {
  assert.deepEqual(normalizeExport(null), DEFAULT_EXPORT);
  assert.deepEqual(normalizeExport({ scale: 5 as never, transparent: 'yes' as never }), DEFAULT_EXPORT);
  assert.deepEqual(normalizeExport({ scale: 3, transparent: true, dark: true }), { scale: 3, transparent: true, dark: true });
  assert.equal(normalizeExport({ scale: 1 }).scale, 1);
});

test('background is white, dark, or none when transparent', () => {
  assert.equal(exportBackground({ scale: 1, transparent: false, dark: false }), '#ffffff');
  assert.equal(exportBackground({ scale: 1, transparent: false, dark: true }), '#18181b');
  assert.equal(exportBackground({ scale: 1, transparent: true, dark: true }), null);
});

test('file name suffix marks non-default choices; svg ignores scale', () => {
  assert.equal(exportSuffix({ scale: 3, transparent: true, dark: true }, 'png'), '@3x-dark-transparent');
  assert.equal(exportSuffix({ scale: 1, transparent: false, dark: false }, 'png'), '@1x');
  assert.equal(exportSuffix({ scale: 3, transparent: true, dark: false }, 'svg'), '-transparent');
});

test('describeExport is a short Korean summary', () => {
  assert.equal(describeExport({ scale: 2, transparent: false, dark: false }), '2배 · 라이트 · 배경 있음');
  assert.equal(describeExport({ scale: 3, transparent: true, dark: true }), '3배 · 다크 · 투명 배경');
});
