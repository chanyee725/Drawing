import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionOf } from '../../web/src/dispatch/lib/question.ts';

test('no question in an answer that asks nothing', () => {
  assert.equal(questionOf(''), null);
  assert.equal(questionOf(null), null);
  assert.equal(questionOf('테스트를 고쳤어요.\n모두 통과해요.'), null);
});

test('a plain yes/no ask offers yes and no', () => {
  const q = questionOf('브랜치를 만들었어요.\n이대로 PR을 열까요?');
  assert.deepEqual(q, { summary: '이대로 PR을 열까요?', options: ['네, 진행해 주세요', '아니요, 멈춰 주세요'] });
});

test('an open question offers no options', () => {
  assert.deepEqual(questionOf('어떤 이름으로 할까요?')?.options, []);
});

test('a list after the question becomes the options, labels cut at the explanation', () => {
  const q = questionOf('**어느 쪽으로 갈까요?**\n1. A안 — 빠름\n2. B안: 안전함');
  assert.equal(q?.summary, '어느 쪽으로 갈까요?');
  assert.deepEqual(q?.options, ['A안', 'B안']);
});

test('a list right before the question is used too', () => {
  const q = questionOf('- 하나\n- 둘\n- 셋\n어느 걸로 할까요?');
  assert.deepEqual(q?.options, ['하나', '둘', '셋']);
});

test('options are capped at five and deduplicated', () => {
  const q = questionOf(['골라 주세요', ...['a', 'b', 'a', 'c', 'd', 'e', 'f'].map(x => `- ${x}`)].join('\n'));
  assert.deepEqual(q?.options, ['a', 'b', 'c', 'd', 'e']);
});
