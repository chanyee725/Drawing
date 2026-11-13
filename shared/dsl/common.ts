import type { Token } from './tokenizer.ts';
import type { ArrowStyle, Attrs, Diagnostic, DiagramBase, Severity, Span } from './types.ts';

const ELEMENT_KEYS = ['icon', 'color', 'label', 'link', 'colorMode', 'styleMode', 'typeface', 'textSize'];
/**
 * Our extensions, which Eraser's code never uses (so it still parses): `subtitle` (a node's second line),
 * `badge` and `badgeColor` (a chip on the top-right corner).
 */
export const GRAPH_KEYS = new Set([...ELEMENT_KEYS, 'shape', 'wrap', 'connectorStyle', 'subtitle', 'badge', 'badgeColor']);
export const SEQUENCE_KEYS = new Set(ELEMENT_KEYS);
export const ERD_KEYS = new Set(ELEMENT_KEYS);
export const LEGEND_KEYS = new Set([...ELEMENT_KEYS, 'shape', 'connection', 'position']);

export const SHAPES = [
  'rectangle', 'circle', 'cylinder', 'diamond', 'document', 'ellipse',
  'hexagon', 'oval', 'parallelogram', 'star', 'trapezoid', 'triangle',
  // Our extension: a horizontal line broken by the node's label.
  'divider',
];

export const ENUMS: Record<string, readonly string[]> = {
  colorMode: ['pastel', 'bold', 'outline'],
  styleMode: ['shadow', 'plain', 'watercolor'],
  typeface: ['rough', 'clean', 'mono'],
  textSize: ['small', 'medium', 'large'],
  wrap: ['on', 'off'],
  connectorStyle: ['elbow', 'straight', 'arc'],
  nodeStyle: ['box', 'icon'],
  shape: SHAPES,
};
/** `nodeStyle` is our extension: architecture nodes with an icon draw as box cards (`box`) or the old big icon (`icon`). */
const STYLE_KEYWORDS = ['colorMode', 'styleMode', 'typeface', 'textSize', 'wrap', 'connectorStyle', 'nodeStyle'];
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function spanOf(t: Span): Span {
  return { line: t.line, column: t.column, offset: t.offset, length: t.length };
}

/** Token cursor plus the diagnostics collected while parsing. */
export class Cursor {
  readonly tokens: Token[];
  readonly src: string;
  readonly diagnostics: Diagnostic[] = [];
  pos = 0;
  /** Attribute keys that do not raise an "unknown attribute" warning. */
  keys: ReadonlySet<string>;
  /** Warn about `shape:` values outside the 12 known shapes. */
  checkShapes = false;

  constructor(src: string, tokens: Token[], keys: ReadonlySet<string>) {
    this.src = src;
    this.tokens = tokens;
    this.keys = keys;
  }
  peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }
  next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.pos++;
    return t;
  }
  atEol(): boolean {
    const k = this.peek().kind;
    return k === 'newline' || k === 'eof';
  }
  report(span: Span, message: string, severity: Severity): void {
    this.diagnostics.push({ message, severity, line: span.line, column: span.column, offset: span.offset, length: span.length });
  }
  error(span: Span, message: string): void {
    this.report(span, message, 'error');
  }
  warn(span: Span, message: string): void {
    this.report(span, message, 'warning');
  }
  /**
   * `a}b` (a `}` glued to text on both sides) is almost certainly a name or label that contains a brace.
   * The brace ends the block there, so say how to keep it: put the text in quotes.
   */
  checkBraceInWord(t: Token): void {
    const glued = (ch: string | undefined) => ch !== undefined && !/[\s{}\[\],:<>]/.test(ch);
    if (glued(this.src[t.offset - 1]) && glued(this.src[t.offset + t.length])) {
      this.warn(t, "'}' ends the block here. To use a '}' inside a name or label, put the text in quotes");
    }
  }
  /** Source text from the start of `a` to the end of `b`, whitespace collapsed. */
  slice(a: Token, b: Token): string {
    return this.src.slice(a.offset, b.offset + b.length).replace(/\s+/g, ' ');
  }
  /** Span covering `a` through `b` (same line). */
  between(a: Token, b: Token): Span {
    return { line: a.line, column: a.column, offset: a.offset, length: b.offset + b.length - a.offset };
  }
}

export function describe(t: Token): string {
  if (t.kind === 'newline') return 'end of line';
  if (t.kind === 'eof') return 'end of input';
  return `'${t.text}'`;
}

/** Skip the rest of a bad line but stop before a `}` so scopes still close. Always advances. */
export function recoverLine(c: Cursor): void {
  const start = c.pos;
  while (!c.atEol() && c.peek().kind !== 'rbrace') c.pos++;
  if (c.pos === start && !c.atEol()) c.pos++;
}

/** A statement ends at a line break, end of input, or a `}` that closes the scope. */
export function endStatement(c: Cursor): void {
  const t = c.peek();
  if (t.kind === 'newline') c.next();
  else if (t.kind !== 'eof' && t.kind !== 'rbrace') {
    c.error(t, `Unexpected ${describe(t)}`);
    recoverLine(c);
  }
}

