// Pure helpers for the live agent cursor (E56): which element or block of a `.dpx.json` changed between two
// versions, and where its centre is in scene coordinates. No I/O, so it runs under `node --test`.

/** Tools that only read: a mention of the file there is not an edit. */
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch']);

/**
 * Whether a session's tool entry (name + masked, clipped input text) points at workspace file `rel`.
 * Matches the relative path as written or URL-encoded (curl …/api/file?path=…), on a path boundary.
 */
export function mentionsFile(entry, rel) {
  if (!entry || entry.kind !== 'tool' || typeof entry.text !== 'string' || READ_TOOLS.has(entry.name)) return false;
  for (const needle of new Set([rel, encodeURIComponent(rel)])) {
    let i = entry.text.indexOf(needle);
    while (i !== -1) {
      const before = i === 0 ? '' : entry.text[i - 1];
      if (before === '' || /[\s/"'=:]/.test(before)) return true;
      i = entry.text.indexOf(needle, i + 1);
    }
  }
  return false;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Scene box of a canvas element or block: { x, y, w, h } (absolute size), or null without usable numbers. */
function boxOf(x, y, w, h) {
  x = num(x); y = num(y); w = num(w) ?? 0; h = num(h) ?? 0;
  if (x === null || y === null) return null;
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
}

/**
 * Everything on the canvas with a place: `el:<id>` for canvas elements, `block:<id>` for diagram blocks.
 * Each entry keeps a signature (its JSON) to tell a change, and its box. Deleted elements count as absent.
 */
export function shapesOf(file) {
  const out = new Map();
  for (const e of Array.isArray(file?.canvas?.elements) ? file.canvas.elements : []) {
    if (!e || typeof e.id !== 'string' || e.isDeleted) continue;
    const box = boxOf(e.x, e.y, e.width, e.height);
    if (box) out.set(`el:${e.id}`, { sig: JSON.stringify(e), box });
  }
  for (const b of Array.isArray(file?.blocks) ? file.blocks : []) {
    if (!b || typeof b.id !== 'string') continue;
    const box = boxOf(b.x, b.y, b.w, b.h);
    if (box) out.set(`block:${b.id}`, { sig: JSON.stringify(b), box });
  }
  return out;
}

/**
 * Centre of the bounds of what changed from `before` to `after` (maps from shapesOf): added and changed shapes at
 * their new place, removed ones at their old place. Null when nothing with a place changed.
 */
export function changedCentre(before, after) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (b) => {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  };
  for (const [k, s] of after) if (before.get(k)?.sig !== s.sig) add(s.box);
  for (const [k, s] of before) if (!after.has(k)) add(s.box);
  if (x0 === Infinity) return null;
  return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
}

/** Keys (`el:<id>` / `block:<id>`) of what changed from `before` to `after`: added, changed and removed shapes. */
export function changedKeys(before, after) {
  const out = [];
  for (const [k, s] of after) if (before.get(k)?.sig !== s.sig) out.push(k);
  for (const k of before.keys()) if (!after.has(k)) out.push(k);
  return out;
}
