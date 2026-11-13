import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseArchitecture, parseFlowchart } from '../../shared/dsl/index.ts';
import type { GraphChild, GraphGroup } from '../../shared/dsl/index.ts';
import { fixture, fmt } from './helpers.ts';

test('flowchart fixture: nodes, shapes, chain, labels, edge attrs', () => {
  const { ast, diagnostics } = parseFlowchart(fixture('flowchart-ticket-workflow'));
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.type, 'flowchart');
  assert.equal(ast.title, 'Ticket workflow');
  assert.equal(ast.direction, 'right');
  assert.deepEqual(ast.children.map((n) => n.id), ['Start', 'Triage', 'Valid?', 'Fix', 'Done']);
  const start = ast.children[0]!;
  assert.deepEqual(start.attrs, { shape: 'oval', color: 'green' });
  assert.equal(start.kind === 'node' && start.implicit, false);
  assert.deepEqual(
    ast.edges.map((e) => `${e.from}>${e.to}:${e.label ?? ''}`),
    ['Start>Triage:', 'Triage>Valid?:', 'Valid?>Fix:yes', 'Valid?>Done:no', 'Fix>Done:'],
  );
  assert.deepEqual(ast.edges[3]!.attrs, { color: 'red' });
  assert.deepEqual(ast.edges[0]!.span, { line: 10, column: 7, offset: 161, length: 1 });
});

test('architecture fixture: nested groups, icons, edge labels', () => {
  const { ast, diagnostics } = parseArchitecture(fixture('architecture-web-service'));
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.direction, 'right');
  assert.deepEqual(ast.children.map((n) => n.id), ['Users', 'VPC']);
  const vpc = ast.children[1] as GraphGroup;
  assert.equal(vpc.kind, 'group');
  const [pub, priv] = vpc.children as GraphGroup[];
  assert.deepEqual(pub!.children.map((n) => n.id), ['LB', 'Web']);
  assert.deepEqual(priv!.children.map((n) => n.id), ['DB', 'Queue']);
  assert.deepEqual(pub!.children[1]!.attrs, { icon: 'aws-ec2', color: 'blue' });
  assert.equal(ast.edges.length, 4);
  assert.equal(ast.edges[0]!.label, 'HTTPS');
  assert.deepEqual(ast.edges[2]!.attrs, { color: 'green' });
  assert.equal(ast.edges[2]!.label, 'SQL');
});

test('default direction depends on the type; explicit direction wins', () => {
  assert.equal(parseFlowchart('A > B').ast.direction, 'down');
  assert.equal(parseArchitecture('A > B').ast.direction, 'right');
  assert.equal(parseArchitecture('A > B\ndirection up').ast.direction, 'up');
});

test('connection symbols map to line style and arrow heads', () => {
  const { ast, diagnostics } = parseFlowchart('A > B\nA < B\nA <> B\nA - B\nA -- B\nA --> B\nA <-- B\nA <--> B');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    ast.edges.map((e) => [e.symbol, e.lineStyle, e.startArrow, e.endArrow]),
    [
      ['>', 'solid', false, true],
      ['<', 'solid', true, false],
      ['<>', 'solid', true, true],
      ['-', 'solid', false, false],
      ['--', 'dashed', false, false],
      ['-->', 'dashed', false, true],
      ['<--', 'dashed', true, false],
      ['<-->', 'dashed', true, true],
    ],
  );
});

test('branches and chains expand to single edges; implicit nodes are created', () => {
  const { ast, diagnostics } = parseFlowchart('A > B, C\nX, Y > Z\nP > Q > R');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(ast.edges.map((e) => `${e.from}>${e.to}`), ['A>B', 'A>C', 'X>Z', 'Y>Z', 'P>Q', 'Q>R']);
  assert.deepEqual(ast.children.map((n) => n.id), ['A', 'B', 'C', 'X', 'Y', 'Z', 'P', 'Q', 'R']);
  assert.ok(ast.children.every((n) => n.kind === 'node' && n.implicit));
});

test('names with spaces, quotes, labels and attribute values', () => {
  const { ast, diagnostics } = parseArchitecture(
    'wrap off\n"web-01\\n10.0.12.34" [icon: aws-ec2, label: "Web, primary"]\nOpen   website [color: "#ff00aa", link: "https://example.test/a"]\nA > B: x, y; z (1)',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.styles.wrap, 'off');
  assert.equal(ast.children[0]!.id, 'web-01\n10.0.12.34');
  assert.equal(ast.children[0]!.label, 'Web, primary');
  assert.equal(ast.children[1]!.id, 'Open website');
  assert.equal(ast.children[1]!.attrs.link, 'https://example.test/a');
  assert.equal(ast.edges[0]!.label, 'x, y; z (1)');
});

