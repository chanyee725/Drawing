// Parse a .drawio file into pages -> cells. Handles plain XML pages and the
// compressed form (<diagram> text = base64(deflateRaw(encodeURIComponent(xml)))).
import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { parseXml, findAll, findFirst } from './xml.js';

// Cap on file size and on the total inflated size of all pages in one file: a
// small compressed file must not expand into gigabytes (zip bomb), whether in one
// page or spread over many. Over the cap the file is treated as broken.
export const MAX_BYTES = 20 * 1024 * 1024;
const inflateRawAsync = promisify(inflateRaw);

/** budget = { left: bytes } shared by all pages of one file; decremented here. */
export async function decompressDiagram(text, budget = { left: MAX_BYTES }) {
  if (budget.left <= 0) throw new RangeError('inflate budget exhausted');
  const bytes = Buffer.from(text.trim(), 'base64');
  const out = await inflateRawAsync(bytes, { maxOutputLength: budget.left });
  budget.left -= out.length;
  return decodeURIComponent(out.toString('latin1'));
}

/**
 * @returns {{ pages: Array<{ id: string, name: string, xml: string, cells: Map<string, Cell> }> }}
 * Cell = { id, parent, value, style, vertex, edge, source, target, geometry: {x,y,width,height,points}|null }
 * Throws if the file is not (yet) well-formed.
 */
export async function parseDrawio(src) {
  const doc = parseXml(src);
  const mxfile = findFirst(doc, 'mxfile');
  const pages = [];
  if (mxfile) {
    const diagrams = mxfile.children.filter((c) => c.name === 'diagram');
    const budget = { left: MAX_BYTES };
    for (const [i, d] of diagrams.entries()) pages.push(await parsePage(src, d, i, budget));
  } else {
    // A bare <mxGraphModel> file is one page.
    const model = findFirst(doc, 'mxGraphModel');
    if (!model) throw new Error('no mxfile or mxGraphModel');
    pages.push({ id: 'page-0', name: 'Page-1', ...modelToPage(src.slice(model.start, model.end), model) });
  }
  return { pages };
}

async function parsePage(src, diagram, index, budget) {
  const id = diagram.attrs.id || `page-${index}`;
  const name = diagram.attrs.name || `Page-${index + 1}`;
  let model = findFirst(diagram, 'mxGraphModel');
  let xml;
  if (model) {
    xml = src.slice(model.start, model.end);
  } else if (diagram.text.trim()) {
    xml = await decompressDiagram(diagram.text, budget);
    model = findFirst(parseXml(xml), 'mxGraphModel');
    if (!model) throw new Error('compressed diagram without mxGraphModel');
  } else {
    return { id, name, xml: '', cells: new Map() };
  }
  return { id, name, ...modelToPage(xml, model) };
}

function modelToPage(xml, model) {
  const cells = new Map();
  const root = findFirst(model, 'root');
  if (!root) return { xml, cells };
  for (const el of root.children) {
    let cellEl = el;
    let value;
    let id = el.attrs.id;
    if (el.name === 'UserObject' || el.name === 'object') {
      cellEl = el.children.find((c) => c.name === 'mxCell') ?? { attrs: {}, children: [] };
      value = el.attrs.label ?? '';
    } else if (el.name !== 'mxCell') continue;
    if (!id) continue;
    const a = cellEl.attrs;
    cells.set(id, {
      id,
      parent: a.parent ?? null,
      value: value ?? a.value ?? '',
      style: a.style ?? '',
      vertex: a.vertex === '1',
      edge: a.edge === '1',
      source: a.source ?? null,
      target: a.target ?? null,
      geometry: readGeometry(cellEl),
    });
  }
  return { xml, cells };
}

function readGeometry(cellEl) {
  const g = cellEl.children.find((c) => c.name === 'mxGeometry');
  if (!g) return null;
  const num = (v) => (v === undefined ? 0 : Number(v) || 0);
  const pts = findAll(g, 'mxPoint')
    .filter((p) => !p.attrs.as)
    .map((p) => [num(p.attrs.x), num(p.attrs.y)]);
  return {
    x: num(g.attrs.x),
    y: num(g.attrs.y),
    width: num(g.attrs.width),
    height: num(g.attrs.height),
    relative: g.attrs.relative === '1',
    points: pts,
  };
}

