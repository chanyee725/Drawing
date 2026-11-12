// Generate shared/render/icon-data.ts from the Lucide (ISC) and Simple Icons (CC0-1.0) npm packages.
// Only the icons listed below are copied, so the render bundle stays small.
//
//   node scripts/build-icons.mjs          write the file
//   node scripts/build-icons.mjs --check  exit 1 if the checked-in file is out of date
//
// Rules enforced here (the build fails instead of quietly shipping something we may not use):
// - Simple Icons: only icons with no per-icon licence or CC0-1.0 (some logos carry CC-BY/Apache/...).
// - No AWS / Google Cloud / Azure logos: those names fall back to generic Lucide glyphs.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const OUT = fileURLToPath(new URL('../shared/render/icon-data.ts', import.meta.url));

/** Lucide icons bundled by name. Every glyph target in shared/render/icons.ts must be listed. */
export const LUCIDE = [
  'user', 'users', 'server', 'database', 'monitor', 'smartphone', 'cloud', 'columns-3', 'network',
  'square-function', 'hard-drive', 'zap', 'box', 'lock', 'globe', 'flag', 'mail', 'file-text',
  'settings', 'chart-column', 'code', 'bell', 'search',
  // General names people type directly.
  'key', 'shield', 'cpu', 'router', 'wifi', 'calendar', 'clock', 'credit-card', 'shopping-cart',
  'message-square', 'git-branch', 'terminal', 'workflow', 'package', 'layers', 'link', 'image', 'video',
  'laptop', 'tablet', 'building', 'house', 'map-pin', 'heart', 'star', 'check', 'x',
  'triangle-exclamation-point', 'info', 'activity', 'bot', 'brain', 'sparkles', 'webhook', 'folder',
  'upload', 'download', 'funnel', 'tag', 'truck', 'wallet', 'rocket', 'lightbulb', 'book', 'bug',
  'inbox', 'archive', 'cylinder', 'layout-grid',
];

/** Simple Icons slugs bundled. Kept to common infrastructure and developer tools. */
export const SIMPLE = [
  'postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'sqlite', 'elasticsearch', 'rabbitmq',
  'docker', 'kubernetes', 'helm', 'nginx', 'nodedotjs', 'python', 'go', 'typescript', 'react',
  'svelte', 'nextdotjs', 'graphql', 'github', 'gitlab', 'githubactions', 'terraform', 'ansible',
  'grafana', 'prometheus', 'datadog', 'sentry', 'stripe', 'supabase', 'vercel', 'netlify',
  'cloudflare', 'ubuntu', 'apple', 'spring', 'django', 'flask', 'fastapi', 'rubyonrails',
  'kotlin', 'swift', 'auth0', 'okta', 'vault', 'consul', 'istio', 'envoyproxy',
  'databricks', 'clickhouse', 'neo4j', 'minio', 'digitalocean', 'figma', 'jira',
  'confluence', 'notion', 'postman', 'kibana', 'logstash', 'elastic',
];

const VENDOR_CLOUD = /^(aws|amazon|googlecloud|google|gcp|microsoftazure|azure)/;
const num = (v) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) throw new Error(`bad number ${v}`);
  return n;
};