test('comments, title, global styles and legend', () => {
  const code = [
    '// full line comment',
    'title My system // trailing comment',
    'colorMode bold',
    'styleMode plain',
    'typeface clean',
    'textSize medium',
    'connectorStyle straight',
    'A [label: Alpha] // note',
    'legend [position: bottom-left] {',
    '  [connection: -->, label: Async]',
    '  [color: red, label: Error]',
    '}',
    'A > B',
  ].join('\n');
  const { ast, diagnostics } = parseArchitecture(code);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.title, 'My system');
  assert.deepEqual(ast.styles, { colorMode: 'bold', styleMode: 'plain', typeface: 'clean', textSize: 'medium', connectorStyle: 'straight' });
  assert.deepEqual(ast.globalStyles.map((s) => [s.key, s.span.line]), [
    ['colorMode', 3], ['styleMode', 4], ['typeface', 5], ['textSize', 6], ['connectorStyle', 7],
  ]);
  assert.equal(ast.children[0]!.label, 'Alpha');
  assert.equal(ast.legend?.position, 'bottom-left');
  assert.deepEqual(ast.legend?.entries, [{ connection: '-->', label: 'Async' }, { color: 'red', label: 'Error' }]);
  assert.equal(ast.edges.length, 1);
});

test('edge attributes need a colon; without it they go to the target node', () => {
  const { ast } = parseFlowchart('A > B [color: red]\nC > D: [color: green]');
  assert.deepEqual(ast.edges[0]!.attrs, {});
  assert.deepEqual(ast.children.find((n) => n.id === 'B')!.attrs, { color: 'red' });
  assert.deepEqual(ast.edges[1]!.attrs, { color: 'green' });
  assert.equal(ast.edges[1]!.label, undefined);
});

test('windows line endings and a BOM parse the same', () => {
  const a = parseFlowchart('A > B: x\nC');
  const b = parseFlowchart('﻿A > B: x\r\nC');
  assert.deepEqual(b.ast.edges.map((e) => [e.from, e.to, e.label]), a.ast.edges.map((e) => [e.from, e.to, e.label]));
  assert.deepEqual(b.diagnostics, []);
});

test('first-line markers and type detection', () => {
  assert.equal(parse('flow-chart\nA > B').ast.type, 'flowchart');
  assert.equal(parse('cloud-architecture-diagram\nA > B').ast.type, 'cloud-architecture');
  assert.equal(parse('A [shape: diamond]').ast.type, 'flowchart');
  assert.equal(parse('A > B').ast.type, 'cloud-architecture');
  assert.equal(parse('A > B: hi\nactivate B').ast.type, 'sequence');
  assert.equal(parse('notation chen\nusers { id pk }').ast.type, 'erd');
  const marked = parse('flow-chart\nA > Valid?');
  assert.equal(marked.ast.type === 'flowchart' && marked.ast.edges[0]!.span.line, 2);
});

test('errors carry exact positions', () => {
  const cases: [string, DiagramLike, string[]][] = [
    ['direction sideways', 'flowchart', ["error 1:11+8 Unknown direction 'sideways'. Use one of: down, up, left, right"]],
    ['A [shape: blob]', 'flowchart', ["warning 1:11+4 Unknown shape 'blob'. Use one of: rectangle, circle, cylinder, diamond, document, ellipse, hexagon, oval, parallelogram, star, trapezoid, triangle"]],
    ['A [colour: red]', 'flowchart', ["warning 1:4+6 Unknown attribute 'colour'"]],
    ['A [color: red, color: blue]', 'flowchart', ["warning 1:16+5 Duplicate attribute 'color'"]],
    ['A [color: #12]', 'flowchart', ["warning 1:11+3 Invalid hex color '#12'"]],
    ['A [icon]', 'architecture', ["error 1:4+4 Expected ':' after 'icon'"]],
    ['A [icon:]', 'architecture', ["error 1:4+4 Missing value for 'icon'"]],
    ['A [icon: x', 'architecture', ["error 1:3+1 Missing closing ']'"]],
    ['A >', 'flowchart', ["error 1:3+1 Expected a name after '>'"]],
    ['A > B > C: hi', 'flowchart', ['warning 1:12+2 Labels are not supported on chained connections, so this one is ignored']],
    ['G {\n  A\n', 'flowchart', ["error 1:3+1 Missing closing '}' for group 'G'"]],
    ['A\n}', 'flowchart', ["error 2:1+1 Unexpected '}' without a matching '{'"]],
    ['A { B } }', 'flowchart', ["error 1:9+1 Unexpected '}' without a matching '{'"]],
    ['A, B {\n}', 'flowchart', ['error 1:6+1 A group needs exactly one name before {']],
    ['A > B\nA > B extra {', 'flowchart', ["error 2:13+1 Unexpected '{'"]],
    ['> B', 'flowchart', ["error 1:1+1 Unexpected '>'"]],
    ['A, > B', 'flowchart', ["error 1:2+1 Expected a name after ','"]],
    ['A [icon: "oops]', 'flowchart', ["error 1:3+1 Missing closing ']'", 'error 1:10+6 Unterminated string: add a closing "']],
    ['colorMode neon', 'flowchart', ["warning 1:11+4 Unknown colorMode 'neon'. Use one of: pastel, bold, outline"]],
  ];
  for (const [code, kind, expected] of cases) {
    const { diagnostics } = kind === 'flowchart' ? parseFlowchart(code) : parseArchitecture(code);
    assert.deepEqual(fmt(diagnostics), expected, code);
  }
});

