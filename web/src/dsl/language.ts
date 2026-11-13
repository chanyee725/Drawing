// CodeMirror 6 highlighting for the Eraser-compatible diagram DSL (docs/research/eraser/02).
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const KEYWORDS = new Set([
  'title', 'direction', 'legend', 'colorMode', 'styleMode', 'typeface', 'textSize', 'wrap', 'connectorStyle', 'nodeStyle',
  'notation', 'layout', 'autoNumber', 'order', 'activate', 'deactivate',
  'loop', 'alt', 'else', 'opt', 'par', 'and', 'break',
]);
const ATTRS = new Set([
  'icon', 'color', 'label', 'subtitle', 'link', 'shape', 'type', 'connection', 'position',
  'colorMode', 'styleMode', 'typeface', 'textSize', 'wrap', 'connectorStyle',
]);

// depth counts open `{` so Enter indents a group body and typing `}` dedents it.
type State = { bracket: boolean; depth: number };

export const dslLanguage = StreamLanguage.define<State>({
  name: 'diagram-dsl',
  startState: () => ({ bracket: false, depth: 0 }),
  languageData: { commentTokens: { line: '//' }, indentOnInput: /^\s*\}$/ },
  indent: (state, textAfter, cx) => Math.max(0, state.depth - (/^\s*\}/.test(textAfter) ? 1 : 0)) * cx.unit,
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === '\\') stream.next();
        else if (c === '"') break;
      }
      return 'string';
    }
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return 'number';
    if (stream.match(/^(<-->|<->|-->|<--|<>|->|<-|--|>|<|-)(?=\s|$)/)) return 'operator';
    const ch = stream.peek();
    if (ch === '[') {
      stream.next();
      state.bracket = true;
      return 'bracket';
    }
    if (ch === ']') {
      stream.next();
      state.bracket = false;
      return 'bracket';
    }
    if (ch === '{' || ch === '}') {
      stream.next();
      state.depth = Math.max(0, state.depth + (ch === '{' ? 1 : -1));
      return 'brace';
    }
    if (ch === ':' || ch === ',') {
      stream.next();
      return 'punctuation';
    }
    if (stream.match(/^[A-Za-z_][\w-]*(?=\s*:)/) && state.bracket) return 'propertyName';
    if (stream.match(/^[A-Za-z_][\w-]*/)) {
      const w = stream.current();
      if (state.bracket) return ATTRS.has(w) ? 'propertyName' : 'atom';
      if (stream.column() === stream.indentation() && KEYWORDS.has(w)) return 'keyword';
      return 'variableName';
    }
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    stream.next();
    return null;
  },
});

const light = HighlightStyle.define([
  { tag: t.keyword, color: '#18181b', fontWeight: '600' },
  { tag: t.comment, color: '#8b8b95', fontStyle: 'italic' },
  { tag: t.string, color: '#0f7b4f' },
  { tag: t.number, color: '#b45309' },
  { tag: t.operator, color: '#e11d48', fontWeight: '600' },
  { tag: t.propertyName, color: '#0369a1' },
  { tag: t.atom, color: '#6d28d9' },
  { tag: [t.bracket, t.brace, t.punctuation], color: '#71717a' },
]);
const dark = HighlightStyle.define([
  { tag: t.keyword, color: '#fafafa', fontWeight: '600' },
  { tag: t.comment, color: '#7c7c88', fontStyle: 'italic' },
  { tag: t.string, color: '#6ee7b0' },
  { tag: t.number, color: '#fbbf6a' },
  { tag: t.operator, color: '#fb7185', fontWeight: '600' },
  { tag: t.propertyName, color: '#7dd3fc' },
  { tag: t.atom, color: '#c4b5fd' },
  { tag: [t.bracket, t.brace, t.punctuation], color: '#a1a1aa' },
]);

export const highlightFor = (isDark: boolean) => syntaxHighlighting(isDark ? dark : light);
