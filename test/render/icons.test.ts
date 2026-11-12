import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GLYPHS, glyphFor, iconFor } from '../../shared/render/icons.ts';
import type { Glyph } from '../../shared/render/icons.ts';
import { LUCIDE_ICONS, SIMPLE_ICONS } from '../../shared/render/icon-data.ts';
import { renderDiagram, sceneToSvg } from '../../shared/render/index.ts';
import type { Scene } from '../../shared/render/index.ts';

const OWN_GLYPHS = [
  'user', 'users', 'server', 'database', 'monitor', 'phone', 'cloud', 'queue', 'balancer', 'function', 'bucket', 'bolt',
  'container', 'lock', 'globe', 'flag', 'mail', 'file', 'gear', 'chart', 'code', 'bell', 'search', 'placeholder',
];

test('our own 24 glyphs are all still there, unchanged', () => {
  assert.deepEqual(Object.keys(GLYPHS).sort(), [...OWN_GLYPHS].sort());
  // Hash of the set as of develop 1d4e31b, before the Lucide / Simple Icons switch.
  const hash = createHash('sha256').update(JSON.stringify(GLYPHS)).digest('hex');
  assert.equal(hash, 'dd35c71ddd930cca5d4d14fa37f79f0fd0b2ce3e281c9779be098131ef1cdace');
});

test('glyphFor gives the same answer as before for every keyword and sample name', () => {
  const baseline: [string, Glyph][] = JSON.parse(readFileSync(new URL('./glyph-baseline.json', import.meta.url), 'utf8'));
  assert.ok(baseline.length > 200);
  for (const [name, glyph] of baseline) assert.equal(glyphFor(name), glyph, name);
});

test('every own glyph name still draws an icon; only the placeholder stays our own', () => {
  for (const g of OWN_GLYPHS) {
    const icon = iconFor(g);
    if (g === 'placeholder') {
      assert.deepEqual([icon.set, icon.key, icon.d], ['own', 'placeholder', GLYPHS.placeholder]);
    } else {
      assert.equal(icon.set, 'lucide', g);
      assert.ok(icon.d.length > 0 && !icon.fill, g);
    }
  }
});

test('Eraser icon names map to the closest bundled icon', () => {
  const want: [string, string, string][] = [
    ['aws-ec2', 'lucide', 'server'],
    ['aws-rds', 'lucide', 'database'],
    ['aws-elb', 'lucide', 'network'],
    ['aws-sqs', 'lucide', 'columns-3'],
    ['aws-s3', 'lucide', 'hard-drive'],
    ['aws-lambda', 'lucide', 'square-function'],
    ['gcp-cloud-sql', 'lucide', 'database'],
    ['gcp-pubsub', 'lucide', 'columns-3'],
    ['azure-cosmos-db', 'lucide', 'database'],
    ['k8s', 'simple-icons', 'kubernetes'],
    ['kubernetes', 'simple-icons', 'kubernetes'],
    ['postgres', 'simple-icons', 'postgresql'],
    ['PostgreSQL', 'simple-icons', 'postgresql'],
    ['mongo', 'simple-icons', 'mongodb'],
    ['redis', 'simple-icons', 'redis'],
    ['docker', 'simple-icons', 'docker'],
    ['node-js', 'simple-icons', 'nodedotjs'],
    ['github-actions', 'simple-icons', 'githubactions'],
    ['users', 'lucide', 'users'],
    ['monitor', 'lucide', 'monitor'],
    ['key', 'lucide', 'key'],
    ['home', 'lucide', 'house'],
    ['vault', 'lucide', 'lock'],
    ['node', 'lucide', 'server'],
    ['zzz-unknown', 'own', 'placeholder'],
    ['', 'own', 'placeholder'],
  ];
  for (const [name, set, key] of want) {
    const icon = iconFor(name);
    assert.deepEqual([icon.set, icon.key], [set, key], name);
  }
});

test('no cloud vendor logos and no non-CC0 logos are bundled', () => {
  for (const slug of SIMPLE_ICONS.keys()) assert.doesNotMatch(slug, /^(aws|amazon|google|gcp|azure|microsoftazure)/, slug);
  for (const name of ['aws', 'aws-ec2', 'amazon-s3', 'gcp', 'google-cloud', 'azure', 'azure-functions', 'kafka', 'vue', 'rust', 'git']) {
    assert.notEqual(iconFor(name).set, 'simple-icons', name);
  }
});

test('Object.prototype names resolve to the placeholder', () => {
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(iconFor(k).key, 'placeholder', k);
});

test('icon data is path syntax only and matches the generator output', () => {
  const path = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]+$/;
  for (const [k, d] of LUCIDE_ICONS) assert.match(d, path, k);
  for (const [k, v] of SIMPLE_ICONS) {
    assert.match(v.d, path, k);
    assert.match(v.hex, /^#[0-9a-f]{6}$/, k);
  }
  const script = fileURLToPath(new URL('../../scripts/build-icons.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

function iconScene(name: string, color?: string): Scene {
  const paint = color === undefined ? { mode: 'pastel' as const } : { color, mode: 'pastel' as const };
  return { type: 'flowchart', width: 40, height: 40, items: [{ kind: 'icon', name, x: 8, y: 8, size: 24, paint, inside: true }] };
}

test('logos are filled with their brand colour, readable on both themes', () => {
  const pg = SIMPLE_ICONS.get('postgresql')!;
  const light = sceneToSvg(iconScene('postgres'));
  assert.ok(light.includes(`data-icon-set="simple-icons"`));
  assert.ok(light.includes(`fill="${pg.hex}"`), 'brand colour');
  // GitHub's logo is near-black: on the dark theme it switches to the text colour.
  const gh = SIMPLE_ICONS.get('github')!;
  assert.ok(sceneToSvg(iconScene('github')).includes(`fill="${gh.hex}"`));
  const dark = sceneToSvg(iconScene('github'), { theme: 'dark' });
  assert.ok(!dark.includes(`fill="${gh.hex}"`), 'dark logo falls back');
  assert.ok(dark.includes('fill="#e7e9ec"'));
  // An explicit colour wins over the brand colour.
  assert.ok(!sceneToSvg(iconScene('postgres', 'red')).includes(pg.hex));
});

test('outline icons keep the stroke style; the placeholder stays dashed', () => {
  const svg = sceneToSvg(iconScene('aws-ec2'));
  assert.ok(svg.includes('data-icon-set="lucide"') && svg.includes(`d="${LUCIDE_ICONS.get('server')}"`));
  assert.ok(svg.includes('fill="none"') && svg.includes('stroke-linecap="round"'));
  assert.ok(!svg.includes('stroke-dasharray'));
  assert.ok(sceneToSvg(iconScene('zzz')).includes('stroke-dasharray="3 2.5"'));
});

test('rendered diagrams with icons reference nothing outside the SVG', async () => {
  const code = ['Users [icon: users]', 'DB [icon: postgres]', 'K [icon: k8s]', 'W [icon: aws-ec2]', 'X [icon: zzz]', 'Users > W > DB', 'W > K'].join('\n');
  for (const theme of ['light', 'dark'] as const) {
    const { svg } = await renderDiagram(code, { type: 'cloud-architecture', theme });
    assert.equal(svg.match(/https?:/g)?.length, 1, 'only the xmlns URI'); // xmlns="http://www.w3.org/2000/svg"
    assert.ok(!/href|url\(|<image|<use/.test(svg));
    assert.equal(svg.match(/data-icon=/g)?.length, 5);
  }
});