/** `->` and `<-` are typos for `>` and `<` (the tokenizer already warned about them). */
export function normalizeSymbol(symbol: string): string {
  return symbol === '->' ? '>' : symbol === '<-' ? '<' : symbol;
}

export function arrowStyle(raw: string): ArrowStyle {
  const symbol = normalizeSymbol(raw);
  return {
    symbol,
    lineStyle: symbol.includes('--') ? 'dashed' : 'solid',
    startArrow: symbol.startsWith('<'),
    endArrow: symbol.endsWith('>'),
  };
}

// ---------- attributes ----------

/** Parses `[key: value, ...]`. The cursor must be on `[`. */
export function parseAttrs(c: Cursor, keys: ReadonlySet<string> = c.keys): Attrs {
  const open = c.next();
  const attrs: Attrs = {};
  for (;;) {
    const t = c.peek();
    if (t.kind === 'rbracket') {
      c.next();
      return attrs;
    }
    if (t.kind === 'newline' || t.kind === 'eof' || t.kind === 'rbrace' || t.kind === 'lbrace') {
      c.error(open, "Missing closing ']'");
      return attrs;
    }
    if (t.kind === 'comma') {
      c.next();
      continue;
    }
    if (t.kind !== 'word') {
      c.error(t, `Expected an attribute name, found ${describe(t)}`);
      c.next();
      continue;
    }
    const key = c.next();
    if (c.peek().kind !== 'colon') {
      c.error(key, `Expected ':' after '${key.text}'`);
      continue;
    }
    c.next();
    const vals: Token[] = [];
    while (!['comma', 'rbracket', 'newline', 'eof', 'rbrace', 'lbrace'].includes(c.peek().kind)) vals.push(c.next());
    if (vals.length === 0) {
      c.error(key, `Missing value for '${key.text}'`);
      continue;
    }
    const first = vals[0]!;
    const last = vals[vals.length - 1]!;
    const value = vals.length === 1 && first.kind === 'string' ? first.value : c.slice(first, last);
    const valueSpan = c.between(first, last);
    if (!keys.has(key.text)) c.warn(key, `Unknown attribute '${key.text}'`);
    else if (Object.hasOwn(attrs, key.text)) c.warn(key, `Duplicate attribute '${key.text}'`);
    validateValue(c, key.text, value, valueSpan);
    attrs[key.text] = value;
  }
}

function validateValue(c: Cursor, key: string, value: string, span: Span): void {
  const allowed = ENUMS[key];
  if (allowed && !(key === 'shape' && !c.checkShapes) && !allowed.includes(value)) {
    c.warn(span, `Unknown ${key} '${value}'. Use one of: ${allowed.join(', ')}`);
  } else if ((key === 'color' || key === 'badgeColor') && value.startsWith('#') && !HEX_RE.test(value)) {
    c.warn(span, `Invalid hex color '${value}'`);
  }
}

// ---------- names, lists and connections ----------

export interface Endpoint {
  name: string;
  span: Span;
  attrs?: Attrs;
}

/** A name: one quoted string, or consecutive words joined by single spaces. */
function readName(c: Cursor): { name: string; span: Span } | null {
  const first = c.peek();
  if (first.kind === 'string') {
    c.next();
    return { name: first.value, span: spanOf(first) };
  }
  if (first.kind !== 'word') return null;
  let last = c.next();
  while (c.peek().kind === 'word') last = c.next();
  return { name: c.slice(first, last), span: c.between(first, last) };
}

export function readSingleName(c: Cursor): { name: string; span: Span } | null {
  return readName(c);
}

/** `name [attrs], name [attrs], ...`. Returns an empty list when no name starts here. */
export function parseEndpoints(c: Cursor): Endpoint[] {
  const list: Endpoint[] = [];
  for (;;) {
    const nm = readName(c);
    if (!nm) return list;
    const ep: Endpoint = { name: nm.name, span: nm.span };
    if (c.peek().kind === 'lbracket') ep.attrs = parseAttrs(c);
    list.push(ep);
    if (c.peek().kind !== 'comma') return list;
    const comma = c.next();
    const k = c.peek().kind;
    if (k !== 'word' && k !== 'string') {
      c.error(comma, "Expected a name after ','");
      return list;
    }
  }
}

export interface Chain {
  lists: Endpoint[][];
  arrows: Token[];
}

/** Continues after the first list: `> B, C > D ...`. The cursor must be on an arrow. */
export function parseChain(c: Cursor, first: Endpoint[]): Chain {
  const lists = [first];
  const arrows: Token[] = [];
  while (c.peek().kind === 'arrow') {
    const arrow = c.next();
    const list = parseEndpoints(c);
    if (list.length === 0) {
      c.error(arrow, `Expected a name after '${arrow.text}'`);
      break;
    }
    arrows.push(arrow);
    lists.push(list);
  }
  return { lists, arrows };
}

