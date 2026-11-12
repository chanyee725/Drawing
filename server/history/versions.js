// Recorded versions: for every watch change, keep the changed page's XML after the
// change, so any entry can be shown again with its diff (and replayed in order).
// Memory: one page XML string per change, shared by reference with the next
// change's "before"; a global character budget drops the oldest snapshots first.
import { parseDrawio } from '../watch/parse.js';
import { diffPage, absBox } from '../watch/diff.js';

export const VERSION_LIMIT = 500; // per file, same as watch history
export const SNAPSHOT_BUDGET = 48 * 1024 * 1024; // characters across all files

const KIND_ORDER = ['added', 'removed', 'moved', 'text', 'style'];

/**
 * @param {{ getParsed(id: string): { pages: Array<{id,name,xml}> } | null,
 *           agentFor?(dir: string): { name: string, role: string } | null,
 *           budget?: number, limit?: number }} opts
 */
export function createVersionStore({ getParsed, agentFor = () => null, budget = SNAPSHOT_BUDGET, limit = VERSION_LIMIT }) {
  const files = new Map(); // fileId -> { seq, pages: Map<pageId, xml>, versions: Version[] }
  let order = []; // versions in record order, for the global budget
  let used = 0;
  let live = 0; // versions still holding a snapshot

  function fileState(id) {
    let f = files.get(id);
    if (!f) {
      f = { seq: 0, pages: new Map(), versions: [] };
      files.set(id, f);
    }
    return f;
  }

  /** Remember the current page XML of a file without recording a version (startup). */
  function baseline(id) {
    const f = fileState(id);
    for (const p of getParsed(id)?.pages ?? []) f.pages.set(p.id, p.xml);
  }

  /** Record one watch change (full change, with source.dir). Returns the version. */
  function record(change) {
    const f = fileState(change.fileId);
    const pageId = change.page?.id;
    const now = getParsed(change.fileId)?.pages.find((p) => p.id === pageId);
    const before = f.pages.get(pageId) ?? '';
    const after = now?.xml ?? '';
    if (now) f.pages.set(pageId, after);
    else f.pages.delete(pageId);
    const agent = agentFor(change.source?.dir);
    const v = {
      seq: ++f.seq,
      at: change.at,
      source: { kind: change.source?.kind, label: change.source?.label },
      agent: agent ? { name: String(agent.name ?? ''), role: String(agent.role ?? '') } : null,
      page: { id: pageId, name: change.page?.name ?? pageId },
      kinds: change.kinds ?? [],
      summary: change.summary ?? '',
      cellCount: change.cellIds?.length ?? 0,
      before,
      after,
      snapshot: true,
    };
    f.versions.push(v);
    used += after.length;
    live++;
    order.push(v);
    if (f.versions.length > limit) for (const old of f.versions.splice(0, f.versions.length - limit)) drop(old);
    while (used > budget && order.length) drop(order.shift());
    if (order.length > 2 * live + 64) order = order.filter((x) => x.snapshot);
    return v;
  }

  function drop(v) {
    if (!v.snapshot) return;
    used -= v.after.length;
    live--;
    v.before = v.after = null;
    v.snapshot = false;
  }

  /** Public list entry: no XML. */
  const entry = ({ before, after, ...v }) => v;

  return {
    baseline,
    record,
    list: (id) => (files.has(id) ? files.get(id).versions.map(entry) : null),
    get: (id, seq) => files.get(id)?.versions.find((v) => v.seq === seq) ?? null,
    get used() {
      return used;
    },
  };
}

const EMPTY = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

async function pageCells(xml) {
  if (!xml) return new Map();
  return (await parseDrawio(xml)).pages[0]?.cells ?? new Map();
}

/**
 * Cell-level highlight between two page XMLs.
 * @returns Array<{ id, kinds: string[], box: {x,y,w,h}|null }>  box in graph coords;
 *   a removed cell's box is where it was in `beforeXml`.
 */
export async function highlightCells(beforeXml, afterXml) {
  const [oldCells, newCells] = await Promise.all([pageCells(beforeXml), pageCells(afterXml)]);
  const { byKind } = diffPage(oldCells, newCells);
  const out = new Map();
  for (const k of KIND_ORDER) {
    const cells = k === 'removed' ? oldCells : newCells;
    for (const id of byKind[k]) {
      // Only drawn cells; the root/layer cells ("0", "1") have nothing to highlight.
      const cell = cells.get(id);
      if (!cell?.vertex && !cell?.edge) continue;
      const c = out.get(id) ?? { id, kinds: [], box: absBox(cells, id) };
      c.kinds.push(k);
      out.set(id, c);
    }
  }
  return [...out.values()];
}

export const emptyModel = (xml) => xml || EMPTY;
