// Cell-level diff between two parsed versions of a .drawio file, per page.

const KIND_ORDER = ['added', 'removed', 'moved', 'text', 'style'];
const KIND_WORD = { added: '추가', removed: '삭제', moved: '이동', text: '글자 변경', style: '스타일 변경' };

function sameGeometry(a, b) {
  if (!a || !b) return a === b;
  if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) return false;
  if (a.points.length !== b.points.length) return false;
  return a.points.every((p, i) => p[0] === b.points[i][0] && p[1] === b.points[i][1]);
}

/** Compare one cell; returns the change kinds that apply. */
function cellKinds(a, b) {
  const kinds = [];
  if (!sameGeometry(a.geometry, b.geometry) || a.parent !== b.parent || a.source !== b.source || a.target !== b.target) {
    kinds.push('moved');
  }
  if (a.value !== b.value) kinds.push('text');
  if (a.style !== b.style) kinds.push('style');
  return kinds;
}

/**
 * @param {{pages: Array}} before  parsed file (or null for a new file)
 * @param {{pages: Array}} after   parsed file (or null for a deleted file)
 * @returns Array<{ page:{id,name}, kinds:string[], cellIds:string[], bbox, summary, byKind }>
 */
export function diffFiles(before, after) {
  const oldPages = new Map((before?.pages ?? []).map((p) => [p.id, p]));
  const newPages = new Map((after?.pages ?? []).map((p) => [p.id, p]));
  const ids = [...new Set([...newPages.keys(), ...oldPages.keys()])];
  const out = [];
  for (const id of ids) {
    const o = oldPages.get(id);
    const n = newPages.get(id);
    const d = diffPage(o?.cells ?? new Map(), n?.cells ?? new Map());
    if (d.cellIds.length === 0) continue;
    const page = n ?? o;
    out.push({ page: { id: page.id, name: page.name }, ...d });
  }
  return out;
}

export function diffPage(oldCells, newCells) {
  const byKind = { added: [], removed: [], moved: [], text: [], style: [] };
  for (const [id, n] of newCells) {
    const o = oldCells.get(id);
    if (!o) byKind.added.push(id);
    else for (const k of cellKinds(o, n)) byKind[k].push(id);
  }
  for (const id of oldCells.keys()) if (!newCells.has(id)) byKind.removed.push(id);

  const kinds = KIND_ORDER.filter((k) => byKind[k].length);
  const cellIds = [...new Set(KIND_ORDER.flatMap((k) => byKind[k]))];
  const boxes = [];
  for (const id of cellIds) {
    const b = absBox(newCells.has(id) ? newCells : oldCells, id);
    if (b) boxes.push(b);
    // A moved cell: include where it was too, so the view can frame both.
    if (byKind.moved.includes(id)) {
      const ob = absBox(oldCells, id);
      if (ob) boxes.push(ob);
    }
  }
  return { kinds, cellIds, bbox: union(boxes), summary: summarize(byKind), byKind };
}

function summarize(byKind) {
  return KIND_ORDER.filter((k) => byKind[k].length)
    .map((k) => `${byKind[k].length}개 ${KIND_WORD[k]}`)
    .join(', ');
}

/** Absolute box of a cell (vertex geometry plus parent offsets; edges via endpoints/points). */
export function absBox(cells, id, depth = 0) {
  const c = cells.get(id);
  if (!c || depth > 50) return null;
  const g = c.geometry;
  if (c.edge) {
    const off = parentOffset(cells, c.parent, depth);
    const boxes = [];
    for (const end of [c.source, c.target]) {
      const b = end ? absBox(cells, end, depth + 1) : null;
      if (b) boxes.push(b);
    }
    for (const [x, y] of g?.points ?? []) boxes.push({ x: x + off.x, y: y + off.y, w: 0, h: 0 });
    return union(boxes);
  }
  if (!g || g.relative) return null;
  const off = parentOffset(cells, c.parent, depth);
  return { x: g.x + off.x, y: g.y + off.y, w: g.width, h: g.height };
}

function parentOffset(cells, parentId, depth) {
  const p = parentId ? cells.get(parentId) : null;
  if (!p || !p.vertex || !p.geometry || p.geometry.relative) return { x: 0, y: 0 };
  const b = absBox(cells, p.id, depth + 1);
  return b ? { x: b.x, y: b.y } : { x: 0, y: 0 };
}

function union(boxes) {
  if (boxes.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
