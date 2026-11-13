// Render a diagram block to an SVG data URL for the canvas (E3 renderer via the E4 preview seam).
// Like the E4 preview, a block whose code has errors keeps showing its last good picture.
import { analyzeDiagram, nextPreview, renderPreview, type Preview, type RenderOutcome } from '../dsl/adapter.ts';
import type { ReconcileReason } from '../../../shared/render/overrides.ts';
import { BLOCK_LAYOUT_VERSION } from '../../../shared/render/block-layout.ts';
import type { Scene } from '../../../shared/render/scene.ts';
import { drawSig, fileIdFor, hash, type BlockLike, type OriginAnchor } from './sync.ts';
import { svgDataURL } from './resolution.ts';

export type BlockPicture = { fileId: string; dataURL: string; /** The picture as SVG text (for export). */ svg: string; width: number; height: number;
  /** Number of errors in the code that is drawn now; when above 0 the picture is the last good one (or a placeholder). */ errors: number;
  /** The picture is an earlier good one, kept because the current code could not be drawn. */ lastGood: boolean;
  /** The renderer itself failed (threw) on the current code. */ failed: boolean;
  /** Layout origin of a real drawing with the layout applied. Lets the canvas keep a moved layout still on screen (design §5.6). */
  anchor?: OriginAnchor;
  /** The code changed so much that the saved layout was left out of this picture (design §4.2). */ layoutReset?: ReconcileReason;
  /** The laid-out scene drawn in this picture (scene units = picture px), for the run overlay; absent for placeholders. */ scene?: Scene };

type Drawn = { svg: string; width: number; height: number; scene?: Scene; errors?: number; lastGood?: boolean; failed?: boolean; anchor?: OriginAnchor; layoutReset?: ReconcileReason };

const MIN = 40;
const MAX_PICTURES = 200;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function placeholder(message: string, theme: 'light' | 'dark') {
  const fg = theme === 'dark' ? '#a1a1aa' : '#71717a';
  const border = theme === 'dark' ? '#3f3f46' : '#d4d4d8';
  const w = 320;
  const h = 120;
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" fill="none" stroke="${border}" stroke-dasharray="6 4"/>` +
      `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="14" fill="${fg}">${esc(message)}</text></svg>`,
    width: w,
    height: h,
  };
}

// Render results per (block id, type, code, theme), so unchanged code is not drawn again.
const outcomes = new Map<string, Promise<RenderOutcome | null>>();
// What each block shows now (last good render, kept while the code has errors), by block id + theme.
const shown = new Map<string, Preview | null>();
// Per block + theme, renders are applied in call order so an older render never wins.
const queue = new Map<string, Promise<unknown>>();
const pictures = new Map<string, BlockPicture>();

function outcomeFor(b: BlockLike, theme: 'light' | 'dark') {
  const key = fileIdFor(b, theme);
  let p = outcomes.get(key);
  if (!p) {
    p = renderPreview(b.type, b.code, theme, b.layout);
    outcomes.set(key, p);
    // Keep the cache bounded: renders for old code are not needed again.
    if (outcomes.size > 200) outcomes.delete(outcomes.keys().next().value!);
  }
  return p;
}

function picture(blockId: string, r: Drawn): BlockPicture {
  const fileId = `blk_${blockId}_${hash(r.svg)}`;
  let p = pictures.get(fileId);
  if (!p) {
    p = { fileId, dataURL: svgDataURL(r.svg), svg: r.svg, width: Math.max(MIN, r.width), height: Math.max(MIN, r.height), errors: 0, lastGood: false, failed: false, ...(r.scene ? { scene: r.scene } : {}) };
    pictures.set(fileId, p);
    if (pictures.size > MAX_PICTURES) pictures.delete(pictures.keys().next().value!);
  }
  // The same picture can be shown for good code and, later, for broken code, with a layout left out or for other code
  // that draws the same (a comment edit): these belong to the call, not to the cached picture.
  const errors = r.errors ?? 0;
  const lastGood = r.lastGood ?? false;
  const failed = r.failed ?? false;
  const { layoutReset, anchor } = r;
  const same = errors === p.errors && lastGood === p.lastGood && failed === p.failed && layoutReset === p.layoutReset && sameAnchor(anchor, p.anchor);
  return same ? p : { ...p, errors, lastGood, failed, layoutReset, anchor };
}

/**
 * The picture for a block's current code. Code with errors keeps the block's last good picture
 * (`nextPreview`); with none yet it shows a placeholder. Never rejects.
 */
export function renderBlock(b: BlockLike, theme: 'light' | 'dark'): Promise<BlockPicture> {
  const key = `${b.id}\n${theme}`;
  const sig = drawSig(b);
  // Same drawing as the latest call (a drag or resize calls again with only the position changed): reuse it.
  const latest = latestCall.get(key);
  if (latest?.sig === sig) return latest.result;
  const run = (queue.get(key) ?? Promise.resolve())
    .then(() => draw(b, theme, key))
    // The renderer threw: say so on the canvas (failed) instead of showing an unexplained placeholder.
    .catch((): Drawn => ({ ...placeholder('그리지 못했어요. 코드를 확인해 주세요', theme), failed: true }))
    .then((r) => picture(b.id, r));
  queue.set(key, run);
  latestCall.set(key, { sig, result: run });
  // Never more entries than pictures, so a picture kept for a pending call is not the only thing holding it.
  if (latestCall.size > MAX_PICTURES) latestCall.delete(latestCall.keys().next().value!);
  return run;
}

// The latest call per block + theme, so a call with unchanged code does no work.
const latestCall = new Map<string, { sig: string; result: Promise<BlockPicture> }>();

const sameAnchor = (a: OriginAnchor | undefined, b: OriginAnchor | undefined) => a === b || (!!a && !!b && a.key === b.key && a.x === b.x && a.y === b.y);

async function draw(b: BlockLike, theme: 'light' | 'dark', key: string) {
  if (!analyzeDiagram(b.type, '').parsed) {
    shown.delete(key);
    return placeholder('이 종류는 아직 그릴 수 없어요', theme);
  }
  const outcome = await outcomeFor(b, theme);
  const state = nextPreview(shown.get(key) ?? null, outcome, b.type, theme);
  shown.set(key, state);
  if (!state) return { ...placeholder('그리지 못했어요. 코드를 확인해 주세요', theme), errors: outcome ? outcome.diagnostics.filter((d) => d.severity === 'error').length : 0, failed: !outcome };
  if (!state.scene.items.length) return placeholder(b.code.trim() ? '그릴 내용이 없어요. 코드를 확인해 주세요' : '코드를 입력하면 여기에 그려져요', theme);
  const reset = state.stale ? undefined : outcome?.reset;
  // Only a fresh drawing of this code with its layout applied (or none) can anchor a block shift; a layout of an
  // unknown version is not drawn, so it anchors nothing either.
  const applied = !state.stale && !state.failed && !reset && (!b.layout || b.layout.v === BLOCK_LAYOUT_VERSION);
  const o = state.scene.origin;
  const anchor = applied && o ? { key: hash(`${theme}\n${b.type}\n${b.code}`), x: o.x, y: o.y } : undefined;
  return { svg: state.svg, width: state.scene.width, height: state.scene.height, scene: state.scene, errors: state.errors.length, lastGood: state.stale, failed: state.failed, anchor, layoutReset: reset };
}
