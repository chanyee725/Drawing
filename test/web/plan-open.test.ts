import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileSession } from '../../web/src/fileSession.ts';
import { ApiError, type DpxFile } from '../../web/src/api.ts';
import { openPlanConfirm, requestStart, SAVE_FIRST } from '../../web/src/run/planOpen.ts';
import { confirmSnapshot, type PipelineStatus } from '../../web/src/run/planStripModel.ts';

const PATH = 'pipelines/a.dpx.json';
const file = (): DpxFile => ({ version: 2, title: 't', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 3 });
const status = (revision: number): PipelineStatus => ({
  path: PATH,
  revision,
  state: 'plan',
  lead: null,
  draftRevision: revision,
  approvedRevision: null,
  approvedAt: null,
  runId: null,
  blockers: [],
  changes: [],
  sessions: 2,
  limits: null,
});

/** What the strip does on 시작하기: open the confirm, and (the person confirming) send the start it showed. */
async function clickStart(saveFile: (p: string, f: DpxFile) => Promise<{ revision: number }>, before?: (s: ReturnType<typeof createFileSession>) => void) {
  const s = createFileSession({ saveFile });
  s.load(PATH, file());
  s.edit({ title: 'edited' });
  before?.(s);
  const reads: string[] = [];
  const starts: unknown[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    starts.push({ url, body: init?.body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const r = await openPlanConfirm(s, PATH, async (p) => {
    reads.push(p);
    return status(3);
  });
  if (r.kind === 'open') await requestStart(PATH, confirmSnapshot(r.status), fetchFn);
  return { r, reads, starts, s };
}

test('a save that hits 409 refuses to start and sends no start request', async () => {
  const { r, reads, starts } = await clickStart(async () => {
    throw new ApiError(409, 'conflict', 4);
  });
  assert.deepEqual(r, { kind: 'refuse', message: SAVE_FIRST });
  assert.equal(reads.length, 0);
  assert.equal(starts.length, 0);
});

test('a refused or failing save refuses to start', async () => {
  for (const e of [new ApiError(422, 'bad'), new ApiError(503, 'busy'), new TypeError('network')]) {
    const { r, starts, s } = await clickStart(async () => {
      throw e;
    });
    assert.equal(r.kind, 'refuse');
    assert.equal(starts.length, 0);
    s.close();
  }
});

test('a save held by a running move refuses to start', async () => {
  let saves = 0;
  const { r, starts } = await clickStart(
    async () => {
      saves++;
      return { revision: 4 };
    },
    (s) => void s.hold(),
  );
  assert.equal(saves, 0);
  assert.equal(r.kind, 'refuse');
  assert.equal(starts.length, 0);
});

test('a saved edit opens the confirm and starts the revision it showed', async () => {
  const { r, reads, starts } = await clickStart(async () => ({ revision: 4 }));
  assert.equal(r.kind, 'open');
  assert.deepEqual(reads, [PATH]);
  assert.equal(starts.length, 1);
  assert.deepEqual(JSON.parse((starts[0] as { body: string }).body), { path: PATH, revision: 3 });
});
