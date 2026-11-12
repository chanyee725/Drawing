import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createFileSession, RETRY_MAX, SAVE_DELAY } from '../../web/src/fileSession.ts';
import { ApiError, type DpxFile } from '../../web/src/api.ts';

const file = (over: Partial<DpxFile> = {}): DpxFile => ({ version: 2, title: 't', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 1, ...over });
const block = (id: string, x = 0) => ({ id, type: 'architecture', code: 'a', x, y: 0, w: 10, h: 10 });

type Call = { path: string; file: DpxFile; keepalive: boolean };
/** A fake PUT: each call waits until the test settles it. */
function fakeServer() {
  const calls: Call[] = [];
  const pending: { ok: (v: { revision: number }) => void; fail: (e: unknown) => void }[] = [];
  const saveFile = (path: string, f: DpxFile, keepalive: boolean) =>
    new Promise<{ revision: number }>((ok, fail) => {
      calls.push({ path, file: f, keepalive });
      pending.push({ ok, fail });
    });
  return {
    calls,
    saveFile,
    ok: (revision: number) => pending.shift()!.ok({ revision }),
    fail: (e: unknown) => pending.shift()!.fail(e),
  };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeServer();
  let saved = 0;
  const s = createFileSession({ saveFile: server.saveFile, onSaved: () => saved++ });
  s.load('a.dpx', file());
  return { s, server, saved: () => saved };
}

test('edits are debounced into one save carrying the latest content', async (t) => {
  const { s, server, saved } = setup(t);
  s.edit({ title: 'one' });
  t.mock.timers.tick(SAVE_DELAY - 1);
  s.edit({ title: 'two' });
  t.mock.timers.tick(SAVE_DELAY - 1);
  await settle();
  assert.equal(server.calls.length, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].file.title, 'two');
  assert.equal(server.calls[0].file.revision, 1);
  assert.equal(s.getState().status, '저장 중이에요…');
  server.ok(2);
  await settle();
  assert.equal(s.getState().file?.revision, 2);
  assert.equal(s.getState().status, '저장했어요');
  assert.equal(s.isDirty(), false);
  assert.equal(saved(), 1);
});

test('an edit made during a save stays dirty and is saved next with the new revision', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'one' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  s.edit({ title: 'two' });
  server.ok(2);
  await settle();
  assert.equal(s.isDirty(), true);
  assert.notEqual(s.getState().status, '저장했어요');
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[1].file.title, 'two');
  assert.equal(server.calls[1].file.revision, 2);
  server.ok(3);
  await settle();
  assert.equal(s.isDirty(), false);
});

test('a retryable failure backs off 1s, 2s, 4s … up to 30s and resets after a success', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  const waits: number[] = [];
  for (let i = 0; i < 7; i++) {
    server.fail(new ApiError(503, 'busy'));
    await settle();
    assert.equal(s.getState().statusAlert, true);
    let waited = 0;
    while (server.calls.length === i + 1) {
      t.mock.timers.tick(500);
      waited += 500;
      await settle();
      assert.ok(waited <= RETRY_MAX, 'retry never came');
    }
    waits.push(waited);
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  server.ok(2);
  await settle();
  assert.equal(s.getState().status, '저장했어요');
  // Back to the short delay after a success.
  s.edit({ title: 'y' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new TypeError('network down'));
  await settle();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(server.calls.length, 10);
});

test('a 4xx refusal is not retried', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new ApiError(422, 'bad'));
  await settle();
  t.mock.timers.tick(RETRY_MAX * 2);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(s.getState().status, '저장하지 못했어요. 내용이나 파일 이름을 확인해 주세요');
  assert.equal(s.isDirty(), true);
});

test('a newer-format file says why it is not saved', async (t) => {
  const { s, server } = setup(t);
  s.load('a.dpx', file({ version: 3 }));
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new ApiError(422, 'newer'));
  await settle();
  assert.equal(s.getState().status, '더 새 버전에서 만든 파일이라 저장하지 않았어요');
});

test('a 409 stops saving until overwrite re-sends against the server revision', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'mine' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new ApiError(409, 'conflict', 7));
  await settle();
  assert.deepEqual(s.getState().conflict, { revision: 7 });
  s.edit({ title: 'mine 2' });
  t.mock.timers.tick(SAVE_DELAY * 10);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(s.getState().status, '다른 곳에서 바뀌었어요');
  assert.equal(await s.flushForReload(), false);
  const done = s.overwrite();
  await settle();
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[1].file.revision, 7);
  assert.equal(server.calls[1].file.title, 'mine 2');
  server.ok(8);
  await done;
  assert.equal(s.getState().conflict, null);
  assert.equal(s.isDirty(), false);
});

test('a save that finishes after another file was opened changes nothing', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  s.load('b.dpx', file({ title: 'b', revision: 5 }));
  server.ok(2);
  await settle();
  assert.equal(s.getState().path, 'b.dpx');
  assert.equal(s.getState().file?.revision, 5);
  assert.equal(s.getState().status, '');
});

test('pagehide sends pending edits with keepalive, but not while a save runs', async (t) => {
  const { s, server } = setup(t);
  s.saveOnHide();
  await settle();
  assert.equal(server.calls.length, 0);
  s.edit({ title: 'x' });
  assert.equal(s.hasUnsaved(), true);
  s.saveOnHide();
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].keepalive, true);
  s.edit({ title: 'y' });
  s.saveOnHide();
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(s.hasUnsaved(), true);
});

test('moving a block notifies subscribers but keeps the other slices identical', async (t) => {
  const { s } = setup(t);
  s.edit({ blocks: [block('b1')], title: 'n' });
  const before = s.getState();
  let calls = 0;
  const off = s.subscribe(() => calls++);
  s.edit({ blocks: [block('b1', 50)] });
  const after = s.getState();
  assert.equal(calls, 1);
  assert.notEqual(after.file?.blocks, before.file?.blocks);
  assert.equal(after.file?.title, before.file?.title);
  assert.equal(after.file?.document, before.file?.document);
  assert.equal(after.file?.canvas, before.file?.canvas);
  // Setting the same status again does not wake anyone.
  s.setStatus('');
  assert.equal(calls, 1);
  off();
});
