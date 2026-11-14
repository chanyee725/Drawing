import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlock } from '../../web/src/canvas/render.ts';
import { renderPreview } from '../../web/src/dsl/adapter.ts';

const GOOD = 'a [icon: aws-ec2]\nb [icon: aws-s3]\na > b\n';
const BAD = 'a [icon: \nb > > \n{{{';

const svgOf = (dataURL: string) => new TextDecoder().decode(Uint8Array.from(atob(dataURL.split(',')[1]), (c) => c.charCodeAt(0)));
const block = (id: string, code: string, type = 'architecture') => ({ id, type, code, x: 0, y: 0, w: 0, h: 0 });

test('a block whose code breaks keeps its last good picture', async () => {
  const good = await renderBlock(block('keep1', GOOD), 'light');
  const expected = await renderPreview('architecture', GOOD, 'light');
  assert.equal(svgOf(good.dataURL), expected?.svg);

  const broken = await renderBlock(block('keep1', BAD), 'light');
  assert.equal(svgOf(broken.dataURL), expected?.svg);
  assert.equal(broken.fileId, good.fileId);
  assert.equal(broken.width, good.width);
  assert.equal(broken.height, good.height);

  // Fixing the code shows the new picture.
  const fixed = await renderBlock(block('keep1', 'x [icon: aws-ec2]\n'), 'light');
  assert.notEqual(fixed.fileId, good.fileId);
  // Breaking it again keeps the newest good picture, not an older one.
  const again = await renderBlock(block('keep1', BAD), 'light');
  assert.equal(again.fileId, fixed.fileId);
});

test('a block with an error and no earlier picture shows the placeholder', async () => {
  const p = await renderBlock(block('fresh1', BAD), 'light');
  assert.match(svgOf(p.dataURL), /그리지 못했어요/);
});

test('blocks keep their own last picture', async () => {
  const a = await renderBlock(block('own-a', GOOD), 'light');
  const b = await renderBlock(block('own-b', BAD), 'light');
  assert.notEqual(svgOf(b.dataURL), svgOf(a.dataURL));
  assert.match(svgOf(b.dataURL), /그리지 못했어요/);
});

test('unsupported types show the not-yet placeholder', async () => {
  const p = await renderBlock(block('bpmn1', 'x', 'bpmn'), 'light');
  assert.match(svgOf(p.dataURL), /아직 그릴 수 없어요/);
});

test('the placeholder asks for true glyph advances like diagram pictures (E63 follow-up)', async () => {
  const svg = svgOf((await renderBlock(block('bpmn2', 'x', 'bpmn'), 'dark')).dataURL);
  assert.match(svg.slice(0, svg.indexOf('>')), /\stext-rendering="geometricPrecision"/);
});

test('a call with unchanged code returns the same pending result, even when the block only moved', async () => {
  const a = renderBlock(block('same1', GOOD), 'light');
  const b = renderBlock({ ...block('same1', GOOD), x: 500, y: 90, w: 300, h: 200 }, 'light');
  assert.equal(a, b);
  const c = renderBlock(block('same1', GOOD + 'c [icon: aws-rds]\n'), 'light');
  assert.notEqual(c, a);
  assert.notEqual((await c).fileId, (await a).fileId);
});

test('a picture says how many errors the drawn code has', async () => {
  assert.equal((await renderBlock(block('err1', GOOD), 'light')).errors, 0);
  const broken = await renderBlock(block('err1', BAD), 'light');
  assert.ok(broken.errors > 0);
  assert.equal((await renderBlock(block('err1', GOOD), 'light')).errors, 0);
});

test('broken code with no earlier picture still reports its errors', async () => {
  const p = await renderBlock(block('err2', BAD), 'light');
  assert.ok(p.errors > 0);
});

test('a picture says whether it is an earlier drawing, and a first broken draw is not', async () => {
  const first = await renderBlock(block('last1', BAD), 'light');
  assert.equal(first.lastGood, false);
  assert.equal(first.failed, false);
  await renderBlock(block('last1', GOOD), 'light');
  const again = await renderBlock(block('last1', BAD), 'light');
  assert.equal(again.lastGood, true);
  assert.equal((await renderBlock(block('last1', GOOD + 'z [icon: aws-s3]\n'), 'light')).lastGood, false);
});

