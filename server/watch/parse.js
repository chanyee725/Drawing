// Parse a .drawio file into pages -> cells. Handles plain XML pages and the
// compressed form (<diagram> text = base64(deflateRaw(encodeURIComponent(xml)))).
import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { parseXml, findAll, findFirst } from './xml.js';

// Cap on file size and on inflated page size: a small compressed page must not
// expand into gigabytes (zip bomb). Larger files are treated as broken.
export const MAX_BYTES = 20 * 1024 * 1024;
const inflateRawAsync = promisify(inflateRaw);

export async function decompressDiagram(text) {
  const bytes = Buffer.from(text.trim(), 'base64');
  const inflated = (await inflateRawAsync(bytes, { maxOutputLength: MAX_BYTES })).toString('latin1');
  return decodeURIComponent(inflated);
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
    for (const [i, d] of diagrams.entries()) pages.push(await parsePage(src, d, i));
  } else {
    // A bare <mxGraphModel> file is one page.
    const model = findFirst(doc, 'mxGraphModel');
    if (!model) throw new Error('no mxfile or mxGraphModel');
    pages.push({ id: 'page-0', name: 'Page-1', ...modelToPage(src.slice(model.start, model.end), model) });
  }
  return { pages };
}

async function parsePage(src, diagram, index) {
  const id = diagram.attrs.id || `page-${index}`;
  const name = diagram.attrs.name || `Page-${index + 1}`;
  let model = findFirst(diagram, 'mxGraphModel');
  let xml;
  if (model) {
    xml = src.slice(model.start, model.end);
  } else if (diagram.text.trim()) {
    xml = await decompressDiagram(diagram.text);
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

