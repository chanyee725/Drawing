import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, appendFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { parseDrawio, decompressDiagram } from '../server/watch/parse.js';
import { diffFiles } from '../server/watch/diff.js';
import { createWatcher } from '../server/watch/watcher.js';
import { createApp } from '../server/app.js';
import { modules } from '../server/modules.js';

// Real sample: a scratch copy of sim-studio's handover folder (never the original).
const HANDOVER = join(homedir(), 'ws/physical-ai/sim-studio/docs/handover');

const model = (cells) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const box = (id, { x = 0, y = 0, w = 100, h = 40, value = 'A', style = 'rounded=1;', parent = '1' } = {}) =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const file = (pages) =>
  `<?xml version="1.0"?><mxfile host="test">${pages.map(([id, name, body]) => `<diagram id="${id}" name="${name}">${body}</diagram>`).join('')}</mxfile>`;
const compress = (xml) => deflateRawSync(Buffer.from(encodeURIComponent(xml), 'latin1')).toString('base64');

test('parse: uncompressed and compressed diagrams give the same cells', () => {
  const m = model(box('a', { value: 'Hello &amp; 안녕' }) + `<UserObject id="u" label="Obj"><mxCell vertex="1" parent="1" style="s"><mxGeometry x="5" y="6" width="7" height="8" as="geometry"/></mxCell></UserObject>`);
  const plain = parseDrawio(file([['p1', 'One', m]]));
  const packed = parseDrawio(file([['p1', 'One', compress(m)]]));
  for (const doc of [plain, packed]) {
    assert.equal(doc.pages.length, 1);
    const p = doc.pages[0];
    assert.deepEqual([p.id, p.name], ['p1', 'One']);
    assert.equal(p.cells.get('a').value, 'Hello & 안녕');
    assert.equal(p.cells.get('a').geometry.width, 100);
    assert.equal(p.cells.get('u').value, 'Obj');
    assert.match(p.xml, /^<mxGraphModel>/);
  }
  assert.equal(decompressDiagram(compress(m)), m);
  assert.throws(() => parseDrawio(file([['p1', 'One', m]]).slice(0, 80)));
});

