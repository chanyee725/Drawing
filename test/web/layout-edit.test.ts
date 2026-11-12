import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsOf,
  hitHandle,
  imageReason,
  layoutFrame,
  layoutHandles,
  leavesOf,
  marquee,
  movedLayout,
  nudgeFor,
  snapMove,
  snapTargets,
  toLayout,
  toScreen,
  type LayoutHandle,
} from '../../web/src/canvas/layoutEdit.ts';
import { editReason, openLayoutSession, type LayoutSession } from '../../web/src/canvas/layoutSession.ts';
import { renderPreview } from '../../web/src/dsl/adapter.ts';

const H = (id: string, x: number, y: number, w = 40, h = 20, parent = '', kind: 'node' | 'group' = 'node'): LayoutHandle => ({ id, kind, parent, x, y, w, h });

test('layoutFrame maps layout coordinates through the picture origin, block scale, scroll and zoom', () => {
  // Picture 200 wide shown 400 wide (s = 2), origin (10, 20), image at world (100, 50), scroll (5, -5), zoom 1.5.
  const f = layoutFrame({ x: 100, y: 50, width: 400 }, { width: 200, origin: { x: 10, y: 20 } }, { scrollX: 5, scrollY: -5, zoom: 1.5, offsetX: 7, offsetY: 3 });
  assert.equal(f.k, 3);
  // Layout (0, 0) is scene (10, 20) → world (120, 90) → screen ((120 + 5) * 1.5 + 7, (90 - 5) * 1.5 + 3).
  assert.deepEqual(toScreen(f, { x: 0, y: 0 }), { x: 194.5, y: 130.5 });
  assert.deepEqual(toLayout(f, toScreen(f, { x: 12, y: -4 })), { x: 12, y: -4 });
});

test('layoutHandles moves scene hit boxes into layout coordinates', () => {
  const hs = layoutHandles([{ id: 'A', kind: 'node', parent: '', x: 30, y: 40, w: 10, h: 10, moved: false }], { x: 20, y: 30 });
  assert.deepEqual(hs, [{ id: 'A', kind: 'node', parent: '', x: 10, y: 10, w: 10, h: 10 }]);
});

test('hit test takes the topmost box; marquee takes boxes fully inside', () => {
  const hs = [H('G', 0, 0, 200, 100, '', 'group'), H('A', 10, 30), H('B', 100, 30)];
  assert.equal(hitHandle(hs, { x: 20, y: 40 })?.id, 'A');
  assert.equal(hitHandle(hs, { x: 80, y: 80 })?.id, 'G');
  assert.equal(hitHandle(hs, { x: 300, y: 40 }), null);
  assert.deepEqual(marquee(hs, { x: 150, y: 60 }, { x: 0, y: 25 }), ['A', 'B']);
  assert.deepEqual(marquee(hs, { x: -1, y: -1 }, { x: 201, y: 101 }), ['G', 'A', 'B']);
});

test('a filled group moves its descendants; empty groups and nodes move themselves', () => {
  const hs = [H('G', 0, 0, 200, 100, '', 'group'), H('In', 10, 10, 80, 50, 'G', 'group'), H('A', 20, 30, 10, 10, 'In'), H('B', 100, 30, 10, 10, 'G'), H('E', 300, 0, 50, 50, '', 'group'), H('C', 400, 0)];
  assert.deepEqual(leavesOf(['G'], hs).sort(), ['A', 'B']);
  assert.deepEqual(leavesOf(['E', 'C', 'A', 'G'], hs).sort(), ['A', 'B', 'C', 'E']);
  assert.deepEqual(boundsOf(hs, ['A', 'C']), { x: 20, y: 0, w: 420, h: 40 });
  assert.deepEqual(snapTargets(hs, ['A']).map((h) => h.id), ['B', 'E', 'C']);
});

test('movedLayout stores centres rounded to 0.5 with the parent, keeping other items', () => {
  const hs = [H('A', 0, 0, 41, 20, 'G'), H('B', 100, 0)];
  const before = { v: 1, items: { B: { cx: 120, cy: 10, parent: '' } } };
  const basis = { type: 'flowchart', direction: 'right', count: 3 };
  const l = movedLayout(before, hs, ['A'], 10.3, -4.8, basis);
  assert.deepEqual(l, { v: 1, basis, items: { B: { cx: 120, cy: 10, parent: '' }, A: { cx: 31, cy: 5, parent: 'G' } } });
  assert.deepEqual(before.items, { B: { cx: 120, cy: 10, parent: '' } }, 'input untouched');
  // A layout of another version is not carried over (it is read-only and never drawn).
  assert.deepEqual(Object.keys(movedLayout({ v: 9, items: { Z: { cx: 0, cy: 0, parent: '' } } }, hs, ['B'], 0, 0, basis).items!), ['B']);
});

