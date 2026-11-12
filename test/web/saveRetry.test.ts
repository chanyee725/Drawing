import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableSaveError, RELOAD_STOPPED, saveProblemText } from '../../web/src/saveRetry.ts';

const ApiError = class extends Error {
  constructor(status: number, m: string) {
    super(m);
    this.status = status;
  }
  status: number;
};

test('a failed save is retried only when the cause is not a 4xx refusal', () => {
  assert.equal(isRetryableSaveError(new TypeError('network down')), true);
  assert.equal(isRetryableSaveError(new ApiError(500, 'boom')), true);
  assert.equal(isRetryableSaveError(new ApiError(503, 'busy')), true);
  for (const status of [408, 429]) assert.equal(isRetryableSaveError(new ApiError(status, 'later')), true);
  for (const status of [400, 404, 413, 422]) assert.equal(isRetryableSaveError(new ApiError(status, 'no')), false);
});

test('the reload-stopped notice is not replaced by retry messages', () => {
  assert.equal(saveProblemText('저장하지 못했어요. 잠시 뒤 다시 시도할게요', true), RELOAD_STOPPED);
  assert.equal(saveProblemText('저장하지 못했어요. 잠시 뒤 다시 시도할게요', false), '저장하지 못했어요. 잠시 뒤 다시 시도할게요');
});
