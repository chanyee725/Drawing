import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, tokenize } from '../../shared/dsl/index.ts';
import type { DiagramType } from '../../shared/dsl/index.ts';
import { fixture } from './helpers.ts';

const FIXTURES = ['flowchart-ticket-workflow', 'erd-billing', 'architecture-web-service', 'sequence-login'];
const TYPES: DiagramType[] = ['cloud-architecture', 'flowchart', 'sequence', 'erd'];

test('every fixture parses with no diagnostics and detects its own type', () => {
  const expected = ['flowchart', 'erd', 'cloud-architecture', 'sequence'];
  FIXTURES.forEach((name, i) => {
    const r = parse(fixture(name));
    assert.deepEqual(r.diagnostics, [], name);
    assert.equal(r.ast.type, expected[i], name);
  });
});

test('empty and whitespace-only input gives an empty AST without diagnostics', () => {
  for (const type of TYPES) {
    for (const code of ['', '   \n\n\t', '// only a comment']) {
      const r = parse(code, type);
      assert.deepEqual(r.diagnostics, []);
      assert.equal(r.ast.type, type);
    }
  }
});

test('never throws: every prefix, every deleted line and random garbage', () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alphabet = ['{', '}', '[', ']', ',', ':', '"', '>', '<', '-', '--', '-->', '<>', '//', '\n', ' ', 'a', 'B c', 'icon', 'alt', 'else', 'legend', 'title', 'pk', '(', ')', '\\', '\r'];
  const inputs: string[] = [];
  for (const name of FIXTURES) {
    const text = fixture(name);
    for (let i = 0; i <= text.length; i += 3) inputs.push(text.slice(0, i), text.slice(i));
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) inputs.push(lines.filter((_, j) => j !== i).join('\n'));
  }
  for (let n = 0; n < 400; n++) {
    let s = '';
    for (let k = rand() * 40; k > 0; k--) s += alphabet[Math.floor(rand() * alphabet.length)];
    inputs.push(s);
  }
  for (const input of inputs) {
    for (const type of TYPES) {
      const r = parse(input, type);
      assert.equal(r.ast.type, type);
      assert.ok(!r.diagnostics.some((d) => d.message.startsWith('Internal parser error')), JSON.stringify(input));
      for (const d of r.diagnostics) {
        assert.ok(d.line >= 1 && d.column >= 1 && d.length >= 0 && d.offset >= 0 && d.offset <= input.length, JSON.stringify([input, d]));
      }
    }
  }
});

test('non-string input does not throw', () => {
  assert.doesNotThrow(() => parse(undefined as unknown as string));
  assert.doesNotThrow(() => parse(null as unknown as string, 'erd'));
});

test('result is plain JSON', () => {
  for (const name of FIXTURES) {
    const r = parse(fixture(name));
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  }
});

test('tokenizer: positions, strings, arrows, parentheses', () => {
  const { tokens, diagnostics } = tokenize('a-b > "x\\"y" -- c(1, 2) //note\n-->');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    tokens.map((t) => `${t.kind}:${t.value}@${t.line}:${t.column}`),
    ['word:a-b@1:1', 'arrow:>@1:5', 'string:x"y@1:7', 'arrow:--@1:14', 'word:c(1, 2)@1:17', 'newline:\n@1:31', 'arrow:-->@2:1', 'eof:@2:4'],
  );
});

test('tokenizer: unterminated string is reported with its position', () => {
  const { diagnostics } = tokenize('x "abc\ny');
  assert.deepEqual(diagnostics.map((d) => [d.line, d.column, d.length, d.severity]), [[1, 3, 4, 'error']]);
});

test('a large diagram parses quickly', () => {
  let code = '';
  for (let i = 0; i <= 2000; i++) code += `N${i} [icon: x]\n`;
  for (let i = 0; i < 2000; i++) code += `N${i} > N${i + 1}: l${i}\n`;
  const t = Date.now();
  const r = parse(code, 'cloud-architecture');
  assert.equal(r.diagnostics.length, 0);
  assert.ok(Date.now() - t < 1000);
});
