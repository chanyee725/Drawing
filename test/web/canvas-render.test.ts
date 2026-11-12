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
