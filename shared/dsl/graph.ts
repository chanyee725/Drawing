import {
  arrowStyle, Cursor, describe, emptyBase, endStatement, GRAPH_KEYS, parseChain, parseCommonKeyword,
  parseConnectionTail, parseEndpoints, parseKeywordValue, recoverLine,
  type Endpoint,
} from './common.ts';
import type { Attrs, Direction, GraphChild, GraphDiagram, GraphEdge, GraphGroup, GraphNode } from './types.ts';

const DIRECTIONS: readonly string[] = ['down', 'up', 'left', 'right'];

interface Scope {
  children: GraphChild[];
  open?: { line: number; column: number; offset: number; length: number };
  name?: string;
}

/** Parser shared by cloud architecture and flowchart diagrams. */
export function parseGraph(c: Cursor, type: GraphDiagram['type']): GraphDiagram {
  c.keys = GRAPH_KEYS;
  c.checkShapes = true;
  const ast: GraphDiagram = {
    ...emptyBase(),
    type,
    direction: type === 'flowchart' ? 'down' : 'right',
    children: [],
    edges: [],
  };
  const registry = new Map<string, GraphChild>();
  const stack: Scope[] = [{ children: ast.children }];
  let edgeSeq = 0;

  const top = () => stack[stack.length - 1]!;

  const mergeAttrs = (target: GraphChild, attrs: Attrs) => {
    Object.assign(target.attrs, attrs);
    if (attrs.label !== undefined) target.label = attrs.label;
  };

  const define = (ep: Endpoint, kind: 'node' | 'group'): GraphChild | null => {
    const existing = registry.get(ep.name);
    if (existing) {
      c.error(
        ep.span,
        existing.kind === 'node' && existing.implicit
          ? `'${ep.name}' was already created by a connection above. Define it before connecting it`
          : `Duplicate name '${ep.name}'`,
      );
      return null;
    }
    const attrs = ep.attrs ?? {};
    const base = { id: ep.name, name: ep.name, label: attrs.label ?? ep.name, attrs, span: ep.span };
    const item: GraphChild =
      kind === 'group' ? { kind: 'group', ...base, children: [] } : { kind: 'node', ...base, implicit: false };
    top().children.push(item);
    registry.set(ep.name, item);
    return item;
  };

  /** Make sure a connection endpoint exists. Unknown names become implicit root-level nodes. */
  const reference = (ep: Endpoint) => {
    const existing = registry.get(ep.name);
    if (existing) {
      if (ep.attrs) mergeAttrs(existing, ep.attrs);
      return;
    }
    const attrs = ep.attrs ?? {};
    const node: GraphNode = {
      kind: 'node', id: ep.name, name: ep.name, label: attrs.label ?? ep.name, attrs, implicit: !ep.attrs, span: ep.span,
    };
    ast.children.push(node);
    registry.set(ep.name, node);
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
    if (t.kind === 'word' && t.text === 'direction' && ['word', 'colon'].includes(c.peek(1).kind)) {
      const kv = parseKeywordValue(c);
      if (kv) {
        if (DIRECTIONS.includes(kv.value)) ast.direction = kv.value as Direction;
        else c.error(kv.span, `Unknown direction '${kv.value}'. Use one of: ${DIRECTIONS.join(', ')}`);
      }
      endStatement(c);
      continue;
    }
    if (parseCommonKeyword(c, ast)) continue;

    const first = parseEndpoints(c);
    if (first.length === 0) {
      c.error(t, `Unexpected ${describe(t)}`);
      if (t.kind === 'lbrace') {
        c.next();
        stack.push({ children: top().children, open: t });
      } else recoverLine(c);
      continue;
    }

    const nx = c.peek();
    if (nx.kind === 'arrow') {
      const { lists, arrows } = parseChain(c, first);
      const tail = parseConnectionTail(c, stack.length > 1);
      if (lists.length > 1) {
        for (const list of lists) for (const ep of list) reference(ep);
        if (tail.label !== undefined && lists.length > 2) {
          c.warn(tail.labelSpan!, 'Labels are not supported on chained connections, so this one is ignored');
        }
        for (let i = 0; i < lists.length - 1; i++) {
          const arrow = arrows[i]!;
          for (const a of lists[i]!) {
            for (const b of lists[i + 1]!) {
              const edge: GraphEdge = {
                id: `e${++edgeSeq}`,
                from: a.name,
                to: b.name,
                ...arrowStyle(arrow.text),
                attrs: { ...tail.attrs },
                span: { line: arrow.line, column: arrow.column, offset: arrow.offset, length: arrow.length },
              };
              if (tail.label !== undefined && lists.length === 2) edge.label = tail.label;
              ast.edges.push(edge);
            }
          }
        }
      } else {
        // The chain broke right after the first arrow; keep what was written as declarations.
        for (const ep of first) reference(ep);
      }
      endStatement(c);
      continue;
    }

    if (nx.kind === 'lbrace') {
      if (first.length > 1) c.error(nx, 'A group needs exactly one name before {');
      const group = define(first[0]!, 'group') as GraphGroup | null;
      const existing = group ?? registry.get(first[0]!.name);
      c.next();
      stack.push({
        // A rejected group keeps its children in the current scope so every edge id stays in the tree.
        children: existing?.kind === 'group' ? existing.children : top().children,
        open: nx,
        name: first[0]!.name,
      });
      continue;
    }

    for (const ep of first) define(ep, 'node');
    endStatement(c);
  }

  while (stack.length > 1) {
    const scope = stack.pop()!;
    if (scope.open) c.error(scope.open, scope.name ? `Missing closing '}' for group '${scope.name}'` : "Missing closing '}'");
  }
  return ast;
}
