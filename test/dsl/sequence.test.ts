import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequenceDiagram } from '../../shared/dsl/index.ts';
import type { SequenceBlock } from '../../shared/dsl/index.ts';
import { fixture, fmt } from './helpers.ts';

test('sequence fixture: columns, messages, activation, alt/else blocks', () => {
  const { ast, diagnostics } = parseSequenceDiagram(fixture('sequence-login'));
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.title, 'Login');
  assert.equal(ast.autoNumber, 'on');
  assert.deepEqual(ast.columns.map((c) => c.id), ['Client', 'API', 'DB']);
  assert.deepEqual(ast.columns[0]!.attrs, { icon: 'monitor' });
  assert.deepEqual(
    ast.items.map((i) => (i.kind === 'message' ? `${i.from}>${i.to}:${i.label}` : i.kind === 'activation' ? `${i.action} ${i.column}` : `${i.blockType}[${i.label}]`)),
    ['Client>API:POST /login', 'activate API', 'API>DB:find user', 'DB>API:row', 'alt[valid]', 'else[invalid]', 'deactivate API'],
  );
  const els = ast.items[5] as SequenceBlock;
  assert.equal(els.children.length, 1);
  const msg = els.children[0]!;
  assert.equal(msg.kind === 'message' && msg.label, '401');
  assert.deepEqual(msg.kind === 'message' && msg.attrs, { color: 'red' });
});

test('order controls column order; unlisted columns follow by first appearance', () => {
  const { ast, diagnostics } = parseSequenceDiagram('Z > A\nA > M\norder A, Z');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(ast.columns.map((c) => c.id), ['A', 'Z', 'M']);
});

test('nested blocks, par/and, loop, opt, break and all autoNumber modes', () => {
  const code = [
    'autoNumber nested',
    'loop [label: retry] {',
    '  A > B: ping',
    '  opt {',
    '    B --> A: pong',
    '  }',
    '}',
    'par {',
    '  A > B',
    '}',
    'and {',
    '  A > C',
    '}',
    'break [label: stop] {',
    '}',
  ].join('\n');
  const { ast, diagnostics } = parseSequenceDiagram(code);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.autoNumber, 'nested');
  assert.deepEqual(ast.items.map((i) => i.kind === 'block' && i.blockType), ['loop', 'par', 'and', 'break']);
  const loop = ast.items[0] as SequenceBlock;
  const opt = loop.children[1] as SequenceBlock;
  assert.equal(opt.blockType, 'opt');
  assert.equal(opt.children[0]!.kind === 'message' && opt.children[0]!.lineStyle, 'dashed');
  assert.deepEqual(ast.columns.map((c) => c.id), ['A', 'B', 'C']);
});

test('column attributes on either side of a message merge into the column', () => {
  const { ast } = parseSequenceDiagram('A > B\nA [icon: user, label: Alice] > B [color: blue]');
  assert.equal(ast.columns[0]!.label, 'Alice');
  assert.deepEqual(ast.columns[1]!.attrs, { color: 'blue' });
});

test('a column named like a block keyword still works without a body', () => {
  const { ast, diagnostics } = parseSequenceDiagram('loop > alt: go');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(ast.columns.map((c) => c.id), ['loop', 'alt']);
});

test('sequence errors carry exact positions', () => {
  const cases: [string, string[]][] = [
    ['autoNumber maybe', ["error 1:12+5 Unknown autoNumber 'maybe'. Use one of: off, on, nested"]],
    ['A > B\nactivate C', ["warning 2:10+1 Unknown column 'C'"]],
    ['A > B\ndeactivate A', ["warning 2:12+1 'A' is not active"]],
    ['A > B\nelse {\n}', ["warning 2:1+4 'else' must directly follow an 'alt' block"]],
    ['A > B\nand {\n}', ["warning 2:1+3 'and' must directly follow a 'par' block"]],
    ['alt [label: x] {\n  A > B\n', ["error 1:16+1 Missing closing '}' for 'alt'"]],
    ['alt [label: x]\nA > B', ["error 1:1+3 Expected '{' after 'alt'"]],
    ['A {\n}', ["error 1:3+1 Unexpected '{'. Only alt, loop, opt, par and break can have a body"]],
    ['A > B\n}', ["error 2:1+1 Unexpected '}' without a matching '{'"]],
    ['A > ', ["error 1:3+1 Expected a name after '>'"]],
    ['A > B: x [color: red', ["error 1:10+1 Missing closing ']'"]],
  ];
  for (const [code, expected] of cases) assert.deepEqual(fmt(parseSequenceDiagram(code).diagnostics), expected, code);
});

test('partial AST: messages before and after a broken block are kept', () => {
  const { ast, diagnostics } = parseSequenceDiagram('A > B: one\nalt [label: x] {\n  B > A: two\nA > B: three');
  assert.equal(diagnostics.length, 1);
  assert.equal(ast.items.length, 2);
  const alt = ast.items[1] as SequenceBlock;
  assert.equal(alt.children.length, 2);
});
