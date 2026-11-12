import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGlobal, writeGlobal, propsFor, PROPS } from '../../web/src/dsl/globals.ts';
import { parse } from '../../shared/dsl/index.ts';

test('reads the last top-level global line, ignoring comments and group bodies', () => {
  const code = 'title T\ncolorMode bold\n// typeface mono\nG {\n  typeface clean\n}\ncolorMode: outline\n';
  assert.equal(readGlobal(code, 'colorMode'), 'outline');
  assert.equal(readGlobal(code, 'typeface'), null);
});

test('writes in place, inserts under the title, removes on null', () => {
  assert.equal(writeGlobal('title T\ndirection right\nA > B\n', 'direction', 'down'), 'title T\ndirection down\nA > B\n');
  assert.equal(writeGlobal('title T\nA > B\n', 'colorMode', 'bold'), 'title T\ncolorMode bold\nA > B\n');
  assert.equal(writeGlobal('A > B', 'colorMode', 'bold'), 'colorMode bold\nA > B');
  assert.equal(writeGlobal('title T\ncolorMode bold\nA', 'colorMode', null), 'title T\nA');
  assert.equal(writeGlobal('A', 'colorMode', null), 'A');
  assert.equal(writeGlobal('colorMode: bold // x\nA', 'colorMode', 'plain'), 'colorMode: plain\nA');
});

test('every written value parses without diagnostics', () => {
  for (const type of ['flowchart', 'architecture', 'sequence', 'erd'] as const) {
    const pt = type === 'architecture' ? 'cloud-architecture' : type;
    for (const def of propsFor(type)) {
      for (const o of def.options) {
        const code = writeGlobal('title T\n', def.key, o.value);
        const { diagnostics } = parse(code, pt);
        assert.deepEqual(diagnostics, [], `${type} ${def.key} ${o.value}`);
      }
    }
  }
  assert.ok(PROPS.length > 0);
});

test('direction is offered only for graph types', () => {
  assert.ok(propsFor('flowchart').some((p) => p.key === 'direction'));
  assert.ok(!propsFor('erd').some((p) => p.key === 'direction'));
  assert.deepEqual(propsFor('bpmn'), []);
});

test('CRLF code: new line goes under the title and endings stay CRLF', () => {
  assert.equal(writeGlobal('title T\r\nA > B\r\n', 'colorMode', 'bold'), 'title T\r\ncolorMode bold\r\nA > B\r\n');
  assert.equal(writeGlobal('title T\r\ncolorMode bold\r\nA\r\n', 'colorMode', 'outline'), 'title T\r\ncolorMode outline\r\nA\r\n');
  assert.equal(readGlobal('colorMode bold\r\nA', 'colorMode'), 'bold');
});

test('quotes hide // and braces from depth counting', () => {
  assert.equal(readGlobal('G [link: "https://x.io"] {\n  typeface mono\n}\n', 'typeface'), null);
  assert.equal(readGlobal('G [label: "{"]\ntypeface mono\n', 'typeface'), 'mono');
});

test('duplicate global lines collapse into one below the title', () => {
  assert.equal(
    writeGlobal('title T\ncolorMode bold\nA\ncolorMode outline\nB\n', 'colorMode', 'pastel'),
    'title T\ncolorMode pastel\nA\nB\n',
  );
});
