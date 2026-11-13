import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DARK_FILTER, applyDarkFilter, preDarkFilter, preDarkFilterColor } from '../../web/src/canvas/darkFilter.ts';
import { renderBlock } from '../../web/src/canvas/render.ts';
import { THEMES } from '../../shared/render/theme.ts';

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
  for (const c of [t.background, t.text, t.muted, t.stroke, t.strongStroke, t.fill, t.groupStroke, t.groupText, t.edge, t.edgeSoft]) {
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
