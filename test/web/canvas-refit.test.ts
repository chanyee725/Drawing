import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerHeightFor, refitTexts, type FitEl } from '../../web/src/canvas/refit.ts';

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
  assert.equal(out.elements[1]!.y, 40);
});

test('shape heights for a label match Excalidraw', () => {
  assert.equal(containerHeightFor(25, 'rectangle'), 35);
  assert.equal(containerHeightFor(25, 'diamond'), 70);
  assert.equal(containerHeightFor(25, 'ellipse'), Math.round((35 / Math.sqrt(2)) * 2));
});
