// E40: architecture nodes with an icon draw as box cards by default, with an optional `subtitle:` line
// (docs/research/eraser/09-examples-style.md §2.1 and the 2026-11-13 decisions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { layoutDiagram, sceneToSvg } from '../../shared/render/index.ts';
import type { Scene, SceneBox, SceneIcon, SceneText } from '../../shared/render/scene.ts';

async function scene(code: string, type: 'cloud-architecture' | 'flowchart' = 'cloud-architecture'): Promise<Scene> {
  const { ast, diagnostics } = parse(code, type);
  assert.deepEqual(diagnostics, []);
  return layoutDiagram(ast);
}
const box = (s: Scene, id: string) => s.items.find((i): i is SceneBox => i.kind === 'box' && i.id === id);
const icon = (s: Scene, name: string) => s.items.find((i): i is SceneIcon => i.kind === 'icon' && i.name === name)!;
const text = (s: Scene, line: string) => s.items.find((i): i is SceneText => i.kind === 'text' && i.lines.includes(line))!;

test('box card: an architecture node with an icon is a box with a 20px icon 20px in from the left', async () => {
  const s = await scene('Web [icon: react]');
  const b = box(s, 'Web');
  assert.ok(b, 'draws a box');
  assert.equal(b.shadow, true, 'shadow by default');
  const ic = icon(s, 'react');
  assert.equal(ic.size, 20);
  assert.equal(ic.x, b.x + 20);
  assert.equal(ic.y + ic.size / 2, b.y + b.h / 2, 'icon centred vertically');
  const t = text(s, 'Web');
  assert.equal(t.anchor, 'middle');
  assert.ok(t.x > ic.x + ic.size && t.x < b.x + b.w, 'title sits in the room right of the icon');
  assert.equal(b.h, 52);
});

test('box card: subtitle is a smaller muted second line under the title, height 56', async () => {
  const s = await scene('Web [icon: react, subtitle: React SPA]');
  const b = box(s, 'Web')!;
  const title = text(s, 'Web');
  const sub = text(s, 'React SPA');
  assert.equal(sub.tone, 'muted');
  assert.ok(sub.size < title.size);
  assert.equal(sub.x, title.x);
  assert.ok(sub.y >= title.y + title.lines.length * title.lineHeight, 'below the title');
  assert.equal(b.h, 56);
  const top = title.y;
  const bottom = sub.y + sub.lines.length * sub.lineHeight;
  assert.ok(Math.abs((top + bottom) / 2 - (b.y + b.h / 2)) < 0.5, 'the two lines are centred together');
});

test('box card: a long subtitle wraps or moves the node up a width bucket, never past the box', async () => {
  const s = await scene('API [icon: server, subtitle: Node.js REST API running on ECS Fargate behind a load balancer]');
  const b = box(s, 'API')!;
  const sub = s.items.find((i): i is SceneText => i.kind === 'text' && i.tone === 'muted')!;
  assert.ok(sub.lines.length >= 2);
  assert.ok(sub.y + sub.lines.length * sub.lineHeight <= b.y + b.h);
});

test('box card: subtitle on a bold fill takes the contrast colour', async () => {
  const s = await scene('Hot [icon: zap, color: red, colorMode: bold, subtitle: on fire]');
  assert.equal(text(s, 'on fire').on?.mode, 'bold');
  const svg = sceneToSvg(s);
  assert.match(svg, /fill="#ffffff"[^>]*><tspan[^>]*>on fire</i);
});

test('nodeStyle icon: the old big icon with the label (and subtitle) underneath, no box', async () => {
  const s = await scene(['nodeStyle icon', 'Web [icon: react, subtitle: React SPA]'].join('\n'));
  assert.equal(box(s, 'Web'), undefined);
  const ic = icon(s, 'react');
  assert.equal(ic.size, 39);
  const title = text(s, 'Web');
  const sub = text(s, 'React SPA');
  assert.ok(title.y >= ic.y + ic.size);
  assert.ok(sub.y >= title.y + title.lineHeight);
  assert.equal(sub.tone, 'muted');
});

