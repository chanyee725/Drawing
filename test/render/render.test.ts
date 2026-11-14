import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { parse } from '../../shared/dsl/index.ts';
import { renderDiagram, sceneToSvg } from '../../shared/render/index.ts';
import type { SceneBox, SceneEdge } from '../../shared/render/index.ts';
import { fixture } from '../dsl/helpers.ts';
import { FONT_FAMILY } from '../../shared/render/text.ts';

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

/**
 * Fixed pure-JS workload (objects, Map, sort; about 13 ms), timed right before each layout in the same
 * process. Other sessions and parallel test files slow both by about the same factor, so the ratio of
 * the two minimums stays put under load while a real slowdown of the layout still moves it.
 */
function reference(): number {
  let sum = 0;
  for (let r = 0; r < 12; r++) {
    const m = new Map<string, { id: string; x: number; y: number[] }>();
    const a: { id: string; x: number; y: number[] }[] = [];
    for (let i = 0; i < 4000; i++) {
      const o = { id: `n${(i * 7919) % 4000}`, x: (i * 31) % 997, y: [i, i + 1] };
      a.push(o);
      m.set(o.id, o);
    }
    a.sort((p, q) => p.x - q.x || p.y[0]! - q.y[0]!);
    for (const o of a) sum += m.get(o.id)!.y[1]! & 7;
  }
  return sum;
}

// Layout of the diagram below is about 8.5x the reference (E37, Nov 2026). The reference takes about 13 ms,
// so 12x is about the 150 ms budget (12 x 12.5 ms) and catches a ~1.4x slowdown.
const MAX_RATIO = 12;

test(`performance: 100-node architecture diagram lays out in under ${MAX_RATIO}x a fixed reference workload`, async () => {
  const lines: string[] = [];
  for (let g = 0; g < 5; g++) {
    lines.push(`G${g} [icon: aws] {`);
    for (let i = 0; i < 20; i++) lines.push(`  N${g}_${i} [icon: server]`);
    lines.push('}');
  }
  for (let g = 0; g < 5; g++) for (let i = 0; i < 19; i++) lines.push(`N${g}_${i} > N${(g + (i % 3 === 0 ? 1 : 0)) % 5}_${i + 1}: e${i}`);
  const code = lines.join('\n');
  for (let i = 0; i < 3; i++) {
    await renderDiagram(code); // warm-up (JIT)
    reference();
  }
  let lay = Infinity;
  let ref = Infinity;
  // A load spike can hit only one side of a pair and skew the ratio of the minimums. Keep sampling (up to
  // 25 rounds) until the ratio passes; a real slowdown keeps every round above the limit and still fails.
  for (let i = 0; i < 25 && (i < 7 || lay / ref >= MAX_RATIO); i++) {
    let t0 = performance.now();
    reference();
    ref = Math.min(ref, performance.now() - t0);
    t0 = performance.now();
    const r = await renderDiagram(code);
    lay = Math.min(lay, performance.now() - t0);
    assert.equal(r.scene.items.filter((it) => it.kind === 'icon').length, 105);
  }
  const ratio = lay / ref;
  assert.ok(ratio < MAX_RATIO, `layout ${lay.toFixed(1)} ms = ${ratio.toFixed(1)}x reference ${ref.toFixed(1)} ms`);
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
  assert.doesNotMatch(clean.svg, /Shantell/);
});

