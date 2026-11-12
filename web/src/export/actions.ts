// The export actions behind the top bar menu, the palette, the shortcuts and the diagram buttons.
// Each resolves with a short Korean message for the status line and rejects with an Error whose message is shown as is.
import type { Block } from '../api';
import { download, copyPng, svgBlob, svgSize, svgToPng } from './image';
import { documentToMarkdown, exportName } from './markdown';
import { DEFAULT_EXPORT, exportBackground, exportSuffix, withSvgBackground, type ExportOptions } from './options';
import type { CanvasHandle } from './types';

export type ImageKind = 'svg' | 'png' | 'copy';

const NOTHING = '내보낼 내용이 없어요';

/** The canvas selection (or the whole canvas when nothing is selected). */
export async function exportCanvas(handle: CanvasHandle | null, kind: ImageKind, title: string, o: ExportOptions = DEFAULT_EXPORT): Promise<string> {
  if (!handle) throw new Error('캔버스를 연 뒤에 내보낼 수 있어요');
  const { selected } = handle.scope();
  const what = selected ? '선택한 것을' : '캔버스를';
  if (kind === 'svg') {
    const r = await handle.svg(o);
    if (!r) throw new Error(NOTHING);
    download(svgBlob(r.svg), exportName(title + exportSuffix(o, 'svg'), 'svg'));
    return `${what} SVG로 내보냈어요`;
  }
  const png = await handle.png(o);
  if (!png) throw new Error(NOTHING);
  if (kind === 'png') {
    download(png, exportName(title + exportSuffix(o, 'png'), 'png'));
    return `${what} PNG로 내보냈어요`;
  }
  await copyPng(png);
  return `${what} 이미지로 복사했어요`;
}

/** One diagram block, drawn as it looks now (a block with errors exports its last good picture). `title` is the file name stem. */
export async function exportBlock(block: Block, kind: ImageKind, title: string, o: ExportOptions = DEFAULT_EXPORT): Promise<string> {
  // Loaded on use: the renderer (ELK) is big and only needed once something is drawn.
  const { renderBlock } = await import('../canvas/render');
  const pic = await renderBlock(block, o.dark ? 'dark' : 'light');
  const { width, height } = svgSize(pic.svg);
  if (kind === 'svg') {
    // Without a background a dark export (light text) would vanish on a white page.
    download(svgBlob(withSvgBackground(pic.svg, exportBackground(o))), exportName(title + exportSuffix(o, 'svg'), 'svg'));
    return '다이어그램을 SVG로 내보냈어요';
  }
  const png = await svgToPng(pic.svg, width, height, o.scale, exportBackground(o));
  if (kind === 'png') {
    download(png, exportName(title + exportSuffix(o, 'png'), 'png'));
    return '다이어그램을 PNG로 내보냈어요';
  }
  await copyPng(png);
  return '다이어그램을 이미지로 복사했어요';
}

export function exportMarkdown(title: string, document: unknown, blocks: readonly Block[]): string {
  download(new Blob([documentToMarkdown(title, document, blocks)], { type: 'text/markdown;charset=utf-8' }), exportName(title, 'md'));
  return '문서를 Markdown으로 내보냈어요';
}
