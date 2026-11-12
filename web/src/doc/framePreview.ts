// A frame of the canvas drawn as a picture for the document (read-only). Excalidraw is loaded on first use.
import type { CanvasEl } from './model';

export type FramePicture = { dataURL: string; width: number; height: number };

/** The frame `frameId` with what sits in it, as an SVG data URL; null when the frame is not in `scene`. */
export async function renderFrame(scene: readonly CanvasEl[], frameId: string, dark: boolean): Promise<FramePicture | null> {
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
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const width = parseFloat(svg.getAttribute('width') ?? '0');
  const height = parseFloat(svg.getAttribute('height') ?? '0');
  return { dataURL: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`, width, height };
}