test('clean text embeds the bundled Drawing Sans, the 600 face only when used (E59)', async () => {
  // A picture drawn as an <img> (canvas block, document preview, export) sees no page fonts: without the embedded
  // face the label falls back to whatever the system has, wider than text.ts measures.
  const face = (w: number) => new RegExp(`@font-face\\{font-family:'Drawing Sans';font-weight:${w};src:url\\(data:font/woff2;base64,[A-Za-z0-9+/=]+\\) format\\('woff2'\\)\\}`);
  const plain = await renderDiagram('A > B: 확인 ok', { type: 'flowchart' });
  assert.match(plain.svg, face(400));
  assert.doesNotMatch(plain.svg, face(600));
  assert.match(plain.svg, /<svg [^>]*font-family="&#39;Drawing Sans&#39;, /);
  assert.doesNotMatch(plain.svg, /https?:\/\/(?!www\.w3\.org)/);
  assert.ok(plain.svg.length < 30_000, `plain svg is ${plain.svg.length} bytes`);

  const bold = await renderDiagram('title Orders\nA > B', { type: 'flowchart' });
  assert.match(bold.svg, / font-weight="600"/);
  assert.match(bold.svg, face(400));
  assert.match(bold.svg, face(600));

  // Mono and rough text name their own family, so they do not pull the clean face in.
  const mono = await renderDiagram('typeface mono\nA > B', { type: 'flowchart' });
  assert.doesNotMatch(mono.svg, /@font-face/);
  const rough = await renderDiagram('typeface rough\nA > B', { type: 'flowchart' });
  assert.doesNotMatch(rough.svg, /Drawing Sans';font-weight/);
});

/** The name records (English, Windows platform) inside a WOFF2 file, by name ID. */
function woff2Names(bytes: Buffer): Map<number, string> {
  const numTables = bytes.readUInt16BE(12);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = bytes[p++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
  const tables: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[p++];
    let tag = KNOWN[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) {
      tag = bytes.subarray(p, p + 4).toString('latin1');
      p += 4;
    }
    let length = base128();
    const version = flags >> 6;
    if ((tag === 'glyf' || tag === 'loca') ? version === 0 : version !== 0) length = base128();
    tables.push({ tag, length });
  }
  const data = brotliDecompressSync(bytes.subarray(p, p + bytes.readUInt32BE(20)));
  let at = 0;
  for (const t of tables) {
    if (t.tag === 'name') break;
    at += t.length;
  }
  const count = data.readUInt16BE(at + 2);
  const strings = at + data.readUInt16BE(at + 4);
  const out = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = at + 6 + i * 12;
    if (data.readUInt16BE(r) !== 3 || data.readUInt16BE(r + 4) !== 0x409) continue;
    const len = data.readUInt16BE(r + 8);
    const off = strings + data.readUInt16BE(r + 10);
    out.set(data.readUInt16BE(r + 6), Buffer.from(data.subarray(off, off + len)).swap16().toString('utf16le'));
  }
  return out;
}

test('the embedded clean font is the bundled OFL subset under its own name', async () => {
  const fonts = await import('../../shared/render/font-clean.ts');
  const dir = new URL('../../shared/render/fonts/', import.meta.url);
  for (const [weight, base64] of [[400, fonts.DRAWING_SANS_400_WOFF2_BASE64], [600, fonts.DRAWING_SANS_600_WOFF2_BASE64]] as const) {
    const bytes = readFileSync(fileURLToPath(new URL(`drawing-sans-latin-${weight}.woff2`, dir)));
    assert.equal(base64, bytes.toString('base64'));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2');
    assert.ok(bytes.length < 20_000, `${weight} is ${bytes.length} bytes`);
    // The family the file itself declares, not only the CSS name, must avoid the reserved name; the copyright and
    // license records stay so an exported SVG carries the notice.
    const names = woff2Names(bytes);
    assert.equal(names.get(1), 'Drawing Sans');
    assert.equal(names.get(6), `DrawingSans-${weight === 400 ? 'Regular' : 'SemiBold'}`);
    for (const id of [1, 4, 6]) assert.doesNotMatch(names.get(id) ?? '', /Pretendard/, `name ${id}`);
    assert.match(names.get(0) ?? '', /^Copyright/);
    assert.match(names.get(13) ?? '', /SIL Open Font License, Version 1\.1/);
    assert.match(names.get(14) ?? '', /scripts\.sil\.org\/OFL/);
  }
  const license = readFileSync(fileURLToPath(new URL('drawing-sans-OFL.txt', dir)), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  // "Pretendard" is a reserved font name: the subset must not be offered under it.
  assert.match(license, /Reserved Font Name Pretendard/);
  assert.doesNotMatch(FONT_FAMILY.clean.split(',')[0], /Pretendard/);
  // The page's Pretendard webfont must not reach an inline diagram SVG, or it differs from the canvas image.
  for (const family of Object.values(FONT_FAMILY)) assert.doesNotMatch(family, /Pretendard/);
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

test('the diagram title follows the global typeface', async () => {
  const titleFont = async (code: string) => {
    const { scene } = await renderDiagram(code, { type: 'flowchart' });
    const t = scene.items.find((it) => it.kind === 'text' && it.lines[0] === 'My title');
    assert.ok(t && t.kind === 'text');
    return t.font;
  };
  assert.equal(await titleFont('title My title\nA > B'), 'clean');
  assert.equal(await titleFont('typeface rough\ntitle My title\nA > B'), 'rough');
  assert.equal(await titleFont('typeface mono\ntitle My title\nA > B'), 'mono');
});

test('the legend follows the global typeface like the title', async () => {
  const code = 'typeface mono\nA > B\nlegend { [color: red, label: Error] }';
  const { svg } = await renderDiagram(code, { type: 'flowchart' });
  const legendText = /<text[^>]*font-family="([^"]*)"[^>]*>(?:(?!<\/text>).)*Error/.exec(svg);
  assert.ok(legendText, 'legend label is drawn');
  assert.match(legendText![1]!, /mono|Mono/i);
});

test('an icon name equal to any glyph name picks that glyph', async () => {
  const { glyphFor } = await import('../../shared/render/index.ts');
  for (const g of ['user', 'queue', 'balancer', 'bucket', 'placeholder', 'search'] as const) assert.equal(glyphFor(g), g);
  assert.equal(glyphFor('  Queue '), 'queue');
});

test('sequence: message labels sit on their line and cut it; no bold text (E60)', async () => {
  const { scene } = await renderDiagram(fixture('sequence-login'));
  const texts = scene.items.filter((it) => it.kind === 'text');
  assert.ok(texts.every((tx) => tx.weight === 400 || tx.lines.join('') === 'Login'), 'only the diagram title may be bold');
  const label = texts.find((tx) => tx.lines.join('') === '2. find user');
  assert.ok(label?.plate, 'message label is a plate label');
  const line = scene.items.find((it): it is SceneEdge => it.kind === 'edge' && it.route === 'straight' && Math.abs(it.points[0]!.y - (label!.y + label!.lineHeight / 2)) < 0.5);
  assert.ok(line, 'a message line runs through the label centre');
  assert.ok(label!.x > Math.min(line!.points[0]!.x, line!.points[1]!.x) && label!.x < Math.max(line!.points[0]!.x, line!.points[1]!.x));
});

test('sequence dark: flat background-filled participant boxes without a shadow, bright message labels; light unchanged (E62)', async () => {
  const { scene } = await renderDiagram(fixture('sequence-login'));
  const heads = (svg: string): string[] => svg.match(/<g data-role="column"[^>]*>.*?<\/g>/g) ?? [];
  const dark = sceneToSvg(scene, { theme: 'dark' });
  const light = sceneToSvg(scene, { theme: 'light' });
  assert.ok(heads(dark).length > 0);
  for (const g of heads(dark)) {
    assert.equal((g.match(/<(rect|path|ellipse|polygon)/g) ?? []).length, 1, 'one shape: no offset shadow copy');
    assert.match(g, /fill="#17191d" stroke="#cfcecc"/);
  }
  for (const g of heads(light)) {
    assert.equal((g.match(/<rect/g) ?? []).length, 2, 'light keeps the offset shadow');
    assert.match(g, /fill="#e8e8e8" stroke="none"/);
  }
  const labelFill = (svg: string): string | undefined => svg.match(/<text[^>]*fill="([^"]+)"[^>]*>(?:(?!<\/text>).)*2\. find user/)?.[1];
  assert.equal(labelFill(dark), '#e7e9ec');
  assert.equal(labelFill(light), '#667085');
  // A coloured participant keeps its colour; only the shadow goes.
  const tinted = await renderDiagram('A [color: blue]\nB\nA > B: hi', { type: 'sequence', theme: 'dark' });
  const all = heads(tinted.svg);
  assert.equal(all.length, 4);
  assert.ok(all.every((g) => (g.match(/<rect/g) ?? []).length === 1));
  assert.equal(all.filter((g) => /stroke="#53b1fd"/.test(g) && !/#cfcecc/.test(g)).length, 2);
  assert.equal(all.filter((g) => /fill="#17191d" stroke="#cfcecc"/.test(g)).length, 2);
});

test('erd: table titles, key fields and badges are weight 400 (E60)', async () => {
  const { scene } = await renderDiagram(fixture('erd-billing'));
  const texts = scene.items.filter((it) => it.kind === 'text' && it.lines.join('') !== 'Billing');
  assert.ok(texts.length > 0);
  assert.ok(texts.every((tx) => tx.kind === 'text' && tx.weight === 400));
});

test('sequence: solid lifelines with a participant head at both ends (E60)', async () => {
  const src = fixture('sequence-login');
  const { scene } = await renderDiagram(src);
  const { ast } = parse(src);
  const columns = ast.type === 'sequence' ? ast.columns.length : 0;
  assert.ok(columns > 0);
  const heads = scene.items.filter((it): it is SceneBox => it.kind === 'box' && it.role === 'column');
  assert.equal(heads.length, columns * 2);
  assert.equal(heads.filter((h) => h.id !== undefined).length, columns, 'only the top head carries the participant id');
  const lifelines = scene.items.filter((it) => it.kind === 'line' && it.points.length === 2 && it.points[0]!.x === it.points[1]!.x);
  assert.equal(lifelines.length, columns);
  for (const l of lifelines) {
    if (l.kind !== 'line') continue;
    assert.equal(l.dashed, false);
    const [a, b] = l.points as [{ x: number; y: number }, { x: number; y: number }];
    const mine = heads.filter((h) => Math.abs(h.x + h.w / 2 - a.x) < 0.01).sort((p, q) => p.y - q.y);
    assert.equal(mine.length, 2);
    assert.ok(Math.abs(mine[0]!.y + mine[0]!.h - a.y) < 0.01, 'the line starts under the top head');
    assert.ok(Math.abs(mine[1]!.y - b.y) < 0.01, 'the line ends on the bottom head');
    assert.deepEqual([mine[0]!.w, mine[0]!.h], [mine[1]!.w, mine[1]!.h]);
  }
});

test('erd: row rules, mono types, lowercase keys on the right, icon right of the title (E60)', async () => {
  const { scene, svg } = await renderDiagram(fixture('erd-billing'));
  const box = (id: string) => scene.items.find((it): it is SceneBox => it.kind === 'box' && it.role === 'entity' && it.id === id)!;
  const users = box('users');
  const inside = <T extends { x: number; y: number }>(p: T) => p.x >= users.x && p.x <= users.x + users.w && p.y >= users.y && p.y <= users.y + users.h;
  const rules = scene.items.filter((it) => it.kind === 'line' && !it.dashed && it.points[0]!.y === it.points[1]!.y && inside(it.points[0]!));
  assert.equal(rules.length, 2, 'three rows, two rules between them');
  const texts = scene.items.filter((it) => it.kind === 'text' && inside(it));
  const find = (s: string) => texts.find((tx) => tx.kind === 'text' && tx.lines.join('') === s);
  const [name, type, pk, title] = [find('id'), find('string'), find('pk'), find('users')];
  assert.ok(name?.kind === 'text' && type?.kind === 'text' && pk?.kind === 'text' && title?.kind === 'text');
  assert.equal(type.font, 'mono');
  assert.equal(pk.font, 'mono');
  assert.equal(name.font, 'clean');
  assert.deepEqual([pk.anchor, pk.on?.color], ['end', 'orange']);
  assert.ok(name.x < type.x && type.x < pk.x, 'name, then type, then the key at the right end');
  assert.equal(scene.items.some((it) => it.kind === 'text' && /^(PK|FK)$/.test(it.lines.join(''))), false);
  const icon = scene.items.find((it) => it.kind === 'icon' && inside(it));
  assert.ok(icon?.kind === 'icon' && icon.x > title.x && icon.x + icon.size <= users.x + users.w);
  // Mono text names its stack and is scaled to the measured 0.6em advance; no mono face is embedded.
  assert.match(svg, /font-family="&#39;JetBrains Mono&#39;[^"]*" style="font-size-adjust:ch-width 0.6"/);
  assert.doesNotMatch(svg, /@font-face\{font-family:'JetBrains Mono'/);
});

test('erd: Chen cardinality writes "many" as * (E60)', async () => {
  const { scene } = await renderDiagram('notation chen\na { id int pk }\nb { id int pk\n aId int fk }\nc { id int }\na.id < b.aId\nb.id <> c.id', { type: 'erd' });
  const marks = scene.items.flatMap((it) => (it.kind === 'text' && /^[1*MN]$/.test(it.lines.join('')) ? [it.lines.join('')] : []));
  assert.deepEqual([...marks].sort(), ['*', '*', '*', '1']);
  const fk = scene.items.find((it) => it.kind === 'text' && it.lines.join('') === 'fk');
  assert.ok(fk?.kind === 'text' && fk.tone === 'muted' && fk.anchor === 'end');
});

test('arrows, dashes and math signs are measured near their real width in the clean face', async () => {
  const { textWidth } = await import('../../shared/render/text.ts');
  // Drawing Sans advance widths in em (hmtx of the bundled subset).
  for (const [ch, em] of [['→', 0.913], ['—', 0.957], ['…', 0.762], ['+', 0.627], ['=', 0.627], ['&', 0.609]] as const) {
    const w = textWidth(ch, 100, 'clean');
    assert.ok(w >= em * 100 * 0.95 && w <= em * 100 * 1.05, `${ch} measured ${w}, real ${em * 100}`);
  }
});

test('every diagram type asks for true glyph advances, so text drawn small has no gaps inside words (E63)', async () => {
  for (const name of FIXTURES) {
    const { svg, scene } = await renderDiagram(fixture(name));
    assert.match(svg.slice(0, svg.indexOf('>')), /\stext-rendering="geometricPrecision"/, name);
    const dark = sceneToSvg(scene, { theme: 'dark' });
    assert.match(dark.slice(0, dark.indexOf('>')), /\stext-rendering="geometricPrecision"/, `${name} dark`);
  }
});

test('sequence: a message label cuts the lifelines it crosses; self labels stay short of the next lifeline (E60 follow-up)', async () => {
  const { PLATE_PAD } = await import('../../shared/render/text.ts');
  const { scene, svg } = await renderDiagram('A\nB\nC\nA > C: a long message label that crosses the lifeline of B\nB > B: a long self note next to the lifeline of C', { type: 'sequence' });
  const lifelines = scene.items.filter((it) => it.kind === 'line' && it.points[0]!.x === it.points[1]!.x);
  assert.equal(lifelines.length, 3);
  assert.ok(lifelines.every((l) => l.kind === 'line' && l.cut === true), 'every lifeline takes the label cut');
  const mask = /<mask id="([^"]+)"/.exec(svg)?.[1];
  assert.ok(mask);
  assert.equal(svg.split(`<polyline points=`).filter((s) => s.startsWith(`"`) && new RegExp(`^"[^"]*" mask="url\\(#${mask}\\)"`).test(s)).length, 3);
  // B's lifeline runs under the A > C label, a plate centred between A and C.
  const { textWidth } = await import('../../shared/render/text.ts');
  const label = scene.items.find((it) => it.kind === 'text' && it.lines.join('') === 'a long message label that crosses the lifeline of B');
  const bx = lifelines[1]!.kind === 'line' ? lifelines[1]!.points[0]!.x : NaN;
  assert.ok(label?.kind === 'text' && label.plate);
  assert.ok(Math.abs(label.x - bx) < textWidth(label.lines[0]!, label.size, label.font) / 2, 'the label spans B');
  // The self-message label is plain text (no plate, no cut): the gap after B keeps it short of C's lifeline, and it
  // starts 8px right of the loop.
  const self = scene.items.find((it) => it.kind === 'text' && it.lines.join('').startsWith('a long self note'));
  const loop = scene.items.find((it): it is SceneEdge => it.kind === 'edge' && it.route === 'elbow');
  assert.ok(self?.kind === 'text' && !self.plate && self.anchor === 'start' && loop);
  const loopRight = Math.max(...loop.points.map((p) => p.x));
  assert.equal(self.x - loopRight, 8);
  const cx = lifelines[2]!.kind === 'line' ? lifelines[2]!.points[0]!.x : NaN;
  assert.ok(self.x + textWidth(self.lines[0]!, self.size, self.font) + PLATE_PAD < cx, 'the self label ends before C');
});

test('mono: Hangul is measured at 1em and drawn without the ch-width scaling (E60 follow-up)', async () => {
  const { textWidth } = await import('../../shared/render/text.ts');
  assert.equal(textWidth('문자열', 12, 'mono'), 36);
  assert.equal(textWidth('varchar(이름)', 12, 'mono'), (9 * 0.6 + 2) * 12);
  // Korean families come after `monospace`, so they only ever supply the Hangul.
  assert.match(FONT_FAMILY.mono, /monospace, 'Noto Sans KR'/);
  const { svg } = await renderDiagram('users {\n  id 문자열 pk\n  name varchar(이름)\n  email string\n}', { type: 'erd' });
  assert.match(svg, /<tspan x="[^"]+" y="[^"]+"><tspan style="font-size-adjust:none">문자열<\/tspan><\/tspan>/);
  assert.match(svg, />varchar\(<tspan style="font-size-adjust:none">이름<\/tspan>\)<\/tspan>/);
  assert.match(svg, /<tspan x="[^"]+" y="[^"]+">string<\/tspan>/, 'Latin mono text keeps the plain span');
  // A ZWJ emoji stays one run, so it draws as one glyph.
  const zwj = await renderDiagram('t {\n  note 👨\u200d💻 x\n}', { type: 'erd' });
  assert.match(zwj.svg, /<tspan style="font-size-adjust:none">👨\u200d💻<\/tspan>/);
  // A joiner after narrow text is not pulled into a wide run.
  assert.doesNotMatch(zwj.svg, /font-size-adjust:none">\u200d/);
  // Clean text has no nested span: the ch-width scaling is only on mono text.
  const clean = await renderDiagram('A\n한글 > A: 메시지', { type: 'sequence' });
  assert.doesNotMatch(clean.svg, /font-size-adjust:none/);
});
