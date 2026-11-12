import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDiagramType, parse, parseArchitecture, parseErdDiagram, parseFlowchart, tokenize } from '../../shared/dsl/index.ts';
import { fmt } from './helpers.ts';

test('many unclosed parentheses on one line stay fast', () => {
  const line = '('.repeat(80000);
  const t = Date.now();
  const { tokens } = tokenize(line);
  assert.equal(tokens.length, 2);
  assert.ok(Date.now() - t < 500, `took ${Date.now() - t} ms`);
  assert.equal(parseArchitecture(`A > ${line}`).ast.edges.length, 1);
});

test('parentheses still pair correctly with a stack', () => {
  const { tokens } = tokenize('a(1, (2)) b( c(3,4)');
  assert.deepEqual(tokens.filter((x) => x.kind === 'word').map((x) => x.text), ['a(1, (2))', 'b(', 'c(3,4)']);
});

test('deeply nested ERD braces do not overflow the stack and keep the partial AST', () => {
  const code = 'a {\n  id pk\n}\nb {\n' + 'x {\n'.repeat(20000) + '}\n' + 'c { id pk }';
  const { ast, diagnostics } = parseErdDiagram(code);
  assert.ok(!diagnostics.some((d) => d.message.startsWith('Internal parser error')));
  assert.deepEqual(ast.entities.map((e) => e.id), ['a', 'b']);
  // 20000 `x {` lines plus the trailing `c {` are all nested openings.
  assert.equal(diagnostics.filter((d) => d.message === 'Entities cannot be nested').length, 20001);
});

test('nested ERD braces: fields inside the nested body are not added to the entity', () => {
  const { ast, diagnostics } = parseErdDiagram('a {\n  id pk\n  b {\n    hidden int\n  }\n  after int\n}');
  assert.deepEqual(fmt(diagnostics), ['error 3:5+1 Entities cannot be nested']);
  assert.deepEqual(ast.entities[0]!.fields.map((f) => f.name), ['id', 'after']);
});

test('unquoted URLs are not cut by the comment rule', () => {
  const link = parseArchitecture('A [link: https://x.test/a?b=1]');
  assert.deepEqual(link.diagnostics, []);
  assert.equal(link.ast.children[0]!.attrs.link, 'https://x.test/a?b=1');
  const label = parseArchitecture('A > B: see http://x.test ok');
  assert.deepEqual(label.diagnostics, []);
  assert.equal(label.ast.edges[0]!.label, 'see http://x.test ok');
  // A real comment after the URL is still a comment.
  assert.equal(parseArchitecture('A > B: http://x.test // note').ast.edges[0]!.label, 'http://x.test');
  assert.equal(parseArchitecture('A > B: x // note').ast.edges[0]!.label, 'x');
});

test('-> and <- warn and still make a connection; --> works without spaces', () => {
  const a = parseFlowchart('A -> B');
  assert.deepEqual(fmt(a.diagnostics), ["warning 1:3+2 '->' is not a connection symbol. Use '>' (or '-->' for a dashed line)"]);
  assert.deepEqual(a.ast.children.map((n) => n.id), ['A', 'B']);
  assert.deepEqual([a.ast.edges[0]!.symbol, a.ast.edges[0]!.endArrow], ['>', true]);
  const b = parseFlowchart('A <- B');
  assert.deepEqual(fmt(b.diagnostics), ["warning 1:3+2 '<-' is not a connection symbol. Use '<' (or '<--' for a dashed line)"]);
  assert.deepEqual([b.ast.edges[0]!.symbol, b.ast.edges[0]!.startArrow], ['<', true]);
  const c = parseFlowchart('A-->B');
  assert.deepEqual(c.diagnostics, []);
  assert.deepEqual(c.ast.children.map((n) => n.id), ['A', 'B']);
  assert.equal(c.ast.edges[0]!.lineStyle, 'dashed');
  assert.deepEqual(parseFlowchart('A->B').ast.children.map((n) => n.id), ['A', 'B']);
  assert.deepEqual(parseFlowchart('web-01 > aws-ec2').ast.children.map((n) => n.id), ['web-01', 'aws-ec2']);
});

test('type detection needs the statement shape, not just a keyword', () => {
  const cases: [string, string][] = [
    ['break glass > Alarm', 'cloud-architecture'],
    ['and gate > or gate', 'cloud-architecture'],
    ['else path > loop back', 'cloud-architecture'],
    ['par x > Y', 'cloud-architecture'],
    ['order service > Shipping', 'cloud-architecture'],
    ['G {\n  pk > x\n}', 'cloud-architecture'],
    ['notation > x', 'cloud-architecture'],
    ['loop [label: x] {\n  A > B\n}', 'sequence'],
    ['alt {\n}', 'sequence'],
    ['order A, B', 'sequence'],
    ['activate API', 'sequence'],
    ['users {\n  id string pk\n}', 'erd'],
    ['users { id pk }', 'erd'],
    ['notation crows-foot', 'erd'],
  ];
  for (const [code, type] of cases) assert.equal(parse(code).ast.type, type, code);
});

test('type detection allows leading spaces and tabs and stays fast with many blank lines', () => {
  assert.equal(detectDiagramType('  loop {\n  A > B\n}'), 'sequence');
  assert.equal(detectDiagramType('\tactivate API'), 'sequence');
  assert.equal(detectDiagramType('  notation crows-foot\nA { id pk }'), 'erd');
  const t = Date.now();
  assert.equal(detectDiagramType('\n'.repeat(50000) + 'a > b'), 'cloud-architecture');
  assert.ok(Date.now() - t < 2000);
});

test('a one-line group closes on its } and keeps the label (graph and sequence)', () => {
  const g = parseArchitecture('G { A > B: hi }\nC > D');
  assert.deepEqual(g.diagnostics, []);
  const edges = g.ast.edges ?? [];
  assert.equal(edges[0]?.label, 'hi');
  assert.equal(g.ast.children.length >= 2, true);
  const s = parse('loop { a > b: ping }\nb > a: pong', 'sequence');
  assert.deepEqual(s.diagnostics, []);
});

test('offsets still count the BOM', () => {
  const plain = parse('a > > b', 'cloud-architecture').diagnostics.map((d) => d.offset);
  const bom = parse('\uFEFFa > > b', 'cloud-architecture').diagnostics.map((d) => d.offset);
  assert.deepEqual(bom, plain.map((o) => o + 1));
});

test('parse never throws, even when the input cannot be turned into a string', () => {
  const evil = { toString() { throw new Error('nope'); } } as unknown as string;
  const r = parse(evil);
  assert.equal(r.diagnostics[0]?.severity, 'error');
  assert.match(r.diagnostics[0]!.message, /Internal parser error/);
});

test('an unclosed entity body names the entity, or nothing when there is none', () => {
  assert.deepEqual(fmt(parse('a {\n id string', 'erd').diagnostics), ["error 1:3+1 Missing closing '}' for entity 'a'"]);
});