/** Lucide element → path data. Only the element kinds Lucide uses. */
function elementToPath([tag, a]) {
  switch (tag) {
    case 'path':
      return a.d;
    case 'line':
      return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const p = a.points.trim().split(/[\s,]+/).map(num);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(a.cx);
      const cy = num(a.cy);
      const rx = num(tag === 'circle' ? a.r : a.rx);
      const ry = num(tag === 'circle' ? a.r : a.ry);
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
    }
    case 'rect': {
      const x = num(a.x);
      const y = num(a.y);
      const w = num(a.width);
      const h = num(a.height);
      const rx = Math.min(num(a.rx ?? a.ry), w / 2);
      const ry = Math.min(num(a.ry ?? a.rx), h / 2);
      if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return (
        `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}` +
        `h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
      );
    }
    default:
      throw new Error(`lucide: unsupported element <${tag}>`);
  }
}

export function generate() {
  const lucideNodes = JSON.parse(readFileSync(require.resolve('lucide-static/icon-nodes.json'), 'utf8'));
  const lucideVersion = JSON.parse(readFileSync(require.resolve('lucide-static/package.json'), 'utf8')).version;
  const siDir = `${dirname(require.resolve('simple-icons'))}/`;
  const siVersion = JSON.parse(readFileSync(`${siDir}package.json`, 'utf8')).version;
  const siRaw = JSON.parse(readFileSync(`${siDir}data/simple-icons.json`, 'utf8'));
  const siMeta = new Map((Array.isArray(siRaw) ? siRaw : siRaw.icons).map((i) => [i.slug, i]));
  const siIcons = new Map(Object.values(require('simple-icons')).filter((i) => i && i.slug).map((i) => [i.slug, i]));

  const lucide = LUCIDE.map((name) => {
    const nodes = lucideNodes[name];
    if (!nodes) throw new Error(`lucide: no icon "${name}"`);
    return [name, nodes.map(elementToPath).join(' ')];
  });
  const simple = SIMPLE.map((slug) => {
    if (VENDOR_CLOUD.test(slug)) throw new Error(`simple-icons: "${slug}" is a cloud vendor logo, not allowed`);
    const meta = siMeta.get(slug);
    const icon = siIcons.get(slug);
    if (!meta || !icon) throw new Error(`simple-icons: no icon "${slug}"`);
    if (meta.license && meta.license.type !== 'CC0-1.0') throw new Error(`simple-icons: "${slug}" is ${meta.license.type}, not CC0`);
    return [slug, { title: icon.title, hex: `#${icon.hex.toLowerCase()}`, d: icon.path }];
  });

  // Path data and colours end up inside SVG attributes: allow path syntax only.
  const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]+$/;
  for (const [k, d] of lucide) if (!PATH.test(d)) throw new Error(`lucide: "${k}" has unexpected path data`);
  for (const [k, v] of simple) {
    if (!PATH.test(v.d)) throw new Error(`simple-icons: "${k}" has unexpected path data`);
    if (!/^#[0-9a-f]{6}$/.test(v.hex)) throw new Error(`simple-icons: "${k}" has a bad colour`);
  }

  const q = (s) => JSON.stringify(s);
  return [
    '// GENERATED by scripts/build-icons.mjs. Do not edit by hand; run `npm run icons`.',
    `// Lucide ${lucideVersion} (ISC; some icons MIT from Feather) and Simple Icons ${siVersion} (CC0-1.0).`,
    '// See NOTICE.md. Logos are trademarks of their owners.',
    '',
    '/** Lucide outline icons, 24x24, drawn with stroke. Name → path data. */',
    'export const LUCIDE_ICONS: ReadonlyMap<string, string> = new Map([',
    ...lucide.map(([k, d]) => `  [${q(k)}, ${q(d)}],`),
    ']);',
    '',
    '/** Simple Icons brand logos, 24x24, drawn with fill. Slug → title, brand colour, path data. */',
    'export const SIMPLE_ICONS: ReadonlyMap<string, { title: string; hex: string; d: string }> = new Map([',
    ...simple.map(([k, v]) => `  [${q(k)}, { title: ${q(v.title)}, hex: ${q(v.hex)}, d: ${q(v.d)} }],`),
    ']);',
    '',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = generate();
  if (process.argv.includes('--check')) {
    let cur = '';
    try {
      cur = readFileSync(OUT, 'utf8');
    } catch {}
    if (cur !== out) {
      console.error('shared/render/icon-data.ts is out of date: run `npm run icons`');
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, out);
    console.log(`wrote ${OUT} (${out.length} bytes)`);
  }
}
