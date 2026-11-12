import {
  arrowStyle, Cursor, describe, emptyBase, endStatement, parseAttrs, parseChain, parseCommonKeyword,
  parseConnectionTail, parseEndpoints, parseKeywordValue, readSingleName, recoverLine, SEQUENCE_KEYS,
  spanOf, type Endpoint,
} from './common.ts';
import type { SequenceBlock, SequenceBlockType, SequenceColumn, SequenceDiagram, SequenceItem } from './types.ts';

const BLOCKS: readonly string[] = ['loop', 'alt', 'else', 'opt', 'par', 'and', 'break'];
const AUTO_NUMBER = ['off', 'on', 'nested'] as const;

/** Sequence diagram parser. Columns appear on first use; messages use the shared connection syntax. */
export function parseSequence(c: Cursor): SequenceDiagram {
  c.keys = SEQUENCE_KEYS;
  const ast: SequenceDiagram = { ...emptyBase(), type: 'sequence', autoNumber: 'off', columns: [], items: [] };
  const byId = new Map<string, SequenceColumn>();
  const active = new Map<string, number>();
  let explicitOrder: string[] | null = null;
  const stack: { items: SequenceItem[]; open?: ReturnType<typeof spanOf>; label?: string }[] = [{ items: ast.items }];
  const top = () => stack[stack.length - 1]!;

  const column = (ep: Endpoint) => {
    const existing = byId.get(ep.name);
    if (existing) {
      if (ep.attrs) {
        Object.assign(existing.attrs, ep.attrs);
        if (ep.attrs.label !== undefined) existing.label = ep.attrs.label;
      }
      return;
    }
    const attrs = ep.attrs ?? {};
    const col: SequenceColumn = { id: ep.name, name: ep.name, label: attrs.label ?? ep.name, attrs, span: ep.span };
    byId.set(ep.name, col);
    ast.columns.push(col);
  };

  for (;;) {
    const t = c.peek();
    if (t.kind === 'eof') break;
    if (t.kind === 'newline') {
      c.next();
      continue;
    }
    if (t.kind === 'rbrace') {
      c.next();
      if (stack.length > 1) stack.pop();
      else c.error(t, "Unexpected '}' without a matching '{'");
      continue;
    }
    if (parseCommonKeyword(c, ast)) continue;

    const nx = c.peek(1);
    const valueNext = nx.kind === 'word' || nx.kind === 'string' || nx.kind === 'colon';
    if (t.kind === 'word' && t.text === 'autoNumber' && valueNext) {
      const kv = parseKeywordValue(c);
      if (kv) {
        if ((AUTO_NUMBER as readonly string[]).includes(kv.value)) ast.autoNumber = kv.value as SequenceDiagram['autoNumber'];
        else c.error(kv.span, `Unknown autoNumber '${kv.value}'. Use one of: ${AUTO_NUMBER.join(', ')}`);
      }
      endStatement(c);
      continue;
    }
    if (t.kind === 'word' && t.text === 'order' && valueNext) {
      c.next();
      if (c.peek().kind === 'colon') c.next();
      const list = parseEndpoints(c);
      if (list.length === 0) c.error(t, "Missing columns after 'order'");
      for (const ep of list) column(ep);
      explicitOrder = list.map((ep) => ep.name);
      endStatement(c);
      continue;
    }
    if (t.kind === 'word' && (t.text === 'activate' || t.text === 'deactivate') && (nx.kind === 'word' || nx.kind === 'string')) {
      c.next();
      const nm = readSingleName(c)!;
      if (!byId.has(nm.name)) {
        c.warn(nm.span, `Unknown column '${nm.name}'`);
      } else if (t.text === 'activate') {
        active.set(nm.name, (active.get(nm.name) ?? 0) + 1);
      } else if (!active.get(nm.name)) {
        c.warn(nm.span, `'${nm.name}' is not active`);
      } else {
        active.set(nm.name, active.get(nm.name)! - 1);
      }
      top().items.push({ kind: 'activation', action: t.text, column: nm.name, span: nm.span });
      endStatement(c);
      continue;
    }
    if (t.kind === 'word' && BLOCKS.includes(t.text) && (nx.kind === 'lbracket' || nx.kind === 'lbrace')) {
      c.next();
      const attrs = c.peek().kind === 'lbracket' ? parseAttrs(c) : {};
      const block: SequenceBlock = {
        kind: 'block',
        blockType: t.text as SequenceBlockType,
        attrs,
        children: [],
        span: spanOf(t),
      };
      if (attrs.label !== undefined) block.label = attrs.label;
      const prev = top().items[top().items.length - 1];
      const prevType = prev?.kind === 'block' ? prev.blockType : null;
      if (t.text === 'else' && prevType !== 'alt' && prevType !== 'else') c.warn(t, "'else' must directly follow an 'alt' block");
      if (t.text === 'and' && prevType !== 'par' && prevType !== 'and') c.warn(t, "'and' must directly follow a 'par' block");
      top().items.push(block);
      if (c.peek().kind !== 'lbrace') {
        c.error(t, `Expected '{' after '${t.text}'`);
        recoverLine(c);
        continue;
      }
      const open = c.next();
      stack.push({ items: block.children, open: spanOf(open), label: t.text });
      continue;
    }

    const first = parseEndpoints(c);
    if (first.length === 0) {
      c.error(t, `Unexpected ${describe(t)}`);
      if (t.kind === 'lbrace') {
        c.next();
        stack.push({ items: top().items, open: spanOf(t) });
      } else recoverLine(c);
      continue;
    }
    if (c.peek().kind === 'arrow') {
      const { lists, arrows } = parseChain(c, first);
      const tail = parseConnectionTail(c);
      if (lists.length > 1) {
        for (const list of lists) for (const ep of list) column(ep);
        if (tail.label !== undefined && lists.length > 2) {
          c.warn(tail.labelSpan!, 'Labels are not supported on chained connections, so this one is ignored');
        }
        for (let i = 0; i < lists.length - 1; i++) {
          const arrow = arrows[i]!;
          for (const a of lists[i]!) {
            for (const b of lists[i + 1]!) {
              top().items.push({
                kind: 'message',
                from: a.name,
                to: b.name,
                ...arrowStyle(arrow.text),
                ...(tail.label !== undefined && lists.length === 2 ? { label: tail.label } : {}),
                attrs: { ...tail.attrs },
                span: spanOf(arrow),
              });
            }
          }
        }
      } else for (const ep of first) column(ep);
      endStatement(c);
      continue;
    }
    if (c.peek().kind === 'lbrace') {
      const brace = c.next();
      c.error(brace, "Unexpected '{'. Only alt, loop, opt, par and break can have a body");
      stack.push({ items: top().items, open: spanOf(brace) });
      continue;
    }
    for (const ep of first) column(ep);
    endStatement(c);
  }

  while (stack.length > 1) {
    const scope = stack.pop()!;
    if (scope.open) c.error(scope.open, scope.label ? `Missing closing '}' for '${scope.label}'` : "Missing closing '}'");
  }

  if (explicitOrder) {
    const rank = new Map(explicitOrder.map((name, i) => [name, i]));
    const listed = ast.columns.filter((col) => rank.has(col.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    ast.columns = [...listed, ...ast.columns.filter((col) => !rank.has(col.id))];
  }
  return ast;
}
