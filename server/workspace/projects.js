// Projects view of the workspace (docs/design/dispatch-integration/6-app-shell-projects.md §1):
// - a top-level folder is a project; `<project>/.project.json` may give it a name, icon and description
// - files right in the workspace root are "loose" (미분류)
// - a folder `X/` next to `X.dpx.json` holds X's sub-documents; a folder without such a file is a "group"
// Built from the store's tree, so the same hidden-name and symlink rules apply. Nothing is written.
import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FILE_EXT } from './model.js';

export const PROJECT_META = '.project.json';
const META_MAX_BYTES = 16 * 1024;
const LIMITS = { name: 100, icon: 16, description: 500 };

const stem = (name) => (name.endsWith(FILE_EXT) ? name.slice(0, -FILE_EXT.length) : name);
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const ms = (s) => (s ? Date.parse(s) : null);
// Earliest / latest of the known times (ms), null when none is known.
const minOf = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return v.length ? Math.min(...v) : null;
};
const maxOf = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
};

/** The optional meta file of a project folder: only known string fields, trimmed and capped; anything else is ignored. */
export async function readProjectMeta(dir) {
  const abs = join(dir, PROJECT_META);
  let fh;
  try {
    // O_NOFOLLOW: a symlinked meta file is refused at open, with no gap between the check and the read.
    // O_NONBLOCK: opening a FIFO must not wait for a writer; it is then rejected by the isFile check.
    fh = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = await fh.stat();
    if (!st.isFile() || st.size > META_MAX_BYTES) return {};
    const raw = JSON.parse(await fh.readFile('utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [k, max] of Object.entries(LIMITS)) {
      const v = typeof raw[k] === 'string' ? raw[k].trim() : '';
      if (v) out[k] = [...v].slice(0, max).join('');
    }
    return out;
  } catch {
    return {};
  } finally {
    await fh?.close().catch(() => {});
  }
}

/**
 * Nest one folder's tree nodes into documents: a folder named like a sibling document becomes that
 * document's children. `created(file)` gives a file's creation time in ms.
 * DocNode = { type: 'doc'|'group', path, name, title?, revision?, created, modified, count, children }
 * `count` is the number of documents below (not counting the node itself).
 */
export async function nestDocs(nodes, created) {
  const strip = (list) => list.map(({ latest: _l, ...n }) => ({ ...n, children: strip(n.children) }));
  return strip(await nest(nodes, created));
}

// Same as nestDocs, but each node keeps `latest` (newest change in its subtree) so a group above can use it.
async function nest(nodes, created) {
  const docs = new Map();
  for (const n of nodes) if (n.type === 'file') docs.set(stem(n.name), n);
  const out = [];
  const used = new Set();
  for (const n of nodes) {
    if (n.type !== 'folder') continue;
    const children = await nest(n.children, created);
    const owner = docs.get(n.name);
    if (owner) {
      used.add(n.name);
      out.push(await docNode(owner, children, created));
    } else {
      out.push({
        type: 'group',
        path: n.path,
        name: n.name,
        created: iso(minOf(children.map((c) => ms(c.created)))),
        modified: iso(maxOf(children.map((c) => (c.latest ?? ms(c.modified))))),
        latest: maxOf(children.map((c) => (c.latest ?? ms(c.modified)))),
        count: countOf(children),
        children,
      });
    }
  }
  for (const [name, f] of docs) if (!used.has(name)) out.push(await docNode(f, [], created));
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const countOf = (children) => children.reduce((s, c) => s + (c.type === 'doc' ? 1 : 0) + c.count, 0);

async function docNode(f, children, created) {
  const modified = ms(f.mtime);
  return {
    ...(f.pipeline ? { pipeline: f.pipeline } : {}),
    type: 'doc',
    path: f.path,
    name: stem(f.name),
    title: f.title,
    revision: f.revision,
    created: iso(await created(f)),
    modified: iso(modified),
    count: countOf(children),
    children,
    // Newest change in this subtree; only used to date the enclosing group, then dropped.
    latest: maxOf([modified, ...children.map((c) => (c.latest ?? ms(c.modified)))]),
  };
}

/** GET /api/workspace/projects body: { projects: Project[], loose: DocNode[] }. */
export async function listProjects(store) {
  const tree = await store.tree();
  // The file's own birth time is right only until its first save; the store knows better (store.js createdAt).
  const created = async (f) => store.createdAt(f.path, minOf([ms(f.created), ms(f.mtime)]));
  const projects = [];
  for (const n of tree) {
    if (n.type !== 'folder') continue;
    const dir = join(store.root, n.name);
    const meta = await readProjectMeta(dir);
    const docs = await nestDocs(n.children, created);
    let st = null;
    try {
      st = await stat(dir);
    } catch {
      continue; // gone since the tree was read
    }
    const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
    const all = flat(docs);
    projects.push({
      path: n.path,
      name: meta.name ?? n.name,
      icon: meta.icon ?? null,
      description: meta.description ?? '',
      created: iso(minOf([born, ...all.map((d) => ms(d.created))])),
      modified: iso(maxOf([st.mtimeMs, ...all.map((d) => ms(d.modified))])),
      count: countOf(docs),
      docs,
    });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  const loose = await nestDocs(
    tree.filter((n) => n.type === 'file'),
    created,
  );
  return { projects, loose };
}

const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children)]);
