// PDF export without a library: the browser's own print dialog ("Save as PDF"). Nothing leaves the machine.

export const PRINT_DOC_CLASS = 'print-doc';
export const PRINT_HINT = "인쇄 창에서 '대상'을 'PDF로 저장'으로 골라 주세요";

/** Print only the document column (embedded diagrams included); the CSS in index.css hides everything else. */
export function printDocument(): string {
  const root = document.documentElement;
  root.classList.add(PRINT_DOC_CLASS);
  const done = () => root.classList.remove(PRINT_DOC_CLASS);
  window.addEventListener('afterprint', done, { once: true });
  try {
    window.print();
  } finally {
    // print() blocks while the dialog is open in most browsers; either way, do not leave the page in print mode.
    done();
  }
  return PRINT_HINT;
}

const escapeTitle = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Print one SVG picture from a hidden iframe (a data-free srcdoc, no requests). */
export async function printSvg(svg: string, title = ''): Promise<string> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-print-frame', '');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;height:800px;border:0;visibility:hidden';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeTitle(title)}</title><style>@page{margin:10mm}html,body{margin:0;background:#fff}svg{display:block;max-width:100%;max-height:270mm;height:auto;margin:0 auto}</style></head><body>${svg}</body></html>`;
  await new Promise<void>((ok) => {
    frame.onload = () => ok();
    document.body.appendChild(frame);
  });
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    throw new Error('인쇄를 준비하지 못했어요');
  }
  const cleanup = () => frame.remove();
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 120_000);
  win.focus();
  win.print();
  return PRINT_HINT;
}
