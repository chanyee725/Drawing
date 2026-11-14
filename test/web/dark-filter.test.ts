import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DARK_CANVAS_BACKGROUND, DARK_FILTER, applyDarkFilter, darkCanvasSeen, inDarkReachNear, preDarkFilter, preDarkFilterColor } from '../../shared/render/darkFilter.ts';
import { renderBlock } from '../../web/src/canvas/render.ts';
import { THEMES, badgeColors } from '../../shared/render/theme.ts';
import { sceneToSvg } from '../../shared/render/svg.ts';
import type { Scene } from '../../shared/render/scene.ts';

type Vec = [number, number, number];
const rgbOf = (hex: string): Vec => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Vec;
const to255 = (v: Vec) => v.map((x) => Math.round(x * 255));
const roundTrip = (hex: string) => to255(applyDarkFilter(rgbOf(preDarkFilterColor(hex) as string)));
const near = (a: number[], b: number[], tol: number, msg: string) =>
  assert.ok(a.every((x, i) => Math.abs(x - b[i]) <= tol), `${msg}: ${a.join(',')} vs ${b.join(',')}`);

test('the filter is the one Excalidraw puts on its dark canvas', () => {
  assert.equal(DARK_FILTER, 'invert(93%) hue-rotate(180deg)');
  // White comes out as Excalidraw's dark background, black as its light text.
  near(to255(applyDarkFilter([1, 1, 1])), [18, 18, 18], 0, 'white');
  near(to255(applyDarkFilter([0, 0, 0])), [237, 237, 237], 0, 'black');
});

test('every dark theme colour the filter can reach comes back through it', () => {
  const t = THEMES.dark;
  for (const c of [t.background, t.text, t.muted, t.stroke, t.strongStroke, t.fill, t.groupStroke, t.groupText, t.edge, t.flowEdge, t.edgeSoft, t.shadow]) {
    near(roundTrip(c), to255(rgbOf(c)), 1, c);
  }
});

test('a colour out of reach keeps its look: greys stay grey, colours keep their hue', () => {
  // Darker than the filter can make: the darkest it can, still grey.
  const deep = roundTrip('#0b0c0e');
  assert.ok(deep[0] === deep[1] && deep[1] === deep[2], `grey ${deep}`);
  // Brighter than it can make.
  const white = roundTrip('#ffffff');
  assert.ok(white[0] === white[1] && white[1] === white[2] && white[0] >= 230, `white ${white}`);
  // A saturated yellow stays yellow-orange (red > green > blue), not pale or tinted another way.
  const [r, g, b] = roundTrip('#fec84b');
  assert.ok(r > g && g > b && r - b > 100, `yellow ${r},${g},${b}`);
  // A saturated blue stays blue.
  const [br, bg, bb] = roundTrip('#444ce7');
  assert.ok(bb > bg && bb > br && bb - br > 100, `blue ${br},${bg},${bb}`);
});

test('pre-filtered colours are paintable', () => {
  for (let i = 0; i < 200; i++) {
    const want: Vec = [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256].map((x) => x / 255) as Vec;
    const c = preDarkFilter(want);
    assert.ok(c.every((x) => x >= 0 && x <= 1), `${want} → ${c}`);
  }
});

