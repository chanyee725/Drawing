import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerHeightFor, labelY, refitTexts, type FitEl } from '../../web/src/canvas/refit.ts';

const el = (id: string, type: string, extra: Partial<FitEl> = {}): FitEl => ({ id, type, x: 0, y: 0, width: 10, height: 10, ...extra });

/** A stand-in for Excalidraw's measuring: every text becomes `w` wide and `h` tall. */
const measureAs = (w: number, h: number, seen: string[][] = []) => (els: FitEl[]) => {
  seen.push(els.map((e) => e.id));
  return els.map((e) => (e.type === 'text' ? { ...e, width: w, height: h } : e));
};

test('only the listed texts are measured and changed', () => {
  const els = [el('a', 'text'), el('b', 'text'), el('r', 'rectangle')];
  const seen: string[][] = [];
  const out = refitTexts(els, new Set(['a']), measureAs(80, 25, seen));
  assert.deepEqual(seen, [['a']], 'Excalidraw sees the changed text only');
  assert.equal(out.changed, true);
  assert.deepEqual(out.elements[0], { ...els[0], width: 80, height: 25, text: undefined });
  assert.equal(out.elements[1], els[1], 'the other text is the same object');
  assert.equal(out.elements[2], els[2]);
});

test('nothing listed, deleted or already the right size: the same array back', () => {
  const els = [el('a', 'text', { width: 80, height: 25 }), el('d', 'text', { isDeleted: true })];
  const seen: string[][] = [];
  assert.equal(refitTexts(els, new Set(), measureAs(1, 1, seen)).elements, els);
  assert.equal(refitTexts(els, new Set(['d']), measureAs(1, 1, seen)).elements, els);
  assert.deepEqual(seen, [], 'nothing to measure');
  const same = refitTexts(els, new Set(['a']), measureAs(80, 25));
  assert.equal(same.elements, els);
  assert.equal(same.changed, false);
});

test("a label's shape is measured with it and grows when the label no longer fits", () => {
  const box = el('box', 'rectangle', { x: 0, y: 100, width: 120, height: 30 });
  const label = el('t', 'text', { containerId: 'box', verticalAlign: 'middle', y: 105, height: 20 });
  const seen: string[][] = [];
  const out = refitTexts([box, label], new Set(['t']), measureAs(100, 50, seen), (e, p) => ({ ...e, ...p, bumped: true }) as FitEl);
  assert.deepEqual(seen, [['t', 'box']]);
  const [b, t] = out.elements as (FitEl & { bumped?: boolean })[];
  assert.equal(b.height, containerHeightFor(50, 'rectangle'));
  assert.equal(b.height, 60);
  assert.equal(b.y, 100, 'the top stays');
  assert.equal(t.y, 105, 'the label is centred in the taller shape');
  assert.ok(b.bumped && t.bumped, 'changes go through the given builder');
});

test('a label that still fits leaves its shape alone and stays centred', () => {
  const box = el('box', 'ellipse', { y: 0, height: 100 });
  const label = el('t', 'text', { containerId: 'box', verticalAlign: 'middle', y: 30, height: 40 });
  const out = refitTexts([box, label], new Set(['t']), measureAs(50, 20));
  assert.equal(out.elements[0], box);
  assert.ok(Math.abs(out.elements[1]!.y - 40) < 0.5, 'centred, as Excalidraw places it');
  assert.equal(out.elements[1]!.y, labelY(box, 100, 20, 'middle'));
});

test('a bottom label stays at the bottom of its grown shape, a top label at the top', () => {
  const box = el('box', 'rectangle', { y: 100, height: 30 });
  const low = refitTexts([box, el('t', 'text', { containerId: 'box', verticalAlign: 'bottom', y: 105 })], new Set(['t']), measureAs(100, 50));
  assert.equal(low.elements[0]!.height, 60);
  assert.equal(low.elements[1]!.y, 100 + 60 - 5 - 50, 'bottom edge minus padding minus the label');
  const high = refitTexts([box, el('t', 'text', { containerId: 'box', verticalAlign: 'top', y: 105 })], new Set(['t']), measureAs(100, 50));
  assert.equal(high.elements[1]!.y, 105);
});

test('label positions match Excalidraw for ellipses and diamonds', () => {
  // computeBoundTextPosition: top offset by padding plus the inset of the shape, room from getBoundTextMaxHeight.
  const top = 5 + 50 * (1 - Math.sqrt(2) / 2);
  assert.equal(labelY({ type: 'ellipse', y: 0 }, 100, 20, 'top'), top);
  assert.equal(labelY({ type: 'ellipse', y: 0 }, 100, 20, 'bottom'), top + 61 - 20);
  assert.equal(labelY({ type: 'diamond', y: 10 }, 100, 20, 'middle'), 10 + 5 + 25 + 40 / 2 - 10);
});

