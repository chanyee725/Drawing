// Sharp diagram blocks at any zoom and screen scale.
//
// A block is an Excalidraw image of an SVG. Excalidraw draws it with the source-rect form of drawImage,
// and Chrome's accelerated canvas rasterizes an SVG drawn that way at its intrinsic size (the root
// width/height) and then resamples the bitmap. Shown much bigger it blurs; shown much smaller the
// default (bilinear, no mipmaps) smoothing skips thin strokes, so "HTTPS" reads "IITTPS".
//
// So each block gets variants of its picture whose intrinsic size is a power of two times its own
// (viewBox unchanged, so the drawing is the same), and the canvas shows the one closest above the
// pixels the block covers on screen. The resample is then always a shrink by less than 2: sharp.

/** Smallest and largest variant factors. */
export const MIN_SCALE = 1 / 8;
export const MAX_SCALE = 4;
/** Keep a variant's bitmap under this many pixels (Excalidraw caps element canvases at the same). */
const MAX_AREA = 16_777_216;

/**
 * Variant factor for a picture `w`×`h` (its own units) shown at `pixelsPerUnit` device pixels per unit
 * (block scale × zoom × devicePixelRatio): the power of two at or above it, within the limits.
 */
export function pictureScale(pixelsPerUnit: number, w: number, h: number): number {
  if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit)) return 1;
  let k = 2 ** Math.ceil(Math.log2(pixelsPerUnit) - 1e-9);
  k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
  while (k > MIN_SCALE && w * h * k * k > MAX_AREA) k /= 2;
  return k;
}

// Excalidraw's SVG export looks images up with `#image-<fileId>` as a CSS selector, so the id must stay a
// plain identifier: no "@" or ".". 2 → "--k2", 0.5 → "--k0p5".
const SEP = '--k';

/** File id of a picture's variant; factor 1 is the picture's own id. */
export const variantId = (fileId: string, k: number) => (k === 1 ? fileId : `${fileId}${SEP}${String(k).replace('.', 'p')}`);

/** The picture's own file id for a variant id (or for the picture's own id). */
export const baseFileId = (id: string) => {
  const i = id.indexOf(SEP);
  return i < 0 ? id : id.slice(0, i);
};

/** The SVG with its intrinsic size multiplied by `k`; the viewBox keeps the drawing the same. */
export function scaleSvg(svg: string, k: number): string {
  if (k === 1) return svg;
  const end = svg.indexOf('>');
  if (end < 0) return svg;
  const head = svg
    .slice(0, end)
    .replace(/\swidth="([\d.]+)"/, (_, v) => ` width="${+(Number(v) * k).toFixed(3)}"`)
    .replace(/\sheight="([\d.]+)"/, (_, v) => ` height="${+(Number(v) * k).toFixed(3)}"`);
  return head + svg.slice(end);
}

export const svgDataURL = (svg: string) => {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
};

type ImageLike = { type: string; fileId?: string | null; width: number; height: number };
type PictureLike = { fileId: string; width: number; height: number };

/**
 * Elements for an export at `exportScale`: each block image shows the picture variant sharp at that scale,
 * not the one picked for the current view (a zoomed-out view shows a small variant). Images of unknown
 * pictures are left alone. Returns the elements and the variants they need (`k` per picture).
 */
export function exportVariants<E extends ImageLike>(
  elements: readonly E[],
  exportScale: number,
  pictureOf: (baseId: string) => PictureLike | undefined,
): { elements: E[]; need: { picture: PictureLike; k: number }[] } {
  const need = new Map<string, { picture: PictureLike; k: number }>();
  const out = elements.map((el) => {
    if (el.type !== 'image' || !el.fileId) return el;
    const p = pictureOf(baseFileId(el.fileId));
    if (!p) return el;
    const k = pictureScale(Math.max(Math.abs(el.width) / p.width, Math.abs(el.height) / p.height) * exportScale, p.width, p.height);
    const id = variantId(p.fileId, k);
    need.set(id, { picture: p, k });
    return id === el.fileId ? el : { ...el, fileId: id };
  });
  return { elements: out, need: [...need.values()] };
}
