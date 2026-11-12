// Pure helpers for the document outline, heading links and wikilinks (no DOM, no editor), so tests can load them in Node.
import type { Block } from '../api.ts';
import type { TreeNode } from '../api.ts';
import type { DocNode } from './model.ts';

export type OutlineItem = { id: string | null; level: number; text: string };

const textOf = (n: DocNode & { text?: string }): string => (typeof n.text === 'string' ? n.text : (n.content ?? []).map(textOf).join(''));

/** Headings of a stored document in order. `id` is null for a heading that has no link id yet. */
export function outlineOf(document: unknown): OutlineItem[] {
  const out: OutlineItem[] = [];
  const walk = (n: DocNode) => {
    if (n.type === 'heading') {
      const id = typeof n.attrs?.id === 'string' && n.attrs.id ? n.attrs.id : null;
      out.push({ id, level: Math.min(3, Math.max(1, Number(n.attrs?.level) || 1)), text: textOf(n).trim() });
      return;
    }
    n.content?.forEach(walk);
  };
  const d = document as { type?: unknown; content?: DocNode[] } | null;
  if (d && d.type === 'doc') d.content?.forEach(walk);
  return out;
}

export const newHeadingId = () => `h_${Math.random().toString(36).slice(2, 10)}`;

/** Heading ids that are missing or repeat an earlier one: the positions (by heading order) that need a new id. */
export function headingsNeedingId(ids: readonly (string | null)[]): number[] {
  const seen = new Set<string>();
  const need: number[] = [];
  ids.forEach((id, i) => {
    if (!id || seen.has(id)) need.push(i);
    else seen.add(id);
  });
  return need;
}

/** The URL hash that opens a file, and optionally jumps to one of its headings. */
export function buildHash(path: string, heading?: string | null): string {
  return `#file=${encodeURIComponent(path)}${heading ? `&h=${encodeURIComponent(heading)}` : ''}`;
}

/** Reads `#file=<path>[&h=<heading id>]`; null when the hash is not a file link. */
export function parseHash(hash: string): { path: string; heading: string | null } | null {
  const m = /^#file=([^&]+)(?:&h=([^&]+))?$/.exec(hash);
  if (!m) return null;
  try {
    return { path: decodeURIComponent(m[1]), heading: m[2] ? decodeURIComponent(m[2]) : null };
  } catch {
    return null;
  }
}

export type WikiKind = 'file' | 'heading' | 'figure';
export type WikiItem = { id: string; kind: WikiKind; target: string; title: string; hint: string; keywords: string[] };

/** Every file in the workspace tree, for `+`. Folders are walked; only files are offered. */
export function fileItems(tree: readonly TreeNode[]): WikiItem[] {
  const out: WikiItem[] = [];
  const walk = (nodes: readonly TreeNode[]) => {
    for (const n of nodes) {
      if (n.type === 'folder') walk(n.children);
      else out.push({ id: `file:${n.path}`, kind: 'file', target: n.path, title: n.title || n.name, hint: n.path, keywords: [n.name, n.path, 'file', '파일'] });
    }
  };
  walk(tree);
  return out;
}

/** Headings of the open file that already have an id (a link needs one). */
export function headingItems(outline: readonly OutlineItem[]): WikiItem[] {
  return outline
    .filter((h): h is OutlineItem & { id: string } => !!h.id && !!h.text)
    .map((h) => ({ id: `heading:${h.id}`, kind: 'heading', target: h.id, title: h.text, hint: `제목 ${h.level}`, keywords: ['heading', 'header', '제목'] }));
}

/** Diagrams of the open file. */
export function figureItems(blocks: readonly Pick<Block, 'id' | 'type'>[], typeLabel: (type: string) => string): WikiItem[] {
  return blocks.map((b, i) => ({ id: `figure:${b.id}`, kind: 'figure', target: b.id, title: `${typeLabel(b.type)} ${i + 1}`, hint: '다이어그램', keywords: ['figure', 'diagram', '다이어그램', b.type] }));
}

/** Items whose title, hint or a keyword contains the typed query (case-insensitive); an empty query keeps all. */
export function filterWiki(items: readonly WikiItem[], query: string): WikiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((it) => it.title.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q) || it.keywords.some((k) => k.toLowerCase().includes(q)));
}
