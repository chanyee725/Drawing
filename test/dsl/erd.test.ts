import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseErdDiagram } from '../../shared/dsl/index.ts';
import { fixture, fmt } from './helpers.ts';

test('ERD fixture: entities, typed fields, metadata, relationship attrs', () => {
  const { ast, diagnostics } = parseErdDiagram(fixture('erd-billing'));
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.title, 'Billing');
  assert.equal(ast.notation, 'crows-foot');
  assert.deepEqual(ast.entities.map((e) => e.id), ['users', 'teams', 'products']);
  const users = ast.entities[0]!;
  assert.deepEqual(users.attrs, { icon: 'user', color: 'blue' });
  assert.deepEqual(
    users.fields.map((f) => [f.name, f.type, f.meta]),
    [['id', 'string', ['pk']], ['email', 'string', ['unique', 'not', 'null']], ['teamId', 'string', []]],
  );
  const products = ast.entities[2]!;
  assert.deepEqual(products.fields.map((f) => f.type), ['int', 'enum(DVD, Blu-ray)', 'decimal(10,2)']);
  assert.equal(ast.relationships.length, 1);
  const rel = ast.relationships[0]!;
  assert.deepEqual([rel.from.entity, rel.from.field, rel.to.entity, rel.to.field], ['users', 'teamId', 'teams', 'id']);
  assert.equal(rel.cardinality, 'many-to-one');
  assert.deepEqual(rel.attrs, { color: 'green' });
});

test('notation defaults to chen; symbols map to cardinalities', () => {
  const { ast, diagnostics } = parseErdDiagram('a { id pk }\nb { id pk }\na > b\na < b\na - b\na <> b: link');
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.notation, 'chen');
  assert.deepEqual(ast.relationships.map((r) => r.cardinality), ['many-to-one', 'one-to-many', 'one-to-one', 'many-to-many']);
  assert.equal(ast.relationships[3]!.label, 'link');
  assert.deepEqual(ast.entities[0]!.fields[0], { name: 'id', meta: ['pk'], attrs: {}, span: ast.entities[0]!.fields[0]!.span });
});

test('field attributes, quoted names, entities without a body, one-line fields', () => {
  const { ast, diagnostics } = parseErdDiagram('"order items" {\n  qty int [icon: hash]\n  "odd name" text\n}\nlonely\nx { }');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(ast.entities.map((e) => e.id), ['order items', 'lonely', 'x']);
  assert.deepEqual(ast.entities[0]!.fields.map((f) => f.name), ['qty', 'odd name']);
  assert.deepEqual(ast.entities[0]!.fields[0]!.attrs, { icon: 'hash' });
});

test('relationships may reference entities defined later', () => {
  const { diagnostics } = parseErdDiagram('a.id > b.a_id\na { id pk }\nb { a_id fk }');
  assert.deepEqual(diagnostics, []);
});

test('ERD errors carry exact positions', () => {
  const cases: [string, string[]][] = [
    ['notation uml', ["error 1:10+3 Unknown notation 'uml'. Use one of: chen, crows-foot"]],
    ['direction right', ['warning 1:1+9 ERD diagrams do not support direction']],
    ['a { id pk }\na { id pk }', ["error 2:1+1 Duplicate entity 'a'"]],
    ['a { id pk }\na > b', ["warning 2:5+1 Unknown entity 'b'"]],
    ['a { id pk }\nb { id pk }\na.nope > b.id', ["warning 3:1+6 Entity 'a' has no field 'nope'"]],
    ['a { id pk }\nb { id pk }\na > b [color: red]', ["warning 3:5+1 Attributes need a ':' before them in a relationship; without it the relationship is dropped"]],
    ['a { id pk }\nb { id pk }\na --> b', ["warning 3:3+3 ERD relationships use only <, >, - and <>, not '-->'"]],
    ['a {\n  id pk\n', ["error 1:3+1 Missing closing '}' for entity 'a'"]],
    ['a {\n  b {\n  }\n}', ['error 2:5+1 Entities cannot be nested']],
    ['a {\n  id > b\n}', ["error 2:6+1 Unexpected '>' in an entity body. Write relationships outside the braces"]],
    ['a {\n  [x]\n}', ["error 2:3+1 Expected a field name, found '['"]],
    ['}', ["error 1:1+1 Unexpected '}' without a matching '{'"]],
  ];
  for (const [code, expected] of cases) assert.deepEqual(fmt(parseErdDiagram(code).diagnostics), expected, code);
});

test('partial AST: a broken entity does not drop later ones', () => {
  const { ast } = parseErdDiagram('a {\n  id pk\n  [\n}\nb { id pk }\na > b');
  assert.deepEqual(ast.entities.map((e) => e.id), ['a', 'b']);
  assert.equal(ast.relationships.length, 1);
});