export interface ConnectionTail {
  hasColon: boolean;
  label?: string;
  labelSpan?: Span;
  attrs: Attrs;
  /** Span of the `[...]` group after the colon, when present. */
  attrsSpan?: Span;
}

/**
 * Parses `: label [attrs]` to the end of the line. Without a colon returns an empty tail.
 * Inside a group (`inGroup`) a `}` ends the label too, so `G { a > b: hi }` closes the group.
 */
export function parseConnectionTail(c: Cursor, inGroup = false): ConnectionTail {
  if (c.peek().kind !== 'colon') return { hasColon: false, attrs: {} };
  c.next();
  const start = c.pos;
  let end = start;
  while (c.tokens[end]!.kind !== 'newline' && c.tokens[end]!.kind !== 'eof' && !(inGroup && c.tokens[end]!.kind === 'rbrace')) end++;
  let bracket = -1;
  for (let k = end - 1; k >= start; k--) {
    if (c.tokens[k]!.kind === 'lbracket') {
      bracket = k;
      break;
    }
    if (c.tokens[k]!.kind === 'rbracket' && k !== end - 1) break;
  }
  const labelEnd = bracket >= 0 ? bracket : end;
  const tail: ConnectionTail = { hasColon: true, attrs: {} };
  if (labelEnd > start) {
    const a = c.tokens[start]!;
    const b = c.tokens[labelEnd - 1]!;
    tail.label = labelEnd - start === 1 && a.kind === 'string' ? a.value : c.slice(a, b);
    tail.labelSpan = c.between(a, b);
  }
  if (bracket >= 0) {
    c.pos = bracket;
    const open = c.peek();
    tail.attrs = parseAttrs(c);
    tail.attrsSpan = c.between(open, c.tokens[Math.max(c.pos - 1, bracket)]!);
  }
  c.pos = end;
  return tail;
}

// ---------- global statements ----------

function isValueStart(t: Token): boolean {
  return t.kind === 'word' || t.kind === 'string' || t.kind === 'colon';
}

/** Consumes `keyword [:] value` and returns the value token range, or null when no value follows. */
export function parseKeywordValue(c: Cursor): { key: Token; value: string; span: Span } | null {
  const key = c.next();
  if (c.peek().kind === 'colon') c.next();
  const first = c.peek();
  if (c.atEol()) {
    c.error(key, `Missing value for '${key.text}'`);
    return null;
  }
  let last = first;
  while (!c.atEol()) last = c.next();
  const value = first === last && first.kind === 'string' ? first.value : c.slice(first, last);
  return { key, value, span: c.between(first, last) };
}

/**
 * Handles `title`, the global style lines and `legend`. Returns true when the statement was
 * consumed (including its line break).
 */
export function parseCommonKeyword(c: Cursor, base: DiagramBase): boolean {
  const t = c.peek();
  if (t.kind !== 'word') return false;
  const nx = c.peek(1);
  if (t.text === 'legend' && (nx.kind === 'lbracket' || nx.kind === 'lbrace')) {
    parseLegend(c, base);
    return true;
  }
  if (!isValueStart(nx)) return false;
  if (t.text === 'title') {
    const kv = parseKeywordValue(c);
    if (kv) base.title = kv.value;
    endStatement(c);
    return true;
  }
  if (STYLE_KEYWORDS.includes(t.text)) {
    const kv = parseKeywordValue(c);
    if (kv) {
      const allowed = ENUMS[t.text]!;
      if (!allowed.includes(kv.value)) c.warn(kv.span, `Unknown ${t.text} '${kv.value}'. Use one of: ${allowed.join(', ')}`);
      base.styles[t.text] = kv.value;
      base.globalStyles.push({ key: t.text, value: kv.value, span: kv.span });
    }
    endStatement(c);
    return true;
  }
  return false;
}

function parseLegend(c: Cursor, base: DiagramBase): void {
  const kw = c.next();
  const legend = { entries: [] as Attrs[], span: spanOf(kw) } as NonNullable<DiagramBase['legend']>;
  const saved = c.keys;
  c.keys = LEGEND_KEYS;
  if (c.peek().kind === 'lbracket') {
    const attrs = parseAttrs(c);
    if (attrs.position) legend.position = attrs.position;
  }
  if (c.peek().kind !== 'lbrace') {
    c.error(kw, "Expected '{' after 'legend'");
    recoverLine(c);
    c.keys = saved;
    base.legend = legend;
    return;
  }
  const open = c.next();
  for (;;) {
    const t = c.peek();
    if (t.kind === 'eof') {
      c.error(open, "Missing closing '}' for legend");
      break;
    }
    if (t.kind === 'rbrace') {
      c.next();
      break;
    }
    if (t.kind === 'newline' || t.kind === 'comma') c.next();
    else if (t.kind === 'lbracket') legend.entries.push(parseAttrs(c));
    else {
      c.error(t, `Unexpected ${describe(t)} in legend`);
      c.next();
    }
  }
  c.keys = saved;
  base.legend = legend;
  endStatement(c);
}

export function emptyBase(): DiagramBase {
  return { styles: {}, globalStyles: [] };
}
