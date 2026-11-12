// Pure helpers for the document pane (no DOM, no editor): the stored document shape and the `/` menu list.
import type { Block } from '../api.ts';
import { findFreeSpot, isUnplaced, rectOf, type BlockGeom, type Rect } from '../canvas/sync.ts';

export type DocJSON = { type: 'doc'; content?: DocNode[] };
export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; [k: string]: unknown };

/** Node name of an embedded canvas diagram in the document JSON. */
export const DIAGRAM_NODE = 'diagram';

const isDoc = (d: unknown): d is DocJSON => !!d && typeof d === 'object' && (d as { type?: unknown }).type === 'doc';

/** Node name of an embedded canvas frame (its content, drawn read-only) in the document JSON. */
export const FRAME_NODE = 'frameEmbed';

export const frameNode = (frameId: string, name: string): DocNode => ({ type: FRAME_NODE, attrs: { frameId, name } });

/** The part of an Excalidraw element the frame helpers read. */
export type CanvasEl = { id: string; type: string; name?: string | null; frameId?: string | null; containerId?: string | null; isDeleted?: boolean; version?: number; x?: number; y?: number; width?: number; height?: number };

const liveElements = (canvas: unknown): CanvasEl[] => {
  const els = (canvas as { elements?: unknown } | null | undefined)?.elements;
  return Array.isArray(els) ? (els as CanvasEl[]).filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && !e.isDeleted) : [];
};

export type FrameInfo = { id: string; name: string; /** False for an unnamed frame, whose name is its number ("프레임 2"). */ named: boolean };

/** Frames on the canvas, in canvas order. An unnamed frame is numbered by its place among the frames: 프레임 1, 프레임 2. */
export function framesOf(canvas: unknown): FrameInfo[] {
  return liveElements(canvas)
    .filter((e) => e.type === 'frame' || e.type === 'magicframe')
    .map((e, i) => {
      const name = typeof e.name === 'string' ? e.name.trim() : '';
      return name ? { id: e.id, name, named: true } : { id: e.id, name: `프레임 ${i + 1}`, named: false };
    });
}

/** A frame as the document calls it: a given name reads "프레임 구조도", a numbered one stays "프레임 2". */
export const frameLabel = (f: { name: string; named: boolean }) => (f.named ? `프레임 ${f.name}` : f.name);

type Placed = { x: number; y: number; w: number; h: number };
type FrameBox = { x: number; y: number; width: number; height: number };

/** Blocks whose centre lies inside the frame: the diagram blocks a frame on the canvas holds (they are not in `canvas.elements`). */
export function blocksInFrame<B extends Placed>(frame: FrameBox, blocks: readonly B[]): B[] {
  return blocks.filter((b) => {
    if (!(b.w > 0 && b.h > 0)) return false;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height;
  });
}

/** What a frame preview needs: the frame, what sits in it, and the text bound to those (a new array each call; callers compare with `frameSceneSig`). */
export function frameScene<E extends CanvasEl>(elements: readonly E[]): E[] {
  const live = elements.filter((e) => e && !e.isDeleted);
  const frames = new Set(live.filter((e) => e.type === 'frame' || e.type === 'magicframe').map((e) => e.id));
  const inside = new Set(live.filter((e) => e.frameId && frames.has(e.frameId)).map((e) => e.id));
  return live.filter((e) => frames.has(e.id) || inside.has(e.id) || (e.containerId && inside.has(e.containerId)));
}

/** Changes whenever something a frame preview shows changes. */
export const frameSceneSig = (scene: readonly CanvasEl[]) => scene.map((e) => `${e.id}:${e.version ?? 0}`).join(',');

/** Where an embedded frame stands now: its current name (a rename follows), or gone. */
export function resolveFrame(frames: readonly FrameInfo[], frameId: string): { name: string; named: boolean } | null {
  const f = frames.find((x) => x.id === frameId);
  return f ? { name: f.name, named: f.named } : null;
}

/** `/` menu entries for frames on the canvas. */
export function frameItems(frames: readonly FrameInfo[]): SlashItem[] {
  return frames.map((f) => ({ id: `frame:${f.id}`, command: 'frame', title: `프레임 넣기: ${f.name}`, hint: '캔버스에 있는 것', keywords: ['frame', 'figure', 'embed', '프레임', '그림', f.name], frameId: f.id, frameName: f.named ? f.name : '' }));
}

export const diagramNode = (blockId: string): DocNode => ({ type: DIAGRAM_NODE, attrs: { blockId } });

