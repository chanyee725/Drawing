// Render a diagram block to an SVG data URL for the canvas (E3 renderer via the E4 preview seam).
// Like the E4 preview, a block whose code has errors keeps showing its last good picture.
import { analyzeDiagram, nextPreview, renderPreview, type Preview, type RenderOutcome } from '../dsl/adapter.ts';
import { fileIdFor, hash, type BlockLike } from './sync.ts';

export type BlockPicture = { fileId: string; dataURL: string; width: number; height: number };

const MIN = 40;

const toDataURL = (svg: string) => {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
};

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
    p = renderPreview(b.type, b.code, theme);
    outcomes.set(key, p);
    // Keep the cache bounded: renders for old code are not needed again.
    if (outcomes.size > 200) outcomes.delete(outcomes.keys().next().value!);
  }
  return p;
}

function picture(blockId: string, r: { svg: string; width: number; height: number }): BlockPicture {
  const fileId = `blk_${blockId}_${hash(r.svg)}`;
  let p = pictures.get(fileId);
  if (!p) {
    p = { fileId, dataURL: toDataURL(r.svg), width: Math.max(MIN, r.width), height: Math.max(MIN, r.height) };
    pictures.set(fileId, p);
    if (pictures.size > 200) pictures.delete(pictures.keys().next().value!);
  }
  return p;
}

/**
 * The picture for a block's current code. Code with errors keeps the block's last good picture
 * (`nextPreview`); with none yet it shows a placeholder. Never rejects.
 */
export function renderBlock(b: BlockLike, theme: 'light' | 'dark'): Promise<BlockPicture> {
  const key = `${b.id}\n${theme}`;
  const run = (queue.get(key) ?? Promise.resolve())
    .then(() => draw(b, theme, key))
    .catch(() => placeholder('그리지 못했어요. 코드를 확인해 주세요', theme))
    .then((r) => picture(b.id, r));
  queue.set(key, run);
  return run;
}

async function draw(b: BlockLike, theme: 'light' | 'dark', key: string) {
  if (!analyzeDiagram(b.type, '').parsed) {
    shown.delete(key);
    return placeholder('이 종류는 아직 그릴 수 없어요', theme);
  }
  const state = nextPreview(shown.get(key) ?? null, await outcomeFor(b, theme), b.type, theme);
  shown.set(key, state);
  if (!state) return placeholder('그리지 못했어요. 코드를 확인해 주세요', theme);
  if (!state.scene.items.length) return placeholder(b.code.trim() ? '그릴 내용이 없어요. 코드를 확인해 주세요' : '코드를 입력하면 여기에 그려져요', theme);
  return { svg: state.svg, width: state.scene.width, height: state.scene.height };
}
