// Pure helpers for the document pane (no DOM, no editor): the stored document shape and the `/` menu list.
import type { Block } from '../api.ts';

export type DocJSON = { type: 'doc'; content?: DocNode[] };
export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; [k: string]: unknown };

/** Node name of an embedded canvas diagram in the document JSON. */
export const DIAGRAM_NODE = 'diagram';

const isDoc = (d: unknown): d is DocJSON => !!d && typeof d === 'object' && (d as { type?: unknown }).type === 'doc';

export const diagramNode = (blockId: string): DocNode => ({ type: DIAGRAM_NODE, attrs: { blockId } });

/**
 * The content to open the editor with. A file saved before the document editor existed has an empty
 * document; it showed every diagram block in the document pane, so it opens with one embed per block.
 */
export function initialDocument(document: unknown, blocks: readonly Pick<Block, 'id'>[]): DocJSON {
  const doc = isDoc(document) ? document : { type: 'doc' as const, content: [] };
  if (doc.content?.length || !blocks.length) return doc;
  return { type: 'doc', content: blocks.map((b) => diagramNode(b.id)) };
}

/** Block ids embedded anywhere in the document, in document order. */
export function embeddedBlockIds(document: unknown): string[] {
  const out: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === DIAGRAM_NODE && typeof n.attrs?.blockId === 'string') out.push(n.attrs.blockId);
    n.content?.forEach(walk);
  };
  if (isDoc(document)) document.content?.forEach(walk);
  return out;
}

export type SlashCommand = 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'task' | 'code' | 'table' | 'quote' | 'rule' | 'link' | 'diagram';
export type SlashItem = { id: string; command: SlashCommand; title: string; hint: string; keywords: string[]; blockId?: string };

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'h1', command: 'h1', title: '제목 1', hint: '# 공백', keywords: ['h1', 'heading', 'title', '제목', '헤딩'] },
  { id: 'h2', command: 'h2', title: '제목 2', hint: '## 공백', keywords: ['h2', 'heading', '제목', '헤딩'] },
  { id: 'h3', command: 'h3', title: '제목 3', hint: '### 공백', keywords: ['h3', 'heading', '제목', '헤딩'] },
  { id: 'bullet', command: 'bullet', title: '글머리 목록', hint: '- 공백', keywords: ['ul', 'list', 'bullet', '목록', '리스트'] },
  { id: 'ordered', command: 'ordered', title: '번호 목록', hint: '1. 공백', keywords: ['ol', 'list', 'number', 'ordered', '목록', '번호'] },
  { id: 'task', command: 'task', title: '체크리스트', hint: '[ ] 공백', keywords: ['todo', 'task', 'check', '체크', '할 일'] },
  { id: 'code', command: 'code', title: '코드 블록', hint: '``` 공백', keywords: ['code', 'pre', '코드'] },
  { id: 'table', command: 'table', title: '표', hint: '3 × 3', keywords: ['table', 'grid', '표', '테이블'] },
  { id: 'quote', command: 'quote', title: '인용', hint: '> 공백', keywords: ['quote', 'blockquote', '인용'] },
  { id: 'rule', command: 'rule', title: '구분선', hint: '---', keywords: ['hr', 'divider', 'rule', '구분선', '선'] },
  { id: 'link', command: 'link', title: '링크', hint: '주소 넣기', keywords: ['link', 'url', '링크'] },
  { id: 'diagram', command: 'diagram', title: '새 다이어그램', hint: '캔버스에도 생겨요', keywords: ['diagram', 'embed', 'figure', '다이어그램', '그림', '도표'] },
];

/** `/` menu entries for diagrams already on the canvas, so one can be embedded (again). */
export function blockItems(blocks: readonly Pick<Block, 'id' | 'type'>[], typeLabel: (type: string) => string): SlashItem[] {
  return blocks.map((b, i) => ({
    id: `embed:${b.id}`,
    command: 'diagram',
    title: `다이어그램 넣기: ${typeLabel(b.type)} ${i + 1}`,
    hint: '캔버스에 있는 것',
    keywords: ['diagram', 'embed', '다이어그램', b.type],
    blockId: b.id,
  }));
}

/** Items whose title or a keyword contains the typed query (case-insensitive); an empty query keeps all. */
export function filterSlash(items: readonly SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((it) => it.title.toLowerCase().includes(q) || it.keywords.some((k) => k.toLowerCase().includes(q)));
}

/** A typed link address made safe to store: web and mail links only; a bare host gets https://. */
export function normalizeLink(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(s)) return s;
  // Any other scheme (javascript:, data:, file:...) is refused.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d+(\/|$)/.test(s)) return null;
  return `https://${s}`;
}
