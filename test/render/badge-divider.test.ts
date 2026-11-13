// E41 (#115): a badge chip on a node's top-right corner (`badge:`, `badgeColor:`) and a divider line broken by
// its label (`shape: divider`). Spec: docs/research/eraser/09-examples-style.md §2.1, §2.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { layoutDiagram, sceneToSvg } from '../../shared/render/index.ts';
import { BADGE_H, badgeRect } from '../../shared/render/badge.ts';
import { badgeColors } from '../../shared/render/theme.ts';
import type { Scene, SceneBadge, SceneBox, SceneLine, SceneText } from '../../shared/render/scene.ts';

async function scene(code: string, type: 'cloud-architecture' | 'flowchart' = 'cloud-architecture'): Promise<Scene> {
  const { ast, diagnostics } = parse(code, type);
  assert.deepEqual(diagnostics, []);
  return layoutDiagram(ast);
}
const box = (s: Scene, id: string) => s.items.find((i): i is SceneBox => i.kind === 'box' && i.id === id);
const badges = (s: Scene) => s.items.filter((i): i is SceneBadge => i.kind === 'badge');
const lines = (s: Scene) => s.items.filter((i): i is SceneLine => i.kind === 'line');
const text = (s: Scene, line: string) => s.items.find((i): i is SceneText => i.kind === 'text' && i.lines.includes(line));

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('badge: a chip on the node top-right corner, painted over the node', async () => {
  const s = await scene('API [icon: server, badge: v2]');
  const b = box(s, 'API')!;
  const [chip] = badges(s);
  assert.ok(chip, 'draws a badge');
  assert.equal(chip.of, 'API');
  assert.equal(chip.text, 'v2');
  assert.equal(chip.h, BADGE_H);
  assert.equal(chip.y + chip.h / 2, b.y, 'centred on the top edge');
  assert.equal(chip.x + chip.w - chip.h / 2, b.x + b.w, 'right cap centred on the right edge');
  assert.ok(s.items.indexOf(chip) > s.items.indexOf(b), 'paints after the node');
  assert.ok(chip.y >= 0 && chip.x + chip.w <= s.width, 'inside the picture');
  const svg = sceneToSvg(s);
  assert.match(svg, /<g data-badge="API"><rect [^>]*rx="9" fill="#444ce7"\/><text [^>]*fill="#ffffff"[^>]*>v2<\/text><\/g>/);
});

test('badge: a longer text runs left along the top edge; one glyph is a circle on the corner', () => {
  const one = badgeRect(100, 50, 6);
  assert.deepEqual(one, { x: 91, y: 41, w: 18, h: 18 });
  const long = badgeRect(100, 50, 40);
  assert.equal(long.x + long.w, 109);
  assert.equal(long.w, 52);
});

test('badge: colour from badgeColor, else the node colour; white text reads at 4.5:1 or better', async () => {
  const s = await scene(['A [badge: new, badgeColor: red]', 'B [badge: ok, color: green]', 'C [badge: hex, badgeColor: #fde047]'].join('\n'), 'flowchart');
  const by = new Map(badges(s).map((b) => [b.of, b]));
  assert.equal(by.get('A')!.color, 'red');
  assert.equal(by.get('B')!.color, 'green');
  assert.equal(by.get('C')!.color, '#fde047');
  assert.equal(badgeColors('red').fill, '#d92d20', 'Eraser red as measured');
  assert.equal(badgeColors(undefined).fill, '#444ce7', 'indigo by default');
  for (const c of ['blue', 'indigo', 'green', 'red', 'orange', 'yellow', 'purple', 'pink', 'teal', 'cyan', 'gray', 'black', 'brown', '#fde047', '#123456']) {
    const { fill, text: ink } = badgeColors(c);
    assert.ok(contrast(fill, ink) >= 4.5, `${c}: ${fill}/${ink} ${contrast(fill, ink).toFixed(2)}`);
  }
});

test('badge: dark draws the in-reach fill of the same colour (#244, checked on the canvas in dark-filter.test.ts)', async () => {
  const s = await scene('A [badge: v2, badgeColor: red]', 'flowchart');
  const chip = (svg: string) => /data-badge="A"><rect [^>]*fill="(#[0-9a-f]+)"\/><text [^>]*fill="(#[0-9a-f]+)"/.exec(svg)!.slice(1);
  assert.deepEqual(chip(sceneToSvg(s, { theme: 'light' })), ['#d92d20', '#ffffff']);
  const dark = badgeColors('red', 'dark');
  assert.deepEqual(chip(sceneToSvg(s, { theme: 'dark' })), [dark.fill, dark.text]);
  assert.ok(contrast(dark.fill, dark.text) >= 4.5);
});

test('badge: text is escaped, an invalid colour falls back to indigo', async () => {
  const { ast } = parse('A [badge: "<b>&", badgeColor: url(x)]', 'flowchart');
  const svg = sceneToSvg(await layoutDiagram(ast));
  assert.ok(svg.includes('&lt;b&gt;&amp;'));
  assert.ok(!svg.includes('url(x)'));
  assert.ok(svg.includes('fill="#444ce7"'));
});

