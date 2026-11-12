// Render a diagram block to an SVG data URL for the canvas (E3 renderer).
import { renderDiagram } from '../../../shared/render/index.ts';
import { analyzeDiagram } from '../dsl/adapter';
import { fileIdFor, type BlockLike } from './sync';

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

const cache = new Map<string, Promise<BlockPicture>>();

/** Render once per (block id, type, code, theme); later calls reuse the result. Never rejects. */
export function renderBlock(b: BlockLike, theme: 'light' | 'dark'): Promise<BlockPicture> {
  const fileId = fileIdFor(b, theme);
  let p = cache.get(fileId);
  if (!p) {
    p = draw(b, theme).then((r) => ({ fileId, dataURL: toDataURL(r.svg), width: Math.max(MIN, r.width), height: Math.max(MIN, r.height) }));
    cache.set(fileId, p);
    // Keep the cache bounded: renders for old code are not needed again.
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return p;
}

async function draw(b: BlockLike, theme: 'light' | 'dark') {
  const a = analyzeDiagram(b.type, b.code);
  if (!a.ast) return placeholder('이 종류는 아직 그릴 수 없어요', theme);
  try {
    const { svg, scene } = await renderDiagram(a.ast, { theme });
    if (!scene.items.length) return placeholder(b.code.trim() ? '그릴 내용이 없어요. 코드를 확인해 주세요' : '코드를 입력하면 여기에 그려져요', theme);
    return { svg, width: scene.width, height: scene.height };
  } catch {
    return placeholder('그리지 못했어요. 코드를 확인해 주세요', theme);
  }
}