test('a render that throws shows a placeholder and says it failed', async () => {
  // renderBlock reads `code` once for its signature; later reads (inside the draw) throw.
  let n = 0;
  const flaky = { id: 'throw1', type: 'architecture', x: 0, y: 0, w: 0, h: 0, get code(): string { if (n++ === 0) return 'a > b'; throw new Error('boom'); } };
  const p = await renderBlock(flaky, 'light');
  assert.equal(p.failed, true);
  assert.match(svgOf(p.dataURL), /그리지 못했어요/);
});

test('a block with a layout draws with it; basis uses the AST type so nothing resets', async () => {
  const { basisOf } = await import('../../shared/render/overrides.ts');
  const { analyzeDiagram, prunedLayout } = await import('../../web/src/dsl/adapter.ts');
  const code = 'a [icon: aws-ec2]\nb [icon: aws-s3]\na > b\n';
  const ast = analyzeDiagram('architecture', code).ast as never;
  const layout = { v: 1, basis: basisOf(ast), items: { a: { cx: 400, cy: 300, parent: '' } } };
  const plain = await renderBlock(block('lay1', code), 'light');
  const moved = await renderBlock({ ...block('lay1', code), layout }, 'light');
  assert.notEqual(moved.fileId, plain.fileId);
  assert.equal(moved.layoutReset, undefined);
  assert.ok(moved.anchor);
  // Saved against the editor type instead of the AST type: every render would drop it.
  const wrong = await renderBlock({ ...block('lay2', code), layout: { ...layout, basis: { ...layout.basis, type: 'architecture' } } }, 'light');
  assert.equal(wrong.layoutReset, 'type');
  assert.equal(wrong.dataURL, plain.dataURL);
  // Pruning: clean code with nothing to drop leaves the file alone; a big change clears the layout; errors leave it be.
  assert.equal(prunedLayout({ type: 'architecture', code, layout }), null);
  assert.equal('layout' in prunedLayout({ type: 'architecture', code: 'x\ny\nz\nw\nv\nx > y', layout })!, false);
  assert.equal(prunedLayout({ type: 'architecture', code: 'a >> > {{{', layout }), null);
  assert.equal('layout' in prunedLayout({ type: 'sequence', code: 'a > b: hi', layout })!, false);
  assert.equal(prunedLayout({ type: 'architecture', code, layout: undefined }), null);
});

test('prunedLayout drops only the keys the code lost, and never touches an unknown version', async () => {
  const { basisOf } = await import('../../shared/render/overrides.ts');
  const { analyzeDiagram, prunedLayout } = await import('../../web/src/dsl/adapter.ts');
  const code = 'a\nb\nc\nd\na > b\n';
  const basis = basisOf(analyzeDiagram('architecture', code).ast as never);
  const item = { cx: 1, cy: 2, parent: '' };
  const layout = { v: 1, basis, items: { a: item, b: item, c: item } };
  // `c` is gone from the code; `a` and `b` stay.
  const pruned = prunedLayout({ type: 'architecture', code: 'a\nb\nd\ne\na > b\n', layout });
  assert.deepEqual(Object.keys(pruned!.layout!.items!), ['a', 'b']);
  // §2.1: a layout of a newer version is read-only, whatever the code or diagram kind.
  const newer = { v: 2, items: { zzz: item } };
  assert.equal(prunedLayout({ type: 'architecture', code: 'x > y', layout: newer }), null);
  assert.equal(prunedLayout({ type: 'sequence', code: 'a > b: hi', layout: newer }), null);
});

test('renderPreview leaves out a layout the code no longer fits, and keeps one for broken code', async () => {
  const { basisOf } = await import('../../shared/render/overrides.ts');
  const { analyzeDiagram } = await import('../../web/src/dsl/adapter.ts');
  const ast = analyzeDiagram('architecture', GOOD).ast as never;
  const layout = { v: 1, basis: basisOf(ast), items: { a: { cx: 400, cy: 300, parent: '' } } };
  const fits = await renderPreview('architecture', GOOD, 'light', layout);
  assert.equal(fits?.reset, undefined);
  assert.notEqual(fits?.svg, (await renderPreview('architecture', GOOD, 'light'))?.svg);
  // Much more code than the layout was made for: drawn automatically, with the reason.
  const big = 'x1\nx2\nx3\nx4\nx5\nx6\na\nx1 > a\n';
  const reset = await renderPreview('architecture', big, 'light', layout);
  assert.equal(reset?.reset, 'count');
  assert.equal(reset?.svg, (await renderPreview('architecture', big, 'light'))?.svg);
  // Broken code: the block keeps its last good picture, which is not a reset and anchors nothing.
  const good = await renderBlock({ ...block('stale1', GOOD), layout }, 'light');
  const stale = await renderBlock({ ...block('stale1', BAD), layout }, 'light');
  assert.equal(stale.fileId, good.fileId);
  assert.equal(stale.lastGood, true);
  assert.equal(stale.layoutReset, undefined);
  assert.equal(stale.anchor, undefined);
  assert.ok(good.anchor);
});

