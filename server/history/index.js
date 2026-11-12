// T6: change history.
//   GET /api/versions?file=<id>             -> { versions: Version[] }  oldest first, no XML
//   GET /api/versions/<seq>?file=<id>       -> { seq, page, xml, cells }  that page after the change
//   GET /api/git-log?file=<id>              -> { available, commits: [{ sha, at, subject }] }  newest first
//   GET /api/git-version?file=<id>&commit=<sha>&page=<pageId>
//                                           -> { sha, pages, page, xml, cells }  vs the previous commit
// cells = [{ id, kinds, box }] for highlighting (box in graph coords, removed = old place).
// Git is read in the main checkout only (`git log --follow`), never written. No
// author names or emails are read; commit subjects are the only commit text kept.
import { resolve } from 'node:path';
import { sendJson } from '../app.js';
import { parseDrawio } from '../watch/parse.js';
import { createVersionStore, highlightCells, emptyModel } from './versions.js';
import { createGitReader } from './git.js';

const FILE_ID = /^[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;

/** @param {{ projectDir: string, modules: { watch?: any, agents?: any } }} ctx */
export async function setup(ctx, { gitDir = resolve(ctx.projectDir) } = {}) {
  const watcher = ctx.modules.watch?.watcher;
  if (!watcher) return {};
  const agentForDir = (dir) => ctx.modules.agents?.api?.agentForDir?.(dir) ?? null;
  const store = createVersionStore({ getParsed: watcher.getParsed, agentFor: agentForDir });
  for (const f of watcher.listFiles()) store.baseline(f.id);
  const unsubscribe = ctx.modules.watch.api.onChange((c) => store.record(c));
  const git = createGitReader(gitDir);

  const fileOf = (url) => {
    const id = url.searchParams.get('file') ?? '';
    return FILE_ID.test(id) ? (watcher.listFiles().find((f) => f.id === id) ?? null) : null;
  };

  const routes = [
    {
      method: 'GET',
      path: '/api/versions',
      handler: (req, res, _c, _m, url) => {
        const id = url.searchParams.get('file') ?? '';
        const list = store.list(id);
        if (list) return sendJson(res, 200, { versions: list });
        return fileOf(url) ? sendJson(res, 200, { versions: [] }) : sendJson(res, 404, { error: 'not found' });
      },
    },
    {
      method: 'GET',
      path: /^\/api\/versions\/(\d{1,9})$/,
      handler: async (req, res, _c, m, url) => {
        const v = store.get(url.searchParams.get('file') ?? '', Number(m[1]));
        if (!v) return sendJson(res, 404, { error: 'not found' });
        if (!v.snapshot) return sendJson(res, 410, { error: 'snapshot dropped' });
        const cells = await highlightCells(v.before, v.after);
        return sendJson(res, 200, { seq: v.seq, page: v.page, xml: emptyModel(v.after), cells });
      },
    },
    {
      method: 'GET',
      path: '/api/git-log',
      handler: async (req, res, _c, _m, url) => {
        const f = fileOf(url);
        if (!f) return sendJson(res, 404, { error: 'not found' });
        const { available, commits } = await git.log(f.path);
        return sendJson(res, 200, { available, commits: commits.map(({ sha, at, subject }) => ({ sha, at, subject })) });
      },
    },
    {
      method: 'GET',
      path: '/api/git-version',
      handler: async (req, res, _c, _m, url) => {
        const f = fileOf(url);
        const sha = url.searchParams.get('commit') ?? '';
        if (!f || !SHA.test(sha)) return sendJson(res, 404, { error: 'not found' });
        // Only commits from this file's own log, so a request cannot read other objects.
        const { commits } = await git.log(f.path);
        const i = commits.findIndex((c) => c.sha === sha);
        if (i === -1 || !commits[i].path) return sendJson(res, 404, { error: 'not found' });
        const prev = commits.slice(i + 1).find((c) => c.path) ?? null;
        let doc, prevDoc;
        try {
          doc = await parseDrawio(await git.show(sha, commits[i].path));
          prevDoc = prev ? await parseDrawio(await git.show(prev.sha, prev.path)).catch(() => null) : null;
        } catch {
          return sendJson(res, 422, { error: 'unreadable version' });
        }
        const want = url.searchParams.get('page');
        const page = doc.pages.find((p) => p.id === want) ?? (want ? null : doc.pages[0] ?? null);
        const before = page ? (prevDoc?.pages.find((p) => p.id === page.id)?.xml ?? '') : '';
        return sendJson(res, 200, {
          sha,
          pages: doc.pages.map((p) => ({ id: p.id, name: p.name })),
          page: page ? { id: page.id, name: page.name } : null,
          xml: page ? emptyModel(page.xml) : null,
          cells: page ? await highlightCells(before, page.xml) : [],
        });
      },
    },
  ];

  return { routes, api: { list: store.list }, close: () => unsubscribe() };
}
