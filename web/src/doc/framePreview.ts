// A frame of the canvas drawn as a picture for the document (read-only). Excalidraw is loaded on first use.
import type { Block } from '../api';
import { renderBlock } from '../canvas/render';
import { blockPlacements, type CanvasEl } from './model';

export type FramePicture = { dataURL: string; width: number; height: number };

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The frame `frameId` with what sits in it, as an SVG data URL; null when the frame is not in `scene`.
 * Diagram blocks are not canvas elements, so those inside the frame (`blocks`) are drawn with `renderBlock`
 * and laid over the exported frame at their canvas position, clipped to the frame.
 */
export async function renderFrame(scene: readonly CanvasEl[], frameId: string, dark: boolean, blocks: readonly Block[] = []): Promise<FramePicture | null> {
  const frame = scene.find((e) => e.id === frameId && (e.type === 'frame' || e.type === 'magicframe'));
  if (!frame) return null;
  const { exportToSvg, restoreElements } = await import('@excalidraw/excalidraw');
  const elements = restoreElements(scene as never, null);
  const target = elements.find((e) => e.id === frameId);
  if (!target) return null;
  const svg = await exportToSvg({
    elements,
    appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: dark },
    files: {},
    exportPadding: 8,
    exportingFrame: target as never,
  });
  svg.setAttribute('xmlns', SVG_NS);
  const { x: fx = 0, y: fy = 0, width: fw = 0, height: fh = 0 } = target as { x?: number; y?: number; width?: number; height?: number };
  // A frame export carries no padding of its own (its picture is exactly the frame); read it off the size anyway.
  const pad = Math.max(0, (parseFloat(svg.getAttribute('width') ?? '0') - fw) / 2) || 0;
  const { clip: box, images } = blockPlacements({ x: fx, y: fy, width: fw, height: fh }, blocks, pad);
  if (images.length) {
    // Always the light picture: a dark export puts an invert filter on the whole SVG, which would invert a dark one twice.
    const pics = await Promise.all(images.map((b) => renderBlock(blocks.find((x) => x.id === b.id) as Block, 'light')));
    const clipId = `frame-clip-${frameId.replace(/[^\w-]/g, '_')}`;
    const clip = document.createElementNS(SVG_NS, 'clipPath');
    clip.setAttribute('id', clipId);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(box.x));
    rect.setAttribute('y', String(box.y));
    rect.setAttribute('width', String(box.width));
    rect.setAttribute('height', String(box.height));
    clip.appendChild(rect);
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('clip-path', `url(#${clipId})`);
    layer.setAttribute('data-frame-blocks', '');
    images.forEach((b, i) => {
      const img = document.createElementNS(SVG_NS, 'image');
      img.setAttribute('href', pics[i].dataURL);
      img.setAttribute('x', String(b.x));
      img.setAttribute('y', String(b.y));
      img.setAttribute('width', String(b.width));
      img.setAttribute('height', String(b.height));
      img.setAttribute('data-block-id', b.id);
      layer.appendChild(img);
    });
    svg.appendChild(clip);
    svg.appendChild(layer);
  }
  const width = parseFloat(svg.getAttribute('width') ?? '0');
  const height = parseFloat(svg.getAttribute('height') ?? '0');
  return { dataURL: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`, width, height };
}
