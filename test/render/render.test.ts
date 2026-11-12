import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '../../shared/dsl/index.ts';
import { renderDiagram, sceneToSvg } from '../../shared/render/index.ts';
import type { SceneBox, SceneEdge } from '../../shared/render/index.ts';
import { fixture } from '../dsl/helpers.ts';

const FIXTURES = ['architecture-web-service', 'flowchart-ticket-workflow', 'sequence-login', 'erd-billing'];

/** Compare with `__snapshots__/<name>.svg`; write it when missing or with UPDATE_SNAPSHOTS=1. */
function snapshot(name: string, svg: string): void {
  const file = fileURLToPath(new URL(`./__snapshots__/${name}.svg`, import.meta.url));
  const update = process.env.UPDATE_SNAPSHOTS === '1';
  if (!update && !existsSync(file) && process.env.CI) assert.fail(`snapshot ${name} is missing (run with UPDATE_SNAPSHOTS=1 and commit it)`);
  if (update || !existsSync(file)) writeFileSync(file, svg + '\n');
  assert.equal(svg + '\n', readFileSync(file, 'utf8'), `snapshot ${name} changed (UPDATE_SNAPSHOTS=1 to accept)`);
}

for (const name of FIXTURES) {
  test(`snapshot: ${name} (light and dark)`, async () => {
    const { svg, scene, diagnostics } = await renderDiagram(fixture(name));
    assert.deepEqual(diagnostics, []);
    assert.ok(scene.width > 0 && scene.height > 0);
    // Cheap well-formedness check: every attribute is `name="value"` and tags balance.
    assert.doesNotMatch(svg, /=""[^\s/>]/);
    for (const tag of svg.match(/<[a-z][^>]*>/g) ?? []) assert.match(tag, /^<[a-z]+(\s[a-zA-Z:-]+="[^"]*")*\s*\/?>$/, tag);
    assert.equal((svg.match(/<g[\s>]/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length);
    snapshot(name, svg);
    snapshot(`${name}.dark`, sceneToSvg(scene, { theme: 'dark', background: true }));
  });
}

test('deterministic: same code renders the same SVG twice', async () => {
  for (const name of FIXTURES) {
    const a = await renderDiagram(fixture(name));
    const b = await renderDiagram(fixture(name));
    assert.equal(a.svg, b.svg);
  }
});

test('performance: 100-node architecture diagram lays out in under 150 ms', async () => {
  const lines: string[] = [];
  for (let g = 0; g < 5; g++) {
    lines.push(`G${g} [icon: aws] {`);
    for (let i = 0; i < 20; i++) lines.push(`  N${g}_${i} [icon: server]`);
    lines.push('}');
  }
  for (let g = 0; g < 5; g++) for (let i = 0; i < 19; i++) lines.push(`N${g}_${i} > N${(g + (i % 3 === 0 ? 1 : 0)) % 5}_${i + 1}: e${i}`);
  const code = lines.join('\n');
  await renderDiagram(code); // warm-up (JIT)
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const r = await renderDiagram(code);
    times.push(performance.now() - t0);
    assert.equal(r.scene.items.filter((it) => it.kind === 'icon').length, 105);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[2]! < (process.env.CI ? 450 : 150), `median ${times[2]!.toFixed(1)} ms`);
});

test('colour values cannot inject markup', async () => {
  const code = 'A [color: "red\\" onload=\\"alert(1)", label: "<script>x</script>"]\nB [icon: "a\\"b"]\nA > B: "<b>&" [color: "url(javascript:1)"]';
  const { svg } = await renderDiagram(code, { type: 'flowchart' });
  assert.ok(!svg.includes('onload'), 'attribute injection');
  assert.ok(!svg.includes('<script'), 'raw script tag');
  assert.ok(!svg.includes('javascript:'), 'colour url');
  assert.ok(svg.includes('&lt;script&gt;'), 'label is escaped');
  assert.ok(svg.includes('&lt;b&gt;&amp;'), 'edge label is escaped');
  assert.ok(svg.includes('data-icon="a&quot;b"'), 'icon name is escaped');
});

test('edges inside nested groups use absolute coordinates', async () => {
  const code = ['U', 'Outer {', '  Inner {', '    A', '    B', '  }', '}', 'U > A', 'A > B: x', 'B > Outer', 'A > Inner'].join('\n');
  const { scene } = await renderDiagram(code, { type: 'cloud-architecture' });
  const box = (id: string): SceneBox => scene.items.find((i): i is SceneBox => i.kind === 'box' && i.id === id)!;
  const edges = scene.items.filter((i): i is SceneEdge => i.kind === 'edge');
  const near = (p: { x: number; y: number }, b: SceneBox): boolean =>
    p.x >= b.x - 1 && p.x <= b.x + b.w + 1 && p.y >= b.y - 1 && p.y <= b.y + b.h + 1 &&
    (Math.abs(p.x - b.x) < 1.5 || Math.abs(p.x - b.x - b.w) < 1.5 || Math.abs(p.y - b.y) < 1.5 || Math.abs(p.y - b.y - b.h) < 1.5);
  const ast = parse(code, 'cloud-architecture').ast;
  assert.equal(ast.type, 'cloud-architecture');
  const ends: Record<string, [string, string]> = {};
  if (ast.type === 'cloud-architecture') for (const e of ast.edges) ends[e.id] = [e.from, e.to];
  assert.equal(edges.length, 4);
  for (const e of edges) {
    const [from, to] = ends[e.id]!;
    assert.ok(near(e.points[0]!, box(from)), `${from}>${to} starts on ${from}`);
    assert.ok(near(e.points[e.points.length - 1]!, box(to)), `${from}>${to} ends on ${to}`);
  }
  const inner = box('Inner');
  const ab = edges.find((e) => ends[e.id]![0] === 'A' && ends[e.id]![1] === 'B')!;
  for (const p of ab.points) assert.ok(p.x >= inner.x && p.x <= inner.x + inner.w && p.y >= inner.y && p.y <= inner.y + inner.h);
});

test('bad input still renders a partial diagram', async () => {
  const r = await renderDiagram('A > B\nGroup {\n  C [shape: nope, color: notacolor]\n', { type: 'flowchart' });
  assert.ok(r.diagnostics.length > 0);
  assert.ok(r.svg.startsWith('<svg'));
  assert.ok(r.scene.items.some((i) => i.kind === 'box' && i.id === 'C'));
});

test('empty code renders an empty SVG', async () => {
  for (const type of ['cloud-architecture', 'flowchart', 'sequence', 'erd'] as const) {
    const r = await renderDiagram('', { type });
    assert.ok(r.svg.startsWith('<svg'));
  }
});

test('unknown icons get the placeholder glyph, vendor names map to generic glyphs', async () => {
  const { glyphFor } = await import('../../shared/render/index.ts');
  assert.equal(glyphFor('aws-rds'), 'database');
  assert.equal(glyphFor('aws-ec2'), 'server');
  assert.equal(glyphFor('gcp-pubsub'), 'queue');
  assert.equal(glyphFor('zzz-unknown'), 'placeholder');
});

test('Object.prototype key names as colour or icon fall back to defaults', async () => {
  const { glyphFor } = await import('../../shared/render/index.ts');
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await renderDiagram(`A [color: ${k}, icon: ${k}] > B`, { type: 'flowchart' });
    assert.ok(r.svg.startsWith('<svg'), k);
    assert.ok(!r.svg.includes('function'), k);
    assert.equal(glyphFor(k), 'placeholder', k);
  }
});

test('edge ends touch the outline of diamonds and ellipses, not the bounding box', async () => {
  const code = ['Start [shape: oval]', 'Check [shape: diamond]', 'Pool [shape: ellipse]', 'Done', 'Start > Check', 'Check > Pool', 'Check > Done: no', 'Pool > Done'].join('\n');
  for (const connector of ['elbow', 'straight']) {
    const { scene } = await renderDiagram(`direction down\nconnector-style ${connector}\n${code}`, { type: 'flowchart' });
    const box = (id: string) => scene.items.find((i): i is SceneBox => i.kind === 'box' && i.id === id)!;
    const edges = scene.items.filter((i): i is SceneEdge => i.kind === 'edge');
    assert.ok(edges.length >= 3);
    const onOutline = (p: { x: number; y: number }, b: SceneBox): boolean => {
      const u = (p.x - b.x - b.w / 2) / (b.w / 2);
      const v = (p.y - b.y - b.h / 2) / (b.h / 2);
      const k = b.shape === 'diamond' ? Math.abs(u) + Math.abs(v) : b.shape === 'ellipse' ? Math.hypot(u, v) : Math.max(Math.abs(u), Math.abs(v));
      return Math.abs(k - 1) < 0.03;
    };
    let curved = 0;
    for (const id of ['Check', 'Pool']) {
      const b = box(id);
      for (const e of edges) {
        const first = e.points[0]!;
        const last = e.points[e.points.length - 1]!;
        // An end that is within the node's bounding box is an end on this node.
        const inBox = (p: { x: number; y: number }) => p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2;
        for (const p of [first, last]) if (inBox(p)) { curved++; assert.ok(onOutline(p, b), `${connector}: edge end (${p.x},${p.y}) is on ${id}'s outline`); }
      }
    }
    assert.ok(curved >= 4, `${connector}: found ${curved} ends on curved shapes`);
  }
});

test('typeface rough embeds the bundled Shantell Sans and nothing external', async () => {
  const rough = await renderDiagram('typeface rough\nA > B', { type: 'flowchart' });
  assert.match(rough.svg, /<style>@font-face\{font-family:'Shantell Sans'[^}]*src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/);
  assert.match(rough.svg, /font-family="&#39;Shantell Sans&#39;/);
  assert.doesNotMatch(rough.svg, /https?:\/\/(?!www\.w3\.org)/);
  assert.ok(rough.svg.length < 60_000, `rough svg is ${rough.svg.length} bytes`);
  // Only the 400 face is bundled; declaring 400 alone lets the browser synthesise bold instead of drawing it light.
  assert.match(rough.svg, /font-family:'Shantell Sans';font-weight:400;src:/);

  const clean = await renderDiagram('typeface clean\nA > B', { type: 'flowchart' });
  assert.doesNotMatch(clean.svg, /@font-face|Shantell/);
});

test('the embedded rough font is the bundled OFL file', async () => {
  const { SHANTELL_SANS_WOFF2_BASE64 } = await import('../../shared/render/font-rough.ts');
  const dir = new URL('../../shared/render/fonts/', import.meta.url);
  const bytes = readFileSync(fileURLToPath(new URL('shantell-sans-latin-400.woff2', dir)));
  assert.equal(SHANTELL_SANS_WOFF2_BASE64, bytes.toString('base64'));
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.ok(bytes.length < 40_000);
  const license = readFileSync(fileURLToPath(new URL('shantell-sans-OFL.txt', dir)), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/i);
});
