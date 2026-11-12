import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockLabel, brokenNotice } from '../../web/src/canvas/notice.ts';

const b = (over = {}) => ({ id: 'a', type: 'erd', errors: 2, lastGood: true, failed: false, ...over });

test('notice says whether the picture is an earlier drawing or nothing was drawn yet', () => {
  assert.equal(brokenNotice(b()), '오류 2개 · 마지막으로 그린 모습이에요. 눌러서 코드를 고쳐요');
  assert.equal(brokenNotice(b({ lastGood: false })), '오류 2개 · 아직 그린 적이 없어요. 눌러서 코드를 고쳐요');
});

test('a renderer failure is reported, not silent', () => {
  assert.equal(brokenNotice(b({ errors: 0, failed: true })), '그리지 못했어요 · 마지막으로 그린 모습이에요. 눌러서 코드를 고쳐요');
});

test('with several blocks the notice names the block: type label and position among that type', () => {
  const blocks = [{ id: 'x', type: 'flowchart' }, { id: 'y', type: 'erd' }, { id: 'a', type: 'erd' }];
  assert.equal(blockLabel(blocks[2], blocks, 'ERD'), 'ERD 2 · ');
  assert.equal(blockLabel(blocks[0], blocks, '플로차트'), '플로차트 1 · ');
  assert.equal(blockLabel(blocks[0], [blocks[0]], '플로차트'), '');
  assert.match(brokenNotice(b(), 'ERD 2 · '), /^ERD 2 · 오류 2개/);
});
