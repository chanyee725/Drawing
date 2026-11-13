// Read-only HTML of a stored document (version history preview), from the editor's own schema.
// Loaded on use, like the editor, so TipTap stays out of the first bundle.
import { generateHTML, getSchema } from '@tiptap/core';
import { docExtensions, documentError } from './extensions';

/**
 * The document as HTML, with each embedded diagram replaced by its picture from `pictures` (block id → SVG
 * from our own renderers) and each canvas frame by a short note. Null when the document does not fit the
 * schema (the caller shows it as text instead). `embedded` lists the block ids the document places, read from
 * the parsed figures rather than from the HTML string.
 */
export function versionHtml(document: unknown, pictures: ReadonlyMap<string, string>): { html: string; embedded: string[] } | null {
  const extensions = docExtensions();
  if (documentError(document, getSchema(extensions))) return null;
  // ProseMirror's serializer escapes text and attributes; a <template> keeps the result inert while we edit it.
  const tpl = window.document.createElement('template');
  try {
    tpl.innerHTML = generateHTML(document as never, extensions);
  } catch {
    return null;
  }
  const embedded: string[] = [];
  for (const fig of tpl.content.querySelectorAll<HTMLElement>('figure[data-diagram]')) {
    const id = fig.getAttribute('data-block-id') ?? '';
    embedded.push(id);
    const svg = pictures.get(id);
    if (svg) fig.innerHTML = svg;
    else fig.textContent = '다이어그램';
  }
  for (const fig of tpl.content.querySelectorAll<HTMLElement>('figure[data-frame-embed]')) {
    fig.textContent = `캔버스 프레임: ${fig.getAttribute('data-frame-name') || '이름 없음'}`;
  }
  return { html: tpl.innerHTML, embedded };
}