/** An arrow from (x, y) through `pts` (absolute), as Excalidraw keeps it: points relative to the first. */
const arrow = (id: string, pts: [number, number][], extra: Partial<FitEl> = {}): FitEl => ({
  ...el(id, 'arrow'),
  x: pts[0][0],
  y: pts[0][1],
  points: pts.map(([x, y]) => [x - pts[0][0], y - pts[0][1]] as const),
  ...extra,
});
const abs = (a: FitEl) => a.points!.map(([x, y]) => [a.x + x, a.y + y]);

test('arrows bound to a shape that grows follow its edges', () => {
  const box = el('box', 'rectangle', { x: 0, y: 100, width: 120, height: 30 });
  const label = el('t', 'text', { containerId: 'box', verticalAlign: 'middle', y: 105, height: 20 });
  // Into the bottom edge (gap 4), into the right side half-way down, out of the top edge.
  const below = arrow('below', [[60, 300], [60, 134]], { endBinding: { elementId: 'box' } });
  const side = arrow('side', [[300, 115], [124, 115]], { endBinding: { elementId: 'box' } });
  const above = arrow('above', [[60, 96], [60, 0]], { startBinding: { elementId: 'box' } });
  const free = arrow('free', [[0, 0], [10, 10]]);
  const out = refitTexts([box, label, below, side, above, free], new Set(['t']), measureAs(100, 50));
  const [b, , lo, si, ab, fr] = out.elements;
  assert.equal(b.height, 60);
  assert.deepEqual(abs(lo), [[60, 300], [60, 164]], 'the bottom end moves down by the growth, the gap stays');
  assert.equal(lo.height, 136);
  assert.deepEqual(abs(si), [[300, 115], [124, 130]], 'a side end keeps its place along the side');
  assert.equal(ab, above, 'an end above the shape stays');
  assert.equal(fr, free, 'an unbound arrow stays');
});

test('an elbow arrow keeps its fixed point and its right angles', () => {
  const box = el('box', 'rectangle', { x: 0, y: 100, width: 120, height: 30 });
  const label = el('t', 'text', { containerId: 'box', verticalAlign: 'middle', y: 105, height: 20 });
  // Into the right side half-way down (fixed point 0.5): a straight arrow gets a step.
  const side = arrow('side', [[300, 115], [124, 115]], { elbowed: true, endBinding: { elementId: 'box', fixedPoint: [1.03, 0.5] } });
  // Out of the right side, then down: the first leg moves with its end.
  const bent = arrow('bent', [[124, 115], [200, 115], [200, 300]], { elbowed: true, startBinding: { elementId: 'box', fixedPoint: [1.03, 0.5] } });
  const out = refitTexts([box, label, side, bent], new Set(['t']), measureAs(100, 50));
  const [, , si, be] = out.elements;
  assert.deepEqual(abs(si), [[300, 115], [212, 115], [212, 130], [124, 130]]);
  assert.deepEqual(abs(be), [[124, 130], [200, 130], [200, 300]]);
  for (const a of [si, be]) {
    const p = abs(a);
    for (let i = 1; i < p.length; i++) assert.ok(p[i][0] === p[i - 1][0] || p[i][1] === p[i - 1][1], `${a.id}: segment ${i} is square`);
  }
});

test('arrows change through the given builder, and only when their shape grew', () => {
  const box = el('box', 'rectangle', { x: 0, y: 100, width: 120, height: 100 });
  const label = el('t', 'text', { containerId: 'box', verticalAlign: 'middle', y: 140, height: 20 });
  const below = arrow('below', [[60, 300], [60, 204]], { endBinding: { elementId: 'box' } });
  const fits = refitTexts([box, label, below], new Set(['t']), measureAs(100, 20));
  assert.equal(fits.elements[2], below, 'the label fits: the shape and its arrows stay');
  const grows = refitTexts([{ ...box, height: 30 }, label, below], new Set(['t']), measureAs(100, 50), (e, p) => ({ ...e, ...p, bumped: true }) as FitEl);
  assert.equal((grows.elements[2] as FitEl & { bumped?: boolean }).bumped, true);
});

test('shape heights for a label match Excalidraw', () => {
  assert.equal(containerHeightFor(25, 'rectangle'), 35);
  assert.equal(containerHeightFor(25, 'diamond'), 70);
  assert.equal(containerHeightFor(25, 'ellipse'), Math.round((35 / Math.sqrt(2)) * 2));
});
