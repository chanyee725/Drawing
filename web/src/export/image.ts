// Browser side of export: SVG text → PNG, download, copy to the clipboard. Everything stays local
// (data URLs and blobs only, no network).

/** Draw SVG text onto a canvas at `scale`× its size and return a PNG on a white (or given) background. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2, background: string | null = '#ffffff'): Promise<Blob> {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error('이미지를 만들지 못했어요'));
    img.src = `data:image/svg+xml;base64,${btoa(bin)}`;
  });
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('이미지를 만들지 못했어요');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('이미지를 만들지 못했어요'))), 'image/png'));
}

/** Save a blob through the browser's download (no server involved). */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const svgBlob = (svg: string) => new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });

export async function copyPng(blob: Blob) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('이 브라우저에서는 이미지를 복사할 수 없어요');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Size from the root <svg> element's width/height (falls back to the viewBox). */
export function svgSize(svg: string): { width: number; height: number } {
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  let w = parseFloat(el.getAttribute('width') ?? '');
  let h = parseFloat(el.getAttribute('height') ?? '');
  if (!(w > 0 && h > 0)) {
    const vb = (el.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    w = vb[2] || 300;
    h = vb[3] || 150;
  }
  return { width: w, height: h };
}
