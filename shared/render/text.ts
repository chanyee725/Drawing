// Deterministic text measurement without a DOM. Widths are em-based estimates close to Inter /
// JetBrains Mono / Shantell Sans, so layout is identical in Node and in every browser.

import type { TextSize, Typeface } from './scene.ts';

export const FONT_FAMILY: Record<Typeface, string> = {
  clean: "Inter, 'Inter var', system-ui, -apple-system, 'Segoe UI', 'Noto Sans KR', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  rough: "'Shantell Sans', Inter, system-ui, 'Noto Sans KR', sans-serif",
};

export const FONT_SIZE: Record<TextSize, number> = { small: 13, medium: 16, large: 20 };

const NARROW = new Set([...'iljI.,:;|!\'`']);
const SEMI = new Set([...'frt()[]{}/\\-"']);
const WIDE = new Set([...'mwMW@%']);

function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK, kana, etc.
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x1f300 && code <= 0x1faff) // emoji
  );
}

function charEm(ch: string, font: Typeface): number {
  const code = ch.codePointAt(0) ?? 0;
  if (isWideChar(code)) return 1;
  if (font === 'mono') return 0.6;
  let w: number;
  if (ch === ' ') w = 0.28;
  else if (NARROW.has(ch)) w = 0.27;
  else if (SEMI.has(ch)) w = 0.38;
  else if (WIDE.has(ch)) w = 0.86;
  else if (ch >= '0' && ch <= '9') w = 0.58;
  else if (ch >= 'A' && ch <= 'Z') w = 0.66;
  else w = 0.55;
  return font === 'rough' ? w * 1.08 : w;
}

/** Width of one line of text in px. Bold text is about 5% wider. */
export function textWidth(text: string, size: number, font: Typeface, bold = false): number {
  let em = 0;
  for (const ch of text) em += charEm(ch, font);
  return em * size * (bold ? 1.05 : 1);
}

/** Split explicit newlines, then word-wrap each line to `maxWidth` when `wrap` is on. */
export function wrapText(text: string, maxWidth: number, size: number, font: Typeface, wrap: boolean, bold = false): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!wrap || textWidth(raw, size, font, bold) <= maxWidth) {
      out.push(raw);
      continue;
    }
    let line = '';
    for (const word of raw.split(/(\s+)/)) {
      if (word === '') continue;
      const next = line + word;
      if (line.trim() !== '' && textWidth(next.trimEnd(), size, font, bold) > maxWidth) {
        out.push(line.trimEnd());
        line = /^\s+$/.test(word) ? '' : word;
      } else {
        line = next;
      }
      // A single word longer than the limit is broken by characters.
      while (textWidth(line, size, font, bold) > maxWidth && [...line].length > 1) {
        const chars = [...line];
        let cut = chars.length - 1;
        while (cut > 1 && textWidth(chars.slice(0, cut).join(''), size, font, bold) > maxWidth) cut--;
        out.push(chars.slice(0, cut).join(''));
        line = chars.slice(cut).join('');
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function linesWidth(lines: string[], size: number, font: Typeface, bold = false): number {
  let w = 0;
  for (const l of lines) w = Math.max(w, textWidth(l, size, font, bold));
  return w;
}

export const lineHeightOf = (size: number): number => Math.round(size * 1.35);
