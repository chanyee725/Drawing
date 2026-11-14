import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLEAN_APP_STATE, CLEAN_FONT_SIZE } from '../../web/src/canvas/cleanStyle.ts';
import { FONT_SIZE_STEPS, patchFontSizeSteps } from '../../web/src/canvas/sizeSteps.ts';
import { FONT_SIZE } from '../../shared/render/text.ts';

const dist = (kind: string) => readFileSync(new URL(`../../node_modules/@excalidraw/excalidraw/dist/${kind}/index.js`, import.meta.url), 'utf8');
/** The sizes of the four size buttons in `code`, in their order. */
const buttonSizes = (code: string) =>
  [...code.matchAll(/value:\s*(\d+),\s*text:\s*[\w$]+\("labels\.(?:small|medium|large|veryLarge)"\)/g)].map((m) => Number(m[1]));

test('the size of new text is the first step, and the steps grow', () => {
  const sizes = FONT_SIZE_STEPS.map((s) => s.size);
  assert.deepEqual(sizes, [13, 16, 20, 28]);
  assert.equal(sizes[0], CLEAN_FONT_SIZE);
  assert.equal(CLEAN_APP_STATE.currentItemFontSize, sizes[0], 'a fresh canvas starts on the first step');
  assert.deepEqual(sizes.slice(0, 3), [FONT_SIZE.small, FONT_SIZE.medium, FONT_SIZE.large], 'the first three are the diagram text sizes');
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes);
  assert.equal(new Set(sizes).size, sizes.length);
});

for (const kind of ['prod', 'dev']) {
  test(`the ${kind} bundle of Excalidraw gets our steps on its size buttons`, () => {
    const code = dist(kind);
    assert.deepEqual(buttonSizes(code), [16, 20, 28, 36], 'the stock sizes, before');
    const out = patchFontSizeSteps(code);
    assert.ok(out);
    assert.deepEqual(buttonSizes(out), [13, 16, 20, 28]);
    assert.equal(out.length, code.length, 'nothing else changed length');
    // Only the digits of the four numbers differ: 16>13, 20>16, 28>20, 36>28.
    let diff = 0;
    for (let i = 0; i < code.length; i++) if (code[i] !== out[i]) diff++;
    assert.equal(diff, 6, `${diff} characters differ`);
  });
}

test('code without the size buttons is left alone, and moved buttons fail the build', () => {
  assert.equal(patchFontSizeSteps('export const a = { value: 16 };'), null);
  const moved = 'x={value:18,text:g("labels.small"),testId:"fontSize-small"}';
  assert.throws(() => patchFontSizeSteps(moved), /size button "small"/);
});
