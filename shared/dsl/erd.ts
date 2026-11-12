import {
  Cursor, describe, emptyBase, endStatement, ERD_KEYS, parseAttrs, parseChain, parseCommonKeyword,
  parseConnectionTail, parseEndpoints, parseKeywordValue, recoverLine, spanOf, type Endpoint,
} from './common.ts';
import type { ErdCardinality, ErdDiagram, ErdEndpoint, ErdEntity, ErdField } from './types.ts';

const NOTATIONS = ['chen', 'crows-foot'] as const;
const META_WORDS = new Set(['pk', 'fk', 'unique', 'not', 'null']);
const CARDINALITY: Record<string, ErdCardinality> = {
  '<': 'one-to-many',
  '>': 'many-to-one',
  '-': 'one-to-one',
  '<>': 'many-to-many',
};

/** Entity relationship diagram parser. */
export function parseErd(c: Cursor): ErdDiagram {
  c.keys = ERD_KEYS;
  const ast: ErdDiagram = { ...emptyBase(), type: 'erd', notation: 'chen', entities: [], relationships: [] };
  const byId = new Map<string, ErdEntity>();

  const defineEntity = (ep: Endpoint): ErdEntity | null => {
    if (byId.has(ep.name)) {
      c.error(ep.span, `Duplicate entity '${ep.name}'`);
      return null;
    }
    const attrs = ep.attrs ?? {};
    const entity: ErdEntity = { id: ep.name, name: ep.name, label: attrs.label ?? ep.name, attrs, fields: [], span: ep.span };
    byId.set(ep.name, entity);
    ast.entities.push(entity);
    return entity;
  };

  const parseFieldLine = (entity: ErdEntity | null) => {
    const nameTok = c.peek();
    if (nameTok.kind !== 'word' && nameTok.kind !== 'string') {
      c.error(nameTok, `Expected a field name, found ${describe(nameTok)}`);
      recoverLine(c);
      return;
    }
    c.next();
    const field: ErdField = { name: nameTok.value, meta: [], attrs: {}, span: spanOf(nameTok) };
    for (;;) {
      const t = c.peek();
      if (c.atEol() || t.kind === 'rbrace') break;
      if (t.kind === 'lbrace') {
        c.error(t, 'Entities cannot be nested');
        c.next();
        parseBody(null, spanOf(t));
        return;
      }
      if (t.kind === 'lbracket') {
        field.attrs = parseAttrs(c);
      } else if (t.kind === 'word' || t.kind === 'string') {
        c.next();
        const word = t.kind === 'string' ? t.value : t.text;
        if (field.type === undefined && field.meta.length === 0 && (t.kind === 'string' || !META_WORDS.has(word.toLowerCase()))) {
          field.type = word;
        } else field.meta.push(word.toLowerCase());
      } else {
        c.error(t, t.kind === 'arrow' ? `Unexpected '${t.text}' in an entity body. Write relationships outside the braces` : `Unexpected ${describe(t)}`);
        recoverLine(c);
        break;
      }
    }
    entity?.fields.push(field);
    endStatement(c);
  };

  const parseBody = (entity: ErdEntity | null, open: ReturnType<typeof spanOf>) => {
    for (;;) {
      const t = c.peek();
      if (t.kind === 'eof') {
        c.error(open, `Missing closing '}' for entity '${entity?.name ?? ''}'`);
        return;
      }
      if (t.kind === 'newline') c.next();
      else if (t.kind === 'rbrace') {
        c.next();
        return;
      } else parseFieldLine(entity);
    }
  };

  const endpointOf = (ep: Endpoint): ErdEndpoint => {
    const dot = ep.name.indexOf('.');
    const out: ErdEndpoint = { entity: dot < 0 ? ep.name : ep.name.slice(0, dot), span: ep.span };
    if (dot >= 0) out.field = ep.name.slice(dot + 1);
    return out;
  };

  for (;;) {
    const t = c.peek();
    if (t.kind === 'eof') break;
    if (t.kind === 'newline') {
      c.next();
      continue;
    }
    if (t.kind === 'rbrace') {
      c.error(t, "Unexpected '}' without a matching '{'");
      c.next();
      continue;
    }
    if (t.kind === 'word' && t.text === 'notation' && ['word', 'colon'].includes(c.peek(1).kind)) {
      const kv = parseKeywordValue(c);
      if (kv) {
        if ((NOTATIONS as readonly string[]).includes(kv.value)) ast.notation = kv.value as ErdDiagram['notation'];
        else c.error(kv.span, `Unknown notation '${kv.value}'. Use one of: ${NOTATIONS.join(', ')}`);
      }
      endStatement(c);
      continue;
    }
    if (t.kind === 'word' && t.text === 'direction' && c.peek(1).kind === 'word') {
      c.warn(t, 'ERD diagrams do not support direction');
      recoverLine(c);
      endStatement(c);
      continue;
    }
    if (parseCommonKeyword(c, ast)) continue;

    const first = parseEndpoints(c);
    if (first.length === 0) {
      c.error(t, `Unexpected ${describe(t)}`);
      recoverLine(c);
      continue;
    }
    const nx = c.peek();
    if (nx.kind === 'arrow') {
      const { lists, arrows } = parseChain(c, first);
      const tail = parseConnectionTail(c);
      const hasEndpointAttrs = lists.some((list) => list.some((ep) => ep.attrs));
      if (lists.length > 1) {
        if (hasEndpointAttrs) {
          const withAttrs = lists.flat().find((ep) => ep.attrs)!;
          c.warn(withAttrs.span, "Attributes need a ':' before them in a relationship; without it the relationship is dropped");
        } else {
          if (tail.label !== undefined && lists.length > 2) {
            c.warn(tail.labelSpan!, 'Labels are not supported on chained connections, so this one is ignored');
          }
          for (let i = 0; i < lists.length - 1; i++) {
            const arrow = arrows[i]!;
            const cardinality = CARDINALITY[arrow.text];
            if (!cardinality) {
              c.warn(arrow, `ERD relationships use only <, >, - and <>, not '${arrow.text}'`);
              continue;
            }
            for (const a of lists[i]!) {
              for (const b of lists[i + 1]!) {
                ast.relationships.push({
                  from: endpointOf(a),
                  to: endpointOf(b),
                  cardinality,
                  ...(tail.label !== undefined && lists.length === 2 ? { label: tail.label } : {}),
                  attrs: { ...tail.attrs },
                  span: spanOf(arrow),
                });
              }
            }
          }
        }
      }
      endStatement(c);
      continue;
    }
    if (nx.kind === 'lbrace') {
      if (first.length > 1) c.error(nx, 'An entity needs exactly one name before {');
      const entity = defineEntity(first[0]!);
      parseBody(entity, spanOf(c.next()));
      continue;
    }
    for (const ep of first) defineEntity(ep);
    endStatement(c);
  }

  // Check relationship endpoints after parsing so definition order does not matter.
  for (const rel of ast.relationships) {
    for (const end of [rel.from, rel.to]) {
      const entity = byId.get(end.entity);
      if (!entity) c.warn(end.span, `Unknown entity '${end.entity}'`);
      else if (end.field !== undefined && !entity.fields.some((f) => f.name === end.field)) {
        c.warn(end.span, `Entity '${end.entity}' has no field '${end.field}'`);
      }
    }
  }
  return ast;
}
