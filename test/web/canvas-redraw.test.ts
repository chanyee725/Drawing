import { test } from 'node:test';
import assert from 'node:assert/strict';
import { picturesFor, sameDrawing, type PictureCache } from '../../web/src/canvas/sync.ts';

const block = (id: string, code: string, x = 0, type = 'architecture') => ({ id, type, code, x, y: 0, w: 10, h: 10 });

test('moving blocks is the same drawing; new code, type, order or set is not', () => {
  const a = [block('a', 'x'), block('b', 'y')];
  assert.equal(sameDrawing(a, a.map((b) => ({ ...b, x: b.x + 50 }))), true);
  assert.equal(sameDrawing(a, [a[0], { ...a[1], code: 'z' }]), false);
  assert.equal(sameDrawing(a, [a[0], { ...a[1], type: 'flowchart' }]), false);
  assert.equal(sameDrawing(a, [a[1], a[0]]), false);
  assert.equal(sameDrawing(a, [a[0]]), false);
  assert.equal(sameDrawing(a, [...a, block('c', 'x')]), false);
});

test('only blocks whose code changed are rendered again', async () => {
  const cache: PictureCache<string> = new Map();
  const rendered: string[] = [];
  const render = async (b: { id: string; code: string }) => {
    rendered.push(b.id);
    return `${b.id}:${b.code}`;
  };
  assert.deepEqual(await picturesFor([block('a', '1'), block('b', '2')], cache, render), ['a:1', 'b:2']);
  assert.deepEqual(rendered, ['a', 'b']);

  // Moved only: nothing is rendered.
  assert.deepEqual(await picturesFor([block('a', '1', 99), block('b', '2', 99)], cache, render), ['a:1', 'b:2']);
  assert.deepEqual(rendered, ['a', 'b']);

  // One block's code changed and one was added: just those two.
  assert.deepEqual(await picturesFor([block('a', '1'), block('b', '3'), block('c', '4')], cache, render), ['a:1', 'b:3', 'c:4']);
  assert.deepEqual(rendered, ['a', 'b', 'b', 'c']);

  // A removed block leaves the cache; coming back with the same id renders again.
  await picturesFor([block('a', '1')], cache, render);
  assert.deepEqual([...cache.keys()], ['a']);
  await picturesFor([block('a', '1'), block('c', '4')], cache, render);
  assert.deepEqual(rendered, ['a', 'b', 'b', 'c', 'c']);
});

test('a render still running is shared, not started twice', async () => {
  const cache: PictureCache<string> = new Map();
  let calls = 0;
  let finish!: (v: string) => void;
  const render = () => {
    calls++;
    return new Promise<string>((ok) => (finish = ok));
  };
  const first = picturesFor([block('a', '1')], cache, render);
  const second = picturesFor([block('a', '1', 5)], cache, render);
  finish('pic');
  assert.deepEqual(await Promise.all([first, second]), [['pic'], ['pic']]);
  assert.equal(calls, 1);
});