test('badge and badgeColor parse without warnings; a bad hex warns', () => {
  assert.deepEqual(parse('A [badge: v2, badgeColor: orange]', 'flowchart').diagnostics, []);
  const d = parse('A [badgeColor: #12]', 'flowchart').diagnostics;
  assert.equal(d.length, 1);
  assert.match(d[0]!.message, /Invalid hex color/);
});

test('divider: a 1.3px muted line broken by its label in the middle, no box', async () => {
  const s = await scene(['A', 'Billing [shape: divider]', 'B'].join('\n'), 'flowchart');
  assert.equal(box(s, 'Billing'), undefined, 'no box');
  const t = text(s, 'Billing')!;
  assert.equal(t.tone, 'muted');
  assert.equal(t.anchor, 'middle');
  const ls = lines(s);
  assert.equal(ls.length, 2, 'two halves');
  const [l, r] = ls.sort((a, b) => a.points[0]!.x - b.points[0]!.x);
  assert.equal(l!.width, 1.3);
  assert.equal(l!.points[0]!.y, r!.points[0]!.y, 'one straight line');
  assert.ok(l!.points[1]!.x < t.x && r!.points[0]!.x > t.x, 'the label cuts the line');
  assert.ok(Math.abs(t.x - l!.points[1]!.x - (r!.points[0]!.x - t.x)) < 0.01, 'label centred in the gap');
  const svg = sceneToSvg(s);
  assert.match(svg, /<polyline [^>]*stroke="#98a2b3" stroke-width="1.3"/);
  assert.equal(s.handles!.find((h) => h.id === 'Billing')!.kind, 'node', 'still draggable');
});

test('divider: splits unconnected nodes into rows above and below it', async () => {
  const s = await scene(['A', 'B', 'C', 'Later [shape: divider]', 'D', 'E'].join('\n'), 'flowchart');
  const h = new Map(s.handles!.map((x) => [x.id, x]));
  const div = h.get('Later')!;
  for (const id of ['A', 'B', 'C']) assert.ok(h.get(id)!.y + h.get(id)!.h <= div.y, `${id} above`);
  for (const id of ['D', 'E']) assert.ok(h.get(id)!.y >= div.y + div.h, `${id} below`);
  assert.equal(h.get('A')!.y, h.get('C')!.y, 'A to C in one row');
});

test('divider: in a group with nothing beside it, runs the whole inside width', async () => {
  const s = await scene(['Team {', '  Alpha', '  Gamma', '  Middle [shape: divider]', '  Beta', '}'].join('\n'), 'flowchart');
  const g = box(s, 'Team')!;
  const ls = lines(s);
  const x0 = Math.min(...ls.map((l) => l.points[0]!.x));
  const x1 = Math.max(...ls.map((l) => l.points[1]!.x));
  assert.equal(x0, g.x + 16);
  assert.equal(x1, g.x + g.w - 16);
});

test('divider: at the root with nothing beside it, spans the other elements', async () => {
  const s = await scene(['A', 'B', 'C', 'D', 'Sep [shape: divider, label: Later]', 'E'].join('\n'), 'flowchart');
  const h = new Map(s.handles!.map((x) => [x.id, x]));
  const sep = h.get('Sep')!;
  assert.equal(sep.x, h.get('A')!.x);
  assert.equal(sep.x + sep.w, h.get('D')!.x + h.get('D')!.w);
});

test('divider: with an empty label it is one unbroken line', async () => {
  const s = await scene('Sep [shape: divider, label: ""]', 'flowchart');
  assert.equal(lines(s).length, 1);
});

test('divider: a badge on a divider is ignored', async () => {
  const s = await scene('Sep [shape: divider, badge: x]', 'flowchart');
  assert.equal(badges(s).length, 0);
});

test('divider: splits connected diagrams into rows too (#244)', async () => {
  for (const dir of ['down', 'right']) {
    const s = await scene([`direction ${dir}`, 'A > B', 'Phase 2 [shape: divider]', 'C > D', 'B > C'].join('\n'), 'flowchart');
    const h = new Map(s.handles!.map((x) => [x.id, x]));
    const div = h.get('Phase 2')!;
    for (const id of ['A', 'B']) assert.ok(h.get(id)!.y + h.get(id)!.h <= div.y, `${dir}: ${id} above`);
    for (const id of ['C', 'D']) assert.ok(h.get(id)!.y >= div.y + div.h, `${dir}: ${id} below`);
    // Nothing beside it: the line runs across everything above and below.
    const x0 = Math.min(...['A', 'B', 'C', 'D'].map((id) => h.get(id)!.x));
    const x1 = Math.max(...['A', 'B', 'C', 'D'].map((id) => h.get(id)!.x + h.get(id)!.w));
    assert.ok(div.x <= x0 && div.x + div.w >= x1, `${dir}: spans ${div.x}..${div.x + div.w} over ${x0}..${x1}`);
    // The edge across the divider is still drawn.
    const edges = s.items.filter((i) => i.kind === 'edge');
    assert.equal(edges.length, 3, `${dir}: three edges`);
  }
});
