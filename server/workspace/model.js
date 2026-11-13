// File model for one `*.dpx.json` file. Top-level sections are independent
// (document / canvas / blocks) so each can later map onto its own Yjs shared
// type (Y.XmlFragment / Y.Array / Y.Array) without changing the file shape.

// Block `layout` rules are shared with the web (a higher sub-format `v` is kept verbatim).
import { cleanLayout, layoutProblem } from '../../shared/render/block-layout.ts';
// Pipeline `plan` rules are shared with the web (a higher `plan.v` is kept verbatim).
import { cleanPlan, planProblem } from '../../shared/dispatch/plan.ts';

export const FILE_EXT = '.dpx.json';
// 1: before the document editor (E6). 2: `document` is the editor's own content. Every write stores
// the current version; reads report the version the file was written with, so the web can tell
// a file it has never opened with the document editor (and fill its document once).
// 3: blocks may carry `layout` (node position overrides); an older server would drop it, so it must
// treat v3 files as read-only.
// 4: an optional top-level `plan` (pipeline steps, docs/design/dispatch-integration/2-file-format-and-live-overlay.md §3).
export const FORMAT_VERSION = 4;

export const emptyDocument = () => ({ type: 'doc', content: [] });
export const emptyCanvas = () => ({ elements: [], appState: {} });

export class ValidationError extends Error {}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function newFile({ title = '' } = {}) {
  return {
    version: FORMAT_VERSION,
    title,
    document: emptyDocument(),
    canvas: emptyCanvas(),
    blocks: [],
    revision: 1,
  };
}

function normalizeLayout(l, at) {
  const problem = layoutProblem(l, at);
  if (problem) throw new ValidationError(problem);
  return cleanLayout(l);
}

function normalizeBlock(b, i, lenient) {
  if (!isObj(b)) throw new ValidationError(`blocks[${i}] must be an object`);
  if (typeof b.id !== 'string' || !b.id) throw new ValidationError(`blocks[${i}].id must be a non-empty string`);
  if (typeof b.type !== 'string' || !b.type) throw new ValidationError(`blocks[${i}].type must be a non-empty string`);
  if (typeof b.code !== 'string') throw new ValidationError(`blocks[${i}].code must be a string`);
  for (const k of ['x', 'y', 'w', 'h']) {
    if (typeof b[k] !== 'number' || !Number.isFinite(b[k])) throw new ValidationError(`blocks[${i}].${k} must be a number`);
  }
  const out = { id: b.id, type: b.type, code: b.code, x: b.x, y: b.y, w: b.w, h: b.h };
  if (b.layout !== undefined) {
    try {
      out.layout = normalizeLayout(b.layout, `blocks[${i}].layout`);
    } catch (e) {
      // On read, a broken layout (hand-edited file) only loses the moved positions, not the whole file.
      if (!lenient || !(e instanceof ValidationError)) throw e;
    }
  }
  // The frame the block's image sits in (Excalidraw frame element id). Absent or null: in no frame.
  if (b.frameId !== undefined && b.frameId !== null) {
    if (typeof b.frameId === 'string' && b.frameId && b.frameId.length <= 200) out.frameId = b.frameId;
    else if (!lenient) throw new ValidationError(`blocks[${i}].frameId must be a non-empty string of at most 200 characters or null`);
  }
  return out;
}

/** Validate a `plan` section; throws ValidationError. */
export function normalizePlan(p, at = 'plan') {
  const problem = planProblem(p, at);
  if (problem) throw new ValidationError(problem);
  return cleanPlan(p);
}

/** Validate client content (everything except `revision`, which the store owns). Missing sections get defaults. */
export function normalizeContent(input, { lenient = false } = {}) {
  if (!isObj(input)) throw new ValidationError('body must be a JSON object');
  const title = input.title ?? '';
  if (typeof title !== 'string') throw new ValidationError('title must be a string');
  const document = input.document ?? emptyDocument();
  if (!isObj(document)) throw new ValidationError('document must be an object');
  const canvas = input.canvas ?? emptyCanvas();
  if (!isObj(canvas)) throw new ValidationError('canvas must be an object');
  const elements = canvas.elements ?? [];
  const appState = canvas.appState ?? {};
  if (!Array.isArray(elements)) throw new ValidationError('canvas.elements must be an array');
  if (!isObj(appState)) throw new ValidationError('canvas.appState must be an object');
  const blocks = input.blocks ?? [];
  if (!Array.isArray(blocks)) throw new ValidationError('blocks must be an array');
  const seen = new Set();
  const outBlocks = blocks.map((b, i) => {
    const nb = normalizeBlock(b, i, lenient);
    if (seen.has(nb.id)) throw new ValidationError(`duplicate block id "${nb.id}"`);
    seen.add(nb.id);
    return nb;
  });
  const out = { version: FORMAT_VERSION, title, document, canvas: { elements, appState }, blocks: outBlocks };
  if (input.plan !== undefined && input.plan !== null) {
    try {
      out.plan = normalizePlan(input.plan);
    } catch (e) {
      // On read, a broken plan (hand-edited file) is left out so the drawing still opens.
      if (!lenient || !(e instanceof ValidationError)) throw e;
    }
  }
  return out;
}

/** Parse a file from disk; throws ValidationError when it is not a usable dpx file. */
export function parseStored(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValidationError('file is not valid JSON');
  }
  const content = normalizeContent(raw, { lenient: true });
  const v = raw.version;
  const version = Number.isInteger(v) && v >= 1 ? v : 1;
  const revision = raw.revision;
  if (!Number.isInteger(revision) || revision < 1) throw new ValidationError('file has no valid revision');
  return { ...content, version, revision };
}