test('box card: an explicit shape keeps the centred icon + text layout; nodes without icon are unchanged', async () => {
  const s = await scene(['A [icon: database, shape: cylinder]', 'B'].join('\n'));
  const a = box(s, 'A')!;
  assert.equal(a.shape, 'cylinder');
  assert.ok(icon(s, 'database').x > a.x + 20, 'icon not pinned to the left edge');
  assert.equal(text(s, 'B').anchor, 'middle');
});

test('subtitle: flowchart boxes and other shapes draw it too', async () => {
  const s = await scene(['A [subtitle: first step]', 'B [shape: diamond, subtitle: check]', 'A > B'].join('\n'), 'flowchart');
  for (const [id, line] of [['A', 'first step'], ['B', 'check']] as const) {
    const b = box(s, id)!;
    const t = text(s, line);
    assert.equal(t.tone, 'muted');
    assert.ok(t.y > b.y && t.y + t.lineHeight <= b.y + b.h, `${id} subtitle inside the shape`);
  }
});

test('subtitle: at least 4.5:1 on every pastel node fill, light and dark', async () => {
  const { NAMED_COLOR_NAMES, resolvePaint } = await import('../../shared/render/theme.ts');
  const lum = (hex: string) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const theme of ['light', 'dark'] as const) {
    for (const color of [undefined, ...NAMED_COLOR_NAMES]) {
      const s = await scene(`N [icon: server, subtitle: sub${color ? `, color: ${color}` : ''}]`);
      const svg = sceneToSvg(s, { theme });
      const fill = /<tspan[^>]*>sub<\/tspan>/.test(svg) ? /fill="(#[0-9a-f]{6})"[^>]*><tspan[^>]*>sub</i.exec(svg)![1]! : '';
      const bg = resolvePaint({ color, mode: 'pastel' }, theme).fill;
      assert.ok(ratio(fill, bg) >= 4.5, `${theme} ${color ?? 'neutral'}: ${ratio(fill, bg).toFixed(2)}`);
    }
  }
});

test('box card: icon stays 20px and inset 20px at every textSize', async () => {
  for (const size of ['small', 'medium', 'large']) {
    const s = await scene(`textSize ${size}\nWeb [icon: react]`);
    const b = box(s, 'Web')!;
    const ic = icon(s, 'react');
    assert.equal(ic.size, 20, `icon size at ${size}`);
    assert.equal(ic.x, b.x + 20, `icon inset at ${size}`);
    assert.equal(ic.y + ic.size / 2, b.y + b.h / 2, `icon centred at ${size}`);
  }
});

test('box card: card size per textSize (52 minimum, subtitle cards grow with the text, never shrink)', async () => {
  const plain: number[] = [];
  const withSub: number[] = [];
  for (const size of ['small', 'medium', 'large']) {
    plain.push(box(await scene(`textSize ${size}\nWeb [icon: react]`), 'Web')!.h);
    withSub.push(box(await scene(`textSize ${size}\nWeb [icon: react, subtitle: React SPA]`), 'Web')!.h);
  }
  assert.deepEqual(plain, [52, 52, 52]);
  assert.equal(withSub[0], 56);
  assert.ok(withSub[1]! >= withSub[0]! && withSub[2]! > withSub[0]!, `subtitle heights ${withSub}`);
});

test('box card: cards with and without a subtitle in one group share the tallest height, title stays centred', async () => {
  const s = await scene('Stack {\n  One [icon: react, subtitle: React SPA]\n  Two [icon: server]\n}');
  const one = box(s, 'One')!;
  const two = box(s, 'Two')!;
  assert.equal(one.h, 56);
  assert.equal(two.h, 56);
  const t = text(s, 'Two');
  assert.ok(Math.abs(t.y + (t.lines.length * t.lineHeight) / 2 - (two.y + two.h / 2)) < 0.5, 'one-line title centred');
  const ic = icon(s, 'server');
  assert.equal(ic.y + ic.size / 2, two.y + two.h / 2);
});