/** Files written with this format version or later already have their own document (see server/workspace/model.js). */
export const DOC_FORMAT_VERSION = 2;

/** Why a stored document cannot be opened as is, or null when its outer shape is fine. Nodes are checked against the schema separately. */
export function docShapeProblem(document: unknown): string | null {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return 'not an object';
  const d = document as { type?: unknown; content?: unknown };
  if (d.type !== 'doc') return 'type is not "doc"';
  if (d.content !== undefined && !Array.isArray(d.content)) return 'content is not an array';
  return null;
}

/** A document with no content at all (new files start like this). */
export const isEmptyDoc = (document: unknown) => !docShapeProblem(document) && !(document as DocJSON).content?.length;

/**
 * The document as the editor should start it: ending in a paragraph. StarterKit's TrailingNode adds that
 * paragraph on the editor's first transaction otherwise (the focus of the first click), and a click on a
 * diagram at the end then selects it in the document from before that insert: ProseMirror throws
 * "Selection passed to setSelection must point at the current document". Other documents come back unchanged.
 */
export function withTrailingParagraph(document: unknown): unknown {
  if (docShapeProblem(document)) return document;
  const content = (document as DocJSON).content ?? [];
  if (!content.length || content[content.length - 1].type === 'paragraph') return document;
  return { ...(document as DocJSON), content: [...content, { type: 'paragraph' }] };
}

/**
 * The document of a file written before the document editor existed (version < 2). Back then the
 * document pane listed every diagram block, so an empty document gets one embed per block. This
 * happens once: the next save stores the current format version and the document as it is then. Anything else,
 * including a broken document, comes back unchanged.
 */
export function migrateDocument(file: { version?: number; document: unknown; blocks: readonly Pick<Block, 'id'>[] }): unknown {
  if ((file.version ?? 1) >= DOC_FORMAT_VERSION || docShapeProblem(file.document) || !file.blocks.length) return file.document;
  if ((file.document as DocJSON).content?.length) return file.document;
  return { type: 'doc', content: file.blocks.map((b) => diagramNode(b.id)) };
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

export type SlashCommand = 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'task' | 'code' | 'table' | 'quote' | 'rule' | 'link' | 'diagram' | 'frame';
export type SlashItem = { id: string; command: SlashCommand; title: string; hint: string; keywords: string[]; blockId?: string; frameId?: string; frameName?: string };

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
export function filterSlash<T extends Pick<SlashItem, 'title' | 'keywords'>>(items: readonly T[], query: string): T[] {
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

/**
 * After an undo or redo in the document: blocks the document itself created (`created`, by id)
 * follow their embed. An undo that takes the embed away removes the block from the canvas too
 * (its latest state is kept in `created`); a redo that brings the embed back restores it. A redo
 * that takes an embed away (it redoes a delete done by hand) leaves the block alone, as that delete did.
 * Returns the new block list, or null when nothing changes.
 */
export function blocksAfterHistory(before: readonly string[], after: readonly string[], created: Map<string, Block>, blocks: readonly Block[], redo = false): Block[] | null {
  const was = new Set(before);
  const now = new Set(after);
  let next = [...blocks];
  let changed = false;
  for (const id of was) {
    if (redo || now.has(id) || !created.has(id)) continue;
    const b = next.find((x) => x.id === id);
    if (!b) continue;
    created.set(id, b);
    next = next.filter((x) => x.id !== id);
    changed = true;
  }
  for (const id of now) {
    if (was.has(id) || !created.has(id) || next.some((x) => x.id === id)) continue;
    next.push(created.get(id)!);
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Where a diagram made in the document goes on the canvas: the picture's size at a spot clear of
 * every placed block and drawing, decided right away so it never sits on top of another block,
 * even while the canvas is closed. Without a size yet it stays unplaced (w = 0) and the canvas places it.
 */
export function newBlockGeometry(size: { width: number; height: number } | null, blocks: readonly BlockGeom[], canvas: unknown): BlockGeom {
  if (!size) return { x: 0, y: 0, w: 0, h: 0 };
  const els = (canvas as { elements?: unknown } | null)?.elements;
  const taken: Rect[] = blocks.filter((b) => !isUnplaced(b)).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  if (Array.isArray(els))
    for (const e of els as { x?: unknown; y?: unknown; width?: unknown; height?: unknown; isDeleted?: unknown }[]) {
      if (!e || e.isDeleted || ![e.x, e.y, e.width, e.height].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
      taken.push(rectOf(e as { x: number; y: number; width: number; height: number }));
    }
  return { ...findFreeSpot(size.width, size.height, taken), w: size.width, h: size.height };
}
