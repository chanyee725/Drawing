import type { Diagnostic, Span } from './types.ts';

export type TokenKind =
  | 'word'
  | 'string'
  | 'arrow'
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'colon'
  | 'newline'
  | 'eof';

export interface Token extends Span {
  kind: TokenKind;
  /** Raw source text. */
  text: string;
  /** Unquoted and unescaped for strings, equal to `text` otherwise. */
  value: string;
}

const PUNCT: Record<string, TokenKind> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  ',': 'comma',
  ':': 'colon',
};
const ARROW_RE = /^(?:<-->|<--|-->|<>|>|<)/;
const BARE_DASH_RE = /^--?(?=\s|$)/;
const WORD_STOP = new Set([' ', '\t', '\r', '\n', '{', '}', '[', ']', ',', ':', '"', '<', '>']);

/**
 * Shared tokenizer for every diagram type. Never throws.
 * Words are split on whitespace and punctuation, so multi-word names are joined by the parsers
 * using source slices. `-` and `--` are arrows only when followed by whitespace; parentheses
 * (as in `decimal(10,2)`) stay inside a word. `//` starts a comment.
 */
export function tokenize(src: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const make = (kind: TokenKind, start: number, end: number, value?: string): Token => ({
    kind,
    text: src.slice(start, end),
    value: value ?? src.slice(start, end),
    line,
    column: start - lineStart + 1,
    offset: start,
    length: end - start,
  });

  while (i < n) {
    const ch = src[i]!;
    if (ch === '\n') {
      tokens.push(make('newline', i, i + 1));
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < n && src[j] !== '\n') {
        const c = src[j]!;
        if (c === '\\' && j + 1 < n && src[j + 1] !== '\n') {
          const e = src[j + 1]!;
          value += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          j += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          j++;
          break;
        }
        value += c;
        j++;
      }
      const tok = make('string', i, j, value);
      tokens.push(tok);
      if (!closed) {
        diagnostics.push({
          message: 'Unterminated string: add a closing "',
          severity: 'error',
          line: tok.line,
          column: tok.column,
          offset: tok.offset,
          length: tok.length,
        });
      }
      i = j;
      continue;
    }
    const punct = PUNCT[ch];
    if (punct) {
      tokens.push(make(punct, i, i + 1));
      i++;
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '-') {
      const m = ARROW_RE.exec(src.slice(i, i + 4)) ?? BARE_DASH_RE.exec(src.slice(i, i + 3));
      if (m) {
        tokens.push(make('arrow', i, i + m[0].length));
        i += m[0].length;
        continue;
      }
    }
    // word
    let j = i;
    while (j < n) {
      const c = src[j]!;
      if (WORD_STOP.has(c)) break;
      if (c === '(') {
        const close = matchingParen(src, j);
        if (close > 0) {
          j = close + 1;
          continue;
        }
      }
      j++;
    }
    if (j === i) j = i + 1;
    tokens.push(make('word', i, j));
    i = j;
  }
  tokens.push(make('eof', n, n));
  return { tokens, diagnostics };
}

/** Index of the `)` matching the `(` at `open` on the same line, or -1. */
function matchingParen(src: string, open: number): number {
  let depth = 0;
  for (let k = open; k < src.length && src[k] !== '\n'; k++) {
    if (src[k] === '(') depth++;
    else if (src[k] === ')' && --depth === 0) return k;
  }
  return -1;
}