test('parse: real handover files (scratch copy)', { skip: !existsSync(HANDOVER) && 'sim-studio handover not present' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'draw-handover-'));
  try {
    await cp(HANDOVER, dir, { recursive: true });
    const doc = parseDrawio(await readFile(join(dir, 'handover.drawio'), 'utf8'));
    assert.ok(doc.pages.length > 1);
    assert.ok(doc.pages.every((p) => p.cells.size > 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('diff: added, removed, moved, text, style with bbox', () => {
  const before = parseDrawio(file([['p', 'P', model(box('a') + box('b', { x: 200 }) + box('c') + box('d') + box('e'))]]));
  const after = parseDrawio(
    file([['p', 'P', model(box('a') + box('b', { x: 300, y: 10 }) + box('c', { value: 'B' }) + box('d', { style: 'x' }) + box('f', { x: 50, y: 500 }))]]),
  );
  const [d] = diffFiles(before, after);
  assert.deepEqual(d.page, { id: 'p', name: 'P' });
  assert.deepEqual(d.kinds, ['added', 'removed', 'moved', 'text', 'style']);
  assert.deepEqual(d.byKind, { added: ['f'], removed: ['e'], moved: ['b'], text: ['c'], style: ['d'] });
  assert.deepEqual(d.cellIds.sort(), ['b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(d.bbox, { x: 0, y: 0, w: 400, h: 540 });
  assert.equal(diffFiles(before, before).length, 0);
});

test('diff: child cell bbox is absolute (parent offset)', () => {
  const before = parseDrawio(file([['p', 'P', model(box('g', { x: 100, y: 100, w: 300, h: 300 }))]]));
  const after = parseDrawio(file([['p', 'P', model(box('g', { x: 100, y: 100, w: 300, h: 300 }) + box('k', { x: 10, y: 20, w: 5, h: 5, parent: 'g' }))]]));
  assert.deepEqual(diffFiles(before, after)[0].bbox, { x: 110, y: 120, w: 5, h: 5 });
});

/** Watcher driven by a fake clock and manual poll(). */
async function harness(projectDir) {
  let t = 1000;
  const changes = [];
  const fileEvents = [];
  const w = createWatcher({ projectDir, now: () => t, quietMs: 300, rescanMs: 1e9, onChange: (c) => changes.push(c), onFile: (e) => fileEvents.push(e) });
  await w.start();
  w.stop(); // timers off; tests drive poll() by hand
  const step = async (ms) => {
    t += ms;
    await w.poll();
  };
  return { w, changes, fileEvents, step };
}

test('watcher: a file written in pieces gives one change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'draw-watch-'));
  try {
    const path = join(dir, 'a.drawio');
    await writeFile(path, file([['p', 'P', model(box('a'))]]));
    const { w, changes, step } = await harness(dir);
    assert.equal(w.listFiles().length, 1);

    const next = file([['p', 'P', model(box('a', { value: 'new' }) + box('b'))]]);
    const third = Math.ceil(next.length / 3);
    for (let i = 0; i < 3; i++) {
      await (i === 0 ? writeFile(path, next.slice(0, third)) : appendFile(path, next.slice(i * third, (i + 1) * third)));
      await step(100); // pieces arrive faster than the quiet window
    }
    await step(400);
    await step(400);
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].kinds, ['added', 'text']);
    assert.equal(changes[0].source.kind, 'main');
    assert.equal(w.history(changes[0].fileId).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watcher: worktree copy is its own source with its own id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draw-root-'));
  try {
    const project = join(root, 'docs');
    const wt = join(root, '.dispatch', 'wt', 'impl-9', 'docs');
    await mkdir(project, { recursive: true });
    await mkdir(wt, { recursive: true });
    const xml = file([['p', 'P', model(box('a'))]]);
    await writeFile(join(project, 'x.drawio'), xml);
    await writeFile(join(wt, 'x.drawio'), xml);

    const { w, changes, step } = await harness(project);
    const list = w.listFiles();
    assert.equal(list.length, 2);
    const [m, c] = [list.find((f) => f.source.kind === 'main'), list.find((f) => f.source.kind === 'worktree')];
    assert.equal(m.path, 'x.drawio');
    assert.equal(c.path, 'x.drawio');
    assert.equal(c.source.label, 'impl-9');
    assert.notEqual(m.id, c.id);
    assert.deepEqual(w.listSources().map((s) => s.kind), ['main', 'worktree']);

    await writeFile(join(wt, 'x.drawio'), file([['p', 'P', model(box('a', { x: 40 }))]]));
    await step(10);
    await step(400);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].fileId, c.id);
    assert.deepEqual(changes[0].kinds, ['moved']);
    assert.equal(changes[0].source.label, 'impl-9');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('watcher: history keeps the last 500 changes per file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'draw-hist-'));
  try {
    const path = join(dir, 'h.drawio');
    await writeFile(path, file([['p', 'P', model(box('a', { x: 0 }))]]));
    const { w, step } = await harness(dir);
    const id = w.listFiles()[0].id;
    for (let i = 1; i <= 503; i++) {
      await writeFile(path, file([['p', 'P', model(box('a', { x: i }))]]));
      await utimes(path, i, i); // same-size writes within one mtime tick look identical
      await step(10);
      await step(400);
    }
    const h = w.history(id);
    assert.equal(h.length, 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('routes: /api/files, /api/files/<id>, /api/history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'draw-api-'));
  try {
    await writeFile(join(dir, 'r.drawio'), file([['p', 'P', compress(model(box('a')))]]));
    const app = await createApp({ projectDir: dir }, { publicDir: dir, moduleList: modules.filter((m) => m.name === 'watch') });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    try {
      const list = await (await fetch(`${base}/api/files`)).json();
      assert.equal(list.length, 1);
      assert.deepEqual(list[0].source, { kind: 'main', label: 'main' });
      assert.deepEqual(list[0].pages, [{ id: 'p', name: 'P' }]);
      const one = await (await fetch(`${base}/api/files/${list[0].id}`)).json();
      assert.match(one.pages[0].xml, /^<mxGraphModel>/);
      assert.deepEqual(await (await fetch(`${base}/api/history?file=${list[0].id}`)).json(), []);
      assert.equal((await fetch(`${base}/api/files/000000000000`)).status, 404);
      const api = app.ctx.modules.watch.api;
      assert.equal(typeof api.onChange(() => {}), 'function');
      assert.equal(api.listSources()[0].kind, 'main');
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