test('snapMove aligns to edges and centres within the tolerance and draws a guide', () => {
  const moving = { x: 0, y: 0, w: 40, h: 20 };
  const other = { x: 100, y: 52, w: 40, h: 20 };
  // dy 50 puts the moving top at 50, 2 away from the other's top (52): snaps to 52 with a horizontal guide.
  const s = snapMove(moving, [other], 30, 50, 6);
  assert.equal(s.dy, 52);
  // No vertical guide: x snaps the centre to the 8 grid (20 + 30 = 50 → 48).
  assert.equal(s.dx, 28);
  // The guide spans the moved box (x 28..68) and the other one (100..140).
  assert.deepEqual(s.guides, [{ x1: 28, y1: 52, x2: 140, y2: 52 }]);
  // Same width, 3 off: left edges align (the first of three equal matches) with a vertical guide.
  const c = snapMove(moving, [other], 97, 200, 6);
  assert.equal(c.dx, 100);
  assert.ok(c.guides.some((g) => g.x1 === 100 && g.x2 === 100));
  // Centre alignment of a narrower box: centre 5 + 113 = 118 → other centre 120.
  const n = snapMove({ x: 0, y: 0, w: 10, h: 10 }, [other], 113, 300, 6);
  assert.equal(n.dx, 115);
  assert.ok(n.guides.some((g) => g.x1 === 120 && g.x2 === 120));
  // Out of tolerance and no grid: unchanged.
  assert.deepEqual(snapMove(moving, [other], 33, 200, 2, 0), { dx: 33, dy: 200, guides: [] });
});

test('arrow keys nudge by 1, Shift by 10; other keys do nothing', () => {
  assert.deepEqual(nudgeFor('ArrowLeft', false), { dx: -1, dy: 0 });
  assert.deepEqual(nudgeFor('ArrowDown', true), { dx: 0, dy: 10 });
  assert.equal(nudgeFor('a', false), null);
});

test('imageReason refuses locked and rotated images', () => {
  assert.equal(imageReason({ angle: 0, locked: false }), null);
  assert.match(imageReason({ locked: true })!, /잠긴/);
  assert.match(imageReason({ angle: 0.3 })!, /돌린/);
});

const ARCH = 'VPC {\n  API [icon: server]\n  Worker\n}\nDB [icon: database]\nAPI > DB\nWorker > DB';

test('editReason: graph code without errors only', () => {
  assert.equal(editReason({ type: 'architecture', code: ARCH }), null);
  assert.match(editReason({ type: 'sequence', code: 'A > B: hi' })!, /종류/);
  assert.match(editReason({ type: 'bpmn', code: '' })!, /종류/);
  assert.match(editReason({ type: 'architecture', code: 'A > B\nC [icon: ' })!, /오류/);
  assert.match(editReason({ type: 'architecture', code: ARCH, layout: { v: 2 } })!, /버전/);
  assert.match(editReason({ type: 'flowchart', code: '' })!, /노드/);
});

test('a session composes exactly the picture the block renders, with and without a layout', async () => {
  const s = (await openLayoutSession({ type: 'architecture', code: ARCH })) as LayoutSession;
  assert.ok('compose' in s);
  const plain = await renderPreview('architecture', ARCH, 'light');
  assert.equal(s.compose(undefined).svg, plain!.svg);
  const { scene } = s.compose(undefined);
  const hs = layoutHandles(scene.handles, scene.origin);
  assert.deepEqual(hs.map((h) => h.id).sort(), ['API', 'DB', 'VPC', 'Worker']);
  const moved = movedLayout(undefined, hs, leavesOf(['DB'], hs), -300, 40, s.basis);
  const drawn = await renderPreview('architecture', ARCH, 'light', moved);
  const mine = s.compose(moved);
  assert.equal(mine.svg, drawn!.svg);
  // DB really moved, in layout coordinates.
  const db0 = hs.find((h) => h.id === 'DB')!;
  const db1 = layoutHandles(mine.scene.handles, mine.scene.origin).find((h) => h.id === 'DB')!;
  assert.deepEqual([db1.x - db0.x, db1.y - db0.y], [-300, 40]);
  // A second session for the same code reuses the ELK result.
  const again = (await openLayoutSession({ type: 'architecture', code: ARCH })) as LayoutSession;
  assert.equal(again.compose(moved).svg, mine.svg);
  assert.deepEqual(await openLayoutSession({ type: 'sequence', code: 'A > B: x' }), { reason: '이 종류는 아직 노드를 옮길 수 없어요' });
});
