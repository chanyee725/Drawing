// Projects module: GET /api/projects (top-level folders as projects, nested sub-docs, unfiled root files)
// and GET /api/recent (files by last edit). Read-only; metadata only, never file contents beyond titles.
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildProjects, flattenDocs, parseProjectMeta } from './model.js';

const META_MAX = 16 * 1024;

export async function setup(ctx) {
  const store = ctx.modules.workspace?.store;
  if (!store || !ctx.workspaceDir) return {};

  async function load() {
    const tree = await store.tree();
    const times = new Map();
    const files = [];
    const collect = (nodes) => nodes.forEach((n) => (n.type === 'folder' ? collect(n.children) : files.push(n)));
    collect(tree);
    await Promise.all(
      files.map(async (f) => {
        try {
          const st = await lstat(join(ctx.workspaceDir, f.path));
          times.set(f.path, { createdAt: st.birthtimeMs || st.mtimeMs, modifiedAt: st.mtimeMs });
        } catch {
          // removed between the tree read and the stat
        }
      }),
    );
    const metas = {};
    await Promise.all(
      tree
        .filter((n) => n.type === 'folder')
        .map(async (f) => {
          try {
            const raw = await readFile(join(ctx.workspaceDir, f.path, '.project.json'), 'utf8');
            if (raw.length <= META_MAX) metas[f.name] = parseProjectMeta(raw);
          } catch {
            // no meta file: folder name, first-letter icon
          }
        }),
    );
    return buildProjects(tree, (p) => times.get(p), metas);
  }

  const send = (res, body) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  return {
    routes: [
      { method: 'GET', path: '/api/projects', handler: async (req, res) => send(res, await load()) },
      {
        method: 'GET',
        path: '/api/recent',
        async handler(req, res, _c, _m, url) {
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
          const { projects, unfiled } = await load();
          const all = [...projects.flatMap((p) => flattenDocs(p.docs, p.id)), ...flattenDocs(unfiled)];
          send(res, { files: all.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit) });
        },
      },
    ],
  };
}
