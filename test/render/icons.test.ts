import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  'container', 'lock', 'globe', 'flag', 'mail', 'file', 'gear', 'chart', 'code', 'bell', 'search', 'shield', 'brain', 'workflow', 'router', 'layers', 'package', 'archive', 'clock', 'placeholder',
];

test('the placeholder is the only glyph drawn from our own artwork', () => {
  assert.deepEqual(Object.keys(GLYPHS), ['placeholder']);
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

test('cloud service names pick a glyph for the service, not the vendor cloud', () => {
  const want: [string, string][] = [
    ['aws-cloudwatch', 'chart-column'],
    ['aws-step-functions', 'workflow'],
    ['aws-nat-gateway', 'router'],
    ['aws-api-gateway', 'network'],
    ['aws-waf', 'shield'],
    ['aws-sagemaker', 'brain'],
    ['aws-ecr', 'package'],
    ['aws-backup', 'archive'],
    ['aws-simple-email-service', 'mail'],
    ['azure-virtual-machines', 'server'],
    ['azure-machine-learning', 'brain'],
    ['azure-active-directory', 'users'],
    ['azure-virtual-networks', 'globe'],
    ['azure-firewalls', 'shield'],
    ['azure-event-hubs', 'columns-3'],
    ['azure-logic-apps', 'workflow'],
    ['azure-resource-groups', 'layers'],
    ['azure-container-registries', 'package'],
    ['azure-monitor', 'chart-column'],
    ['azure-ai-search', 'search'],
    ['gcp-cloud-run', 'box'],
    ['gcp-cloud-scheduler', 'clock'],
    ['gcp-key-management-service', 'lock'],
    ['gcp-vertex-ai', 'brain'],
    ['gcp-cloud-armor', 'shield'],
    // A vendor prefix alone, or with a service we do not know, is still the cloud.
    ['aws', 'cloud'],
    ['azure', 'cloud'],
    ['gcp-something-new', 'cloud'],
  ];
  for (const [name, key] of want) assert.deepEqual([iconFor(name).set, iconFor(name).key], ['lucide', key], name);
  assert.deepEqual([iconFor('azure-databricks').set, iconFor('azure-databricks').key], ['simple-icons', 'databricks']);
  // No vendor artwork: an unknown name with no vendor word keeps the neutral placeholder.
  assert.equal(iconFor('totally-unknown-thing').key, 'placeholder');
});

/** End point of every path command, in absolute coordinates. */
function pathPoints(d: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const NUM = /[\s,]*([+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?)/y;
  const FLAG = /[\s,]*([01])/y;
  const CMD = /[\s,]*([MmLlHhVvCcSsQqTtAaZz])/y;
  let i = 0;
  const read = (re: RegExp): string | undefined => {
    re.lastIndex = i;
    const m = re.exec(d);
    if (!m) return undefined;
    i = re.lastIndex;
    return m[1];
  };
  const num = (): number => {
    const v = read(NUM);
    assert.ok(v !== undefined, `number expected at ${i} in ${d.slice(0, 40)}`);
    return Number(v);
  };
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  while (i < d.trimEnd().length) {
    cmd = read(CMD) ?? (cmd === 'M' ? 'L' : cmd === 'm' ? 'l' : cmd);
    assert.ok(cmd, `command expected in ${d.slice(0, 40)}`);
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toLowerCase();
    if (c === 'z') {
      x = sx;
      y = sy;
      continue;
    }
    if (c === 'h') x = (rel ? x : 0) + num();
    else if (c === 'v') y = (rel ? y : 0) + num();
    else {
      // Skip what comes before the end point: control points, or radii, rotation and the two arc flags.
      for (let k = { c: 4, s: 2, q: 2 }[c] ?? 0; k > 0; k--) num();
      if (c === 'a') {
        num();
        num();
        num();
        assert.ok(read(FLAG) !== undefined && read(FLAG) !== undefined, `arc flags in ${d.slice(0, 40)}`);
      }
      const nx = num();
      const ny = num();
      x = (rel ? x : 0) + nx;
      y = (rel ? y : 0) + ny;
    }
    if (c === 'm') {
      sx = x;
      sy = y;
    }
    out.push({ x, y });
  }
  return out;
}

test('every bundled icon stays inside its 24px box', () => {
  assert.deepEqual(pathPoints('M21 8Z m3.3 7 8.7 5'), [{ x: 21, y: 8 }, { x: 24.3, y: 15 }, { x: 33, y: 20 }], 'the check sees a relative move after Z');
  const all: [string, string][] = [
    ...[...LUCIDE_ICONS].map(([k, d]): [string, string] => [`lucide:${k}`, d]),
    ...[...SIMPLE_ICONS].map(([k, v]): [string, string] => [`simple-icons:${k}`, v.d]),
    ['own:placeholder', GLYPHS.placeholder],
  ];
  assert.ok(all.length > 100);
  for (const [name, d] of all) {
    const pts = pathPoints(d);
    assert.ok(pts.length > 0, name);
    for (const p of pts) assert.ok(p.x >= -0.01 && p.x <= 24.01 && p.y >= -0.01 && p.y <= 24.01, `${name}: point ${p.x},${p.y} is outside the box`);
  }
});

test('a Lucide element that opens with a relative move starts at an absolute point once joined', async () => {
  const { absoluteStart } = await import('../../scripts/build-icons.mjs');
  assert.equal(absoluteStart('m3.3 7 8.7 5 8.7-5'), 'M3.3 7l8.7 5 8.7-5');
  assert.equal(absoluteStart('m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7'), 'M22 7l-8.991 5.727a2 2 0 0 1-2.009 0L2 7');
  assert.equal(absoluteStart('m21 21-4.34-4.34'), 'M21 21l-4.34-4.34');
  assert.equal(absoluteStart('m9 12h6'), 'M9 12h6');
  assert.equal(absoluteStart('M4 4h16'), 'M4 4h16');
  for (const [name, d] of LUCIDE_ICONS) assert.ok(!/(^|\s)m/.test(d), `${name} still has a relative move between elements`);
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
    // The bundled font travels as a data URL (E59); anything else that points somewhere is not allowed.
    assert.ok(!/href|url\((?!data:font\/woff2;base64,)|<image|<use/.test(svg));
    assert.equal(svg.match(/data-icon=/g)?.length, 5);
  }
});
