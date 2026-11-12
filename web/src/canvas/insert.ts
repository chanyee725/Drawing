// The canvas `/` insert menu, without DOM or Excalidraw: what can be inserted and where it goes.
import { DIAGRAM_TYPES, TEMPLATES, type DiagramType } from '../dsl/templates.ts';
import { filterSlash } from '../doc/model.ts';

export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'text' | 'frame';
export type InsertItem =
  | { id: string; kind: 'diagram'; diagramType: DiagramType; title: string; hint: string; keywords: string[] }
  | { id: string; kind: ShapeKind; title: string; hint: string; keywords: string[] };

const DIAGRAM_KEYWORDS: Record<DiagramType, string[]> = {
  architecture: ['architecture', 'cloud', 'aws', 'infra', '아키텍처', '클라우드'],
  flowchart: ['flowchart', 'flow', '플로우', '흐름'],
  sequence: ['sequence', '시퀀스', '순서'],
  erd: ['erd', 'entity', 'database', 'db', '테이블'],
  bpmn: ['bpmn', 'process', '프로세스'],
};

const SHAPES: InsertItem[] = [
  { id: 'rectangle', kind: 'rectangle', title: '사각형', hint: '도형', keywords: ['rectangle', 'box', 'shape', '사각형', '네모', '도형'] },
  { id: 'ellipse', kind: 'ellipse', title: '원', hint: '도형', keywords: ['ellipse', 'circle', 'oval', 'shape', '원', '타원', '도형'] },
  { id: 'diamond', kind: 'diamond', title: '마름모', hint: '도형', keywords: ['diamond', 'decision', 'shape', '마름모', '도형'] },
  { id: 'arrow', kind: 'arrow', title: '화살표', hint: '선', keywords: ['arrow', 'connector', '화살표', '선'] },
  { id: 'line', kind: 'line', title: '선', hint: '선', keywords: ['line', 'divider', '선', '구분선'] },
  { id: 'text', kind: 'text', title: '텍스트', hint: '글자', keywords: ['text', 'label', 'textbox', '텍스트', '글자', '글'] },
  { id: 'frame', kind: 'frame', title: '프레임', hint: '묶음', keywords: ['frame', 'figure', 'group', 'container', '프레임', '묶음'] },
];

/** Everything the menu offers: diagram blocks first (one per type, starting from its example), then shapes, text and frame. */
export const INSERT_ITEMS: InsertItem[] = [
  ...DIAGRAM_TYPES.map(
    (t): InsertItem => ({ id: `diagram:${t.id}`, kind: 'diagram', diagramType: t.id, title: `${t.label} 다이어그램`, hint: '코드로 그려요', keywords: ['diagram', 'code', '다이어그램', '코드', ...DIAGRAM_KEYWORDS[t.id]] }),
  ),
  ...SHAPES,
];

export const filterInsert = (query: string, items: readonly InsertItem[] = INSERT_ITEMS) => filterSlash(items, query);

export type Point = { x: number; y: number };

/** Default size of each inserted shape, in scene units. */
export const SHAPE_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 160, height: 80 },
  ellipse: { width: 160, height: 100 },
  diamond: { width: 160, height: 120 },
  arrow: { width: 200, height: 0 },
  line: { width: 200, height: 0 },
  text: { width: 0, height: 0 },
  frame: { width: 480, height: 320 },
};

/** Top-left corner that centres a w × h box on `c`, rounded so stored coordinates stay short. */
export const centeredAt = (c: Point, w: number, h: number): Point => ({ x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) });

/**
 * The Excalidraw element skeleton (for convertToExcalidrawElements) of a shape centred on `c`.
 * Plain data: the caller turns it into real elements.
 */
export function shapeSkeleton(kind: ShapeKind, c: Point): Record<string, unknown> {
  const { width, height } = SHAPE_SIZE[kind];
  const at = centeredAt(c, width, height);
  switch (kind) {
    case 'arrow':
    case 'line':
      return { type: kind, ...at, width, height, points: [[0, 0], [width, 0]] };
    case 'text':
      // Text measures itself; start it a little left of the point so it reads as centred.
      return { type: 'text', x: Math.round(c.x - 30), y: Math.round(c.y - 12), text: '텍스트' };
    case 'frame':
      return { type: 'frame', ...at, width, height, children: [], name: '프레임' };
    default:
      return { type: kind, ...at, width, height };
  }
}

/** A new diagram block of `type`, its picture (`size`) centred on `c`. Without a size it stays unplaced and the canvas places it. */
export function diagramBlock(id: string, type: DiagramType, c: Point, size: { width: number; height: number } | null) {
  const code = TEMPLATES[type];
  if (!size || !(size.width > 0 && size.height > 0)) return { id, type, code, x: 0, y: 0, w: 0, h: 0 };
  return { id, type, code, ...centeredAt(c, size.width, size.height), w: Math.round(size.width), h: Math.round(size.height) };
}
