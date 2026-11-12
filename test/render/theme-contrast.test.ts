import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMED_COLOR_NAMES, resolvePaint } from '../../shared/render/theme.ts';
import type { Theme } from '../../shared/render/theme.ts';

function lum(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

for (const theme of ['dark'] as Theme[]) {
  test(`bold boxes keep readable text (${theme})`, () => {
    for (const color of [undefined, ...NAMED_COLOR_NAMES]) {
      const p = resolvePaint({ color, mode: 'bold' }, theme);
      assert.ok(ratio(p.text, p.fill) >= 4.5, `${color ?? 'neutral'}: ${ratio(p.text, p.fill).toFixed(2)}`);
    }
  });
}
