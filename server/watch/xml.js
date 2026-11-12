// Minimal XML tokenizer/tree builder for draw.io files. No dependency: draw.io
// XML is regular (elements + attributes, no mixed text we care about), so a small
// scanner is enough and keeps the server dependency-free.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttrs(src) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(src))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  return attrs;
}

/**
 * Parse XML into a tree of { name, attrs, children, text, start, end } where
 * start/end are offsets of the element in the source (end is exclusive).
 * Throws on unbalanced tags so a half-written file is detected.
 */
export function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '', start: 0, end: src.length };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1].text += src.slice(i);
      break;
    }
    if (lt > i) stack[stack.length - 1].text += src.slice(i, lt);
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      if (e < 0) throw new Error('unterminated comment');
      i = e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      if (e < 0) throw new Error('unterminated cdata');
      stack[stack.length - 1].text += src.slice(lt + 9, e);
      i = e + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const e = src.indexOf('>', lt);
      if (e < 0) throw new Error('unterminated declaration');
      i = e + 1;
      continue;
    }
    const gt = findTagEnd(src, lt);
    if (gt < 0) throw new Error('unterminated tag');
    const body = src.slice(lt + 1, gt);
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== name || stack.length === 0) throw new Error('mismatched close tag');
      top.end = gt + 1;
    } else {
      const selfClose = body.endsWith('/');
      const inner = selfClose ? body.slice(0, -1) : body;
      const sp = inner.search(/\s/);
      const name = sp < 0 ? inner : inner.slice(0, sp);
      const el = { name, attrs: sp < 0 ? {} : parseAttrs(inner.slice(sp)), children: [], text: '', start: lt, end: gt + 1 };
      stack[stack.length - 1].children.push(el);
      if (!selfClose) stack.push(el);
    }
    i = gt + 1;
  }
  if (stack.length !== 1) throw new Error('unclosed element');
  return root;
}

// Find the '>' closing a tag, skipping quoted attribute values.
function findTagEnd(src, from) {
  let q = null;
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

export function findAll(el, name, out = []) {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function findFirst(el, name) {
  for (const c of el.children) {
    if (c.name === name) return c;
    const f = findFirst(c, name);
    if (f) return f;
  }
  return null;
}
