// Project view of the workspace tree (docs/design/dispatch-integration/6-app-shell-projects.md §1).
// Pure: takes the workspace tree plus a stat lookup, returns projects, unfiled files and a flat file list.
import { FILE_EXT } from '../workspace/model.js';

const stem = (name) => name.slice(0, -FILE_EXT.length);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Optional `<project>/.project.json` -> { name, icon, description }; anything else is ignored. */
export function parseProjectMeta(raw) {
  let o;
  try {
    o = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {};
  const name = text(o.name, 80);
  const icon = text(o.icon, 4);
  const description = text(o.description, 300);
  if (name) out.name = name;
  if (icon) out.icon = icon;
  if (description) out.description = description;
  return out;
}

/**
 * Turns one folder's children into a nested doc list: a file `X.dpx.json` owns the sibling folder `X/`
 * (its sub-docs). A folder without a same-named file becomes a "bundle" (a parent without a document).
 */
export function nestDocs(children, times) {
  const folders = new Map(children.filter((c) => c.type === 'folder').map((f) => [f.name, f]));
  const used = new Set();
  const docs = [];
  const info = (path) => times(path) ?? { createdAt: 0, modifiedAt: 0 };
  for (const f of children.filter((c) => c.type === 'file')) {
    const owned = folders.get(stem(f.name));
    if (owned) used.add(owned.name);
    docs.push({
      path: f.path,
      name: f.name,
      title: f.title || stem(f.name),
      bundle: false,
      ...info(f.path),
      children: owned ? nestDocs(owned.children, times) : [],
    });
  }
  for (const d of folders.values()) {
    if (used.has(d.name)) continue;
    const kids = nestDocs(d.children, times);
    if (kids.length === 0) continue;
    docs.push({
      path: d.path,
      name: d.name,
      title: d.name,
      bundle: true,
      createdAt: Math.min(...kids.map((k) => k.createdAt)),
      modifiedAt: Math.max(...kids.map((k) => k.modifiedAt)),
      children: kids,
    });
  }
  return docs.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export const countDocs = (docs) => docs.reduce((n, d) => n + (d.bundle ? 0 : 1) + countDocs(d.children), 0);
export const flattenDocs = (docs, project = null, parent = null) =>
  docs.flatMap((d) => [
    ...(d.bundle ? [] : [{ path: d.path, title: d.title, project, parent, createdAt: d.createdAt, modifiedAt: d.modifiedAt }]),
    ...flattenDocs(d.children, project, d.bundle ? parent : d.title),
  ]);

/** @param tree store.tree() @param times (path) => {createdAt, modifiedAt} in ms @param metas folder name -> parsed meta */
export function buildProjects(tree, times, metas = {}) {
  const projects = tree
    .filter((n) => n.type === 'folder')
    .map((f) => {
      const docs = nestDocs(f.children, times);
      const meta = metas[f.name] ?? {};
      return {
        id: f.name,
        path: f.path,
        name: meta.name ?? f.name,
        icon: meta.icon ?? [...(meta.name ?? f.name)][0] ?? '',
        description: meta.description ?? '',
        docCount: countDocs(docs),
        createdAt: docs.length ? Math.min(...docs.map((d) => d.createdAt)) : 0,
        modifiedAt: docs.length ? Math.max(...docs.map((d) => d.modifiedAt)) : 0,
        docs,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const unfiled = nestDocs(tree.filter((n) => n.type === 'file'), times).filter((d) => !d.bundle);
  return { projects, unfiled };
}