type DiagramLike = 'flowchart' | 'architecture';

test('duplicate definitions and late definitions of implicit nodes are errors', () => {
  const dup = parseArchitecture('A\nA');
  assert.deepEqual(fmt(dup.diagnostics), ["error 2:1+1 Duplicate name 'A'"]);
  assert.equal(dup.ast.children.length, 1);

  const late = parseArchitecture('X > Web\nG {\n  Web\n}');
  assert.deepEqual(fmt(late.diagnostics), ["error 3:3+3 'Web' was already created by a connection above. Define it before connecting it"]);
  // Partial AST: Web stays at the root, group G is still there.
  assert.deepEqual(late.ast.children.map((n) => n.id), ['X', 'Web', 'G']);
  assert.deepEqual((late.ast.children[2] as GraphGroup).children, []);
});

test('partial AST survives errors on other lines', () => {
  const { ast, diagnostics } = parseFlowchart('A > B\n??? [\nC > D\nG {\n  E\n');
  assert.ok(diagnostics.length >= 2);
  assert.deepEqual(ast.edges.map((e) => `${e.from}>${e.to}`), ['A>B', 'C>D']);
  const g = ast.children.find((n) => n.id === 'G') as GraphGroup;
  assert.deepEqual(g.children.map((n) => n.id), ['E']);
});

function treeIds(children: GraphChild[]): string[] {
  return children.flatMap((n) => (n.kind === 'group' ? [n.id, ...treeIds(n.children)] : [n.id]));
}

test('children of a rejected group stay in the tree so every edge id resolves', () => {
  for (const code of ['A\nA {\n  B\n}\nB > C', 'X > A\nA { B }\nB > C']) {
    const { ast, diagnostics } = parseArchitecture(code);
    assert.equal(diagnostics.length, 1, code);
    const ids = new Set(treeIds(ast.children));
    assert.ok(ids.has('B'), code);
    for (const e of ast.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${code}: ${e.from}>${e.to}`);
  }
});

test("a '}' glued into a name warns how to keep it; quoted braces and spaced braces stay quiet", () => {
  const hint = "warning 2:4+1 '}' ends the block here. To use a '}' inside a name or label, put the text in quotes";
  assert.ok(fmt(parseFlowchart('G {\n  a}b\n}').diagnostics).includes(hint));
  assert.deepEqual(fmt(parseFlowchart('G {\n  "a}b"\n}').diagnostics), []);
  assert.deepEqual(fmt(parseFlowchart('A > B: "x } y"').diagnostics), []);
  assert.deepEqual(fmt(parseFlowchart('G { A }\nH {B}').diagnostics), []);
  const { ast } = parseFlowchart('G {\n  "a}b" > C\n}');
  assert.ok(JSON.stringify(ast).includes('"label":"a}b"'));
});

test("an edge label and a node label in quotes keep their '}' (the unquoted form warns instead of cutting silently)", () => {
  const { ast, diagnostics } = parseFlowchart('A [label: "x}y"]\nA > B: "ok } fine"');
  assert.deepEqual(fmt(diagnostics), []);
  const json = JSON.stringify(ast);
  assert.ok(json.includes('x}y') && json.includes('ok } fine'));
  assert.ok(fmt(parseFlowchart('A [label: x}y]').diagnostics).some((d) => d.includes("put the text in quotes")));
});

test('E40: subtitle attribute and nodeStyle global parse without warnings', () => {
  const { ast, diagnostics } = parseArchitecture(['nodeStyle icon', 'Web [icon: react, subtitle: React SPA]'].join('\n'));
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.styles.nodeStyle, 'icon');
  assert.deepEqual(ast.children[0]!.attrs, { icon: 'react', subtitle: 'React SPA' });
  const bad = parseArchitecture('nodeStyle round\nA');
  assert.equal(bad.diagnostics.length, 1);
  assert.match(bad.diagnostics[0]!.message, /Unknown nodeStyle 'round'. Use one of: box, icon/);
});