test('a block shifts only when its layout alone changed, not on resets, code edits or via an error picture', async () => {
  const { basisOf } = await import('../../shared/render/overrides.ts');
  const { analyzeDiagram } = await import('../../web/src/dsl/adapter.ts');
  const { shiftForOrigin } = await import('../../web/src/canvas/sync.ts');
  const basis = basisOf(analyzeDiagram('architecture', GOOD).ast as never);
  const L1 = { v: 1, basis, items: { a: { cx: 400, cy: 300, parent: '' } } };
  // Dragging `a` far up-left grows the bounds there, so the origin moves.
  const L2 = { v: 1, basis, items: { a: { cx: -400, cy: -300, parent: '' } } };
  const el = { x: 100, y: 50 };
  const shift = (from: { width: number }, to: object) => shiftForOrigin({ ...el, width: from.width }, from as never, to as never);
  const p1 = await renderBlock({ ...block('jump1', GOOD), layout: L1 }, 'light');
  const p2 = await renderBlock({ ...block('jump1', GOOD), layout: L2 }, 'light');
  assert.ok(p1.anchor && p2.anchor);
  assert.notDeepEqual([p1.anchor.x, p1.anchor.y], [p2.anchor.x, p2.anchor.y]);
  // Layout edit: the block moves so the origin stays put on screen.
  assert.deepEqual(shift(p1, p2), { x: 100 + p1.anchor.x - p2.anchor.x, y: 50 + p1.anchor.y - p2.anchor.y });
  // Automatic reset (code changed a lot): no shift, so nothing jumps and no new block.x/y gets saved.
  const big = 'x1\nx2\nx3\nx4\nx5\nx6\na\nx1 > a\n';
  const p3 = await renderBlock({ ...block('jump1', big), layout: L2 }, 'light');
  assert.equal(p3.layoutReset, 'count');
  assert.equal(p3.anchor, undefined);
  assert.deepEqual(shift(p2, p3), el);
  // A plain code edit with the layout applied: no shift either.
  const edited = GOOD + 'c [icon: aws-rds]\n';
  const p4 = await renderBlock({ ...block('jump1', edited), layout: L2 }, 'light');
  assert.equal(p4.layoutReset, undefined);
  assert.ok(p4.anchor);
  assert.deepEqual(shift(p2, p4), el);
  // Through an error placeholder (no picture yet) and back: the block stays at every step.
  const e1 = await renderBlock({ ...block('jump2', BAD), layout: L1 }, 'light');
  assert.equal(e1.anchor, undefined);
  const g1 = await renderBlock({ ...block('jump2', GOOD), layout: L1 }, 'light');
  assert.deepEqual(shift(e1, g1), el);
  // Through a last-good picture and back to other code: no step shifts.
  const e2 = await renderBlock({ ...block('jump2', BAD), layout: L1 }, 'light');
  const g2 = await renderBlock({ ...block('jump2', edited), layout: L1 }, 'light');
  assert.deepEqual(shift(g1, e2), el);
  assert.deepEqual(shift(e2, g2), el);
  assert.deepEqual(shift(g1, g2), el);
});

test('the same picture from other code carries that call\'s anchor, not the cached one', async () => {
  const a = await renderBlock(block('cache1', GOOD), 'light');
  // A comment draws the same picture (same file id) but is other code.
  const b = await renderBlock(block('cache1', GOOD + '// note\n'), 'light');
  assert.equal(b.fileId, a.fileId);
  assert.ok(a.anchor && b.anchor);
  assert.notEqual(b.anchor.key, a.anchor.key);
});