test('colour strings: hex and rgba are rewritten with alpha kept, anything else is left alone', () => {
  assert.match(preDarkFilterColor('#fff'), /^#[0-9a-f]{6}$/);
  assert.equal(preDarkFilterColor('#fff'), preDarkFilterColor('#ffffff'));
  const translucent = preDarkFilterColor('rgba(255,255,255,0.04)');
  assert.match(translucent, /^rgba\(\d+,\d+,\d+,0\.04\)$/);
  assert.equal(preDarkFilterColor('rgb(23, 25, 29)'), preDarkFilterColor('#17191d'));
  for (const s of ['none', 'currentColor', 'transparent', 'url(#m)']) assert.equal(preDarkFilterColor(s), s);
});

test('a block for the dark canvas is the dark picture with every colour pre-filtered', async () => {
  const b = { id: 'darkcanvas1', type: 'flowchart', code: 'Start [shape: oval, color: green]\nDo [color: yellow]\nStart > Do: go\n', x: 0, y: 0, w: 0, h: 0 };
  const dark = await renderBlock(b, 'dark');
  const canvas = await renderBlock(b, 'dark-canvas');
  assert.notEqual(canvas.fileId, dark.fileId);
  assert.equal(canvas.width, dark.width);
  assert.equal(canvas.height, dark.height);
  const colours = (svg: string) => svg.match(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi) ?? [];
  const want = colours(dark.svg);
  const got = colours(canvas.svg);
  assert.equal(got.length, want.length);
  assert.ok(want.length > 5);
  // Outside the colours, the two pictures are the same markup.
  const strip = (svg: string) => svg.replace(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi, 'C').replace(/data-theme="[^"]*"/, '');
  assert.equal(strip(canvas.svg), strip(dark.svg));
  want.forEach((c, i) => assert.equal(got[i], preDarkFilterColor(c), `colour ${i}`));
  // The layout anchor is per theme, so switching themes never shifts a block.
  if (dark.anchor && canvas.anchor) assert.notEqual(canvas.anchor.key, dark.anchor.key);
});

// What the dark canvas shows: a colour painted into a 'dark-canvas' picture, seen through the filter.
const seen = (painted: string) => '#' + to255(applyDarkFilter(rgbOf(painted))).map((x) => x.toString(16).padStart(2, '0')).join('');
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = rgbOf(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b2!;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** OKLCH hue in degrees. */
function hue(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as Vec;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675778 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('#202: the node shadow stays visible on the dark canvas and in a dark export', async () => {
  const t = THEMES.dark;
  // Excalidraw's dark canvas is white through the filter; a dark export fills with the theme background.
  const canvas = seen('#ffffff');
  assert.equal(canvas, '#121212');
  const shadow = darkCanvasSeen(t.shadow);
  assert.ok(contrast(shadow, canvas) >= 1.25, `shadow ${shadow} on canvas ${contrast(shadow, canvas).toFixed(2)}`);
  assert.ok(contrast(shadow, t.background) >= 1.2, `shadow ${shadow} on background ${contrast(shadow, t.background).toFixed(2)}`);
  const b = { id: 'darkshadow1', type: 'flowchart', code: 'A\nB\nA > B\n', x: 0, y: 0, w: 0, h: 0 };
  const pic = await renderBlock(b, 'dark-canvas');
  const fills = [...pic.svg.matchAll(/fill="(#[0-9a-f]{6})" stroke="none"/g)].map((m) => seen(m[1]!));
  assert.ok(fills.length >= 2, 'two shadows drawn');
  for (const f of fills) assert.ok(contrast(f, canvas) >= 1.25, `drawn shadow ${f} reads on the canvas`);
});

test('#244: badges on the dark canvas keep their hue and white text at 4.5:1', async () => {
  const names = ['indigo', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'teal', 'cyan', 'gray', 'brown', '#fde047', '#123456'];
  const code = names.map((c, i) => `N${i} [badge: v${i}, badgeColor: ${c}]`).join('\n') + '\n';
  const pic = await renderBlock({ id: 'darkbadge1', type: 'flowchart', code, x: 0, y: 0, w: 0, h: 0 }, 'dark-canvas');
  const chips = [...pic.svg.matchAll(/<g data-badge="(N\d+)"><rect [^>]*fill="(#[0-9a-f]{6})"\/><text [^>]*fill="(#[0-9a-f]{6})"/g)];
  assert.equal(chips.length, names.length);
  for (const [, id, fill, ink] of chips) {
    const name = names[Number(id!.slice(1))]!;
    const [f, t] = [seen(fill!), seen(ink!)];
    assert.ok(contrast(f, t) >= 4.5, `${name}: ${f}/${t} ${contrast(f, t).toFixed(2)}`);
    const want = badgeColors(name).fill;
    // Greys have no hue to keep.
    if (name !== 'gray') assert.ok(hueGap(hue(f), hue(want)) <= 8, `${name}: hue ${hue(f).toFixed(0)} vs ${hue(want).toFixed(0)}`);
  }
  // The dark export shows the same colours as the canvas: the fills are inside the filter's reach.
  for (const name of names) {
    const { fill, text } = badgeColors(name, 'dark');
    near(roundTrip(fill), to255(rgbOf(fill)), 1, `${name} fill`);
    near(roundTrip(text), to255(rgbOf(text)), 1, `${name} text`);
  }
  // Before #244 the filter's nearest pick turned red orange and indigo text fell under 4.5:1.
  assert.ok(contrast(darkCanvasSeen('#d92d20'), '#ededed') < 4.5);
});

test('inDarkReachNear: in-reach colours come back as they are, out-of-reach ones keep their hue', () => {
  assert.equal(inDarkReachNear('#3a3f47'), '#3a3f47');
  const red = inDarkReachNear('#d92d20')!;
  assert.ok(hueGap(hue(red), hue('#d92d20')) <= 3, red);
  near(roundTrip(red), to255(rgbOf(red)), 1, 'red in reach');
  assert.equal(inDarkReachNear('#d92d20', () => false), null);
});

test('#296: an uncoloured participant box on the dark canvas shows the canvas colour, border and label still read', async () => {
  assert.equal(DARK_CANVAS_BACKGROUND, '#121212');
  const b = { id: 'darkseq1', type: 'sequence', code: 'Alice > Bob: hello\nBob > Alice: ok\n', x: 0, y: 0, w: 0, h: 0 };
  const head = /<g data-role="column"[^>]*><rect [^>]*fill="(#[0-9a-f]{6})" stroke="(#[0-9a-f]{6})"/g;
  const canvas = await renderBlock(b, 'dark-canvas');
  const boxes = [...canvas.svg.matchAll(head)];
  assert.equal(boxes.length, 4, 'two heads and two feet');
  const t = THEMES.dark;
  for (const [, fill, stroke] of boxes) {
    assert.equal(seen(fill!), DARK_CANVAS_BACKGROUND, 'the box fill is the canvas');
    near(to255(rgbOf(seen(stroke!))), to255(rgbOf(t.sequence!.columnStroke)), 1, 'border');
    assert.ok(contrast(seen(stroke!), DARK_CANVAS_BACKGROUND) >= 3, 'border reads on the canvas');
  }
  const label = /<g data-role="column"[\s\S]*?<text [^>]*fill="(#[0-9a-f]{6})"[^>]*>(?:<tspan[^>]*>)Alice/.exec(canvas.svg);
  assert.ok(label, 'participant label drawn');
  assert.ok(contrast(seen(label[1]!), DARK_CANVAS_BACKGROUND) >= 4.5, 'label reads on the box');
  // The dark export draws its own background, so its boxes keep the theme background (unchanged).
  const dark = await renderBlock(b, 'dark');
  for (const [, fill] of dark.svg.matchAll(head)) assert.equal(fill, t.background);
});

test('#296: muted text on a flat participant box is judged against the fill the box is drawn with', () => {
  const pastel = { mode: 'pastel' as const };
  const scene = (onRole?: 'column'): Scene => ({
    type: 'sequence',
    width: 100,
    height: 40,
    items: [{ kind: 'text', x: 50, y: 10, lines: ['note'], size: 14, lineHeight: 20, anchor: 'middle', weight: 400, font: 'clean', tone: 'muted', on: pastel, onRole }],
  });
  const ink = (svg: string) => /<text [^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1];
  const t = THEMES.dark;
  // On a mid grey surface the muted grey falls under 4.5:1 and is lifted; on the usual fill it reads as is.
  const surface = '#6b6b6b';
  assert.equal(ink(sceneToSvg(scene(), { theme: 'dark', surface })), t.muted);
  assert.notEqual(ink(sceneToSvg(scene('column'), { theme: 'dark', surface })), t.muted);
  assert.equal(ink(sceneToSvg(scene('column'), { theme: 'dark' })), t.muted);
});
