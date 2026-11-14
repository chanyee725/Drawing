// Font size steps of the style panel (#292). Excalidraw hard-codes S 16 / M 20 / L 28 / XL 36 and has no prop
// for them, so the build rewrites the four values in its bundle (web/vite.config.ts), the same way it points
// the font fallback at our own copy.
// The steps are the diagram blocks' text sizes (shared/render/text.ts: small 13, medium 16, large 20) plus one
// larger step, so free-form text and diagram text share one scale and the size of new text is the first step.
import { CLEAN_FONT_SIZE } from './cleanStyle.ts';

/** Excalidraw's locale key (`labels.<label>`) of each size button, its stock size and ours. */
export const FONT_SIZE_STEPS = [
  { label: 'small', stock: 16, size: CLEAN_FONT_SIZE },
  { label: 'medium', stock: 20, size: 16 },
  { label: 'large', stock: 28, size: 20 },
  { label: 'veryLarge', stock: 36, size: 28 },
] as const;

/** Only the module that holds the size buttons has this test id. */
const MARKER = 'fontSize-small';

/**
 * Excalidraw's bundle with our size steps in the style panel: null when `code` does not hold the size buttons.
 * Matches the minified prod chunk (`{value:16,text:g("labels.small")`) and the readable dev chunk.
 * Throws when a button is not found, so a dependency update cannot silently bring the stock sizes back.
 */
export function patchFontSizeSteps(code: string): string | null {
  if (!code.includes(MARKER)) return null;
  let out = code;
  for (const { label, stock, size } of FONT_SIZE_STEPS) {
    const re = new RegExp(`(\\bvalue:\\s*)${stock}(,\\s*text:\\s*[\\w$]+\\("labels\\.${label}"\\))`, 'g');
    let hits = 0;
    out = out.replace(re, (_m, head: string, tail: string) => (hits++, `${head}${size}${tail}`));
    if (hits !== 1) throw new Error(`excalidraw-assets: size button "${label}" (${stock}) found ${hits} times; update patchFontSizeSteps`);
  }
  return out;
}
