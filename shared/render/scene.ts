// Scene: the laid-out diagram in absolute coordinates. Pure data, theme-independent, JSON-serializable.
// Layout produces it; `sceneToSvg` paints it. Colours stay semantic (`Paint`) so light/dark is a render option.

import type { DiagramType } from '../dsl/index.ts';

export type ColorMode = 'pastel' | 'bold' | 'outline';
export type StyleMode = 'shadow' | 'plain' | 'watercolor';
export type Typeface = 'rough' | 'clean' | 'mono';
export type TextSize = 'small' | 'medium' | 'large';
export type ConnectorStyle = 'elbow' | 'straight' | 'arc';

export type ShapeKind =
  | 'rectangle'
  | 'circle'
  | 'cylinder'
  | 'diamond'
  | 'document'
  | 'ellipse'
  | 'hexagon'
  | 'oval'
  | 'parallelogram'
  | 'star'
  | 'trapezoid'
  | 'triangle';

/** A colour request: a sanitized palette name or hex (`undefined` = neutral) plus the colour mode. */
export interface Paint {
  color?: string;
  mode: ColorMode;
}

export interface Point {
  x: number;
  y: number;
}

/** What a box stands for; the painter uses it for fills and corner radii. */
export type BoxRole = 'node' | 'group' | 'entity' | 'entity-header' | 'column' | 'activation' | 'frame' | 'legend';

export interface SceneBox {
  kind: 'box';
  /** Diagram element id (node, group, entity, column) when the box represents one. */
  id?: string;
  role: BoxRole;
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  paint: Paint;
  shadow: boolean;
  dashed?: boolean;
}

/** `group`: a group title, in the group colour's strong shade (neutral groups: a muted slate). */
export type TextTone = 'normal' | 'muted' | 'strong' | 'group';

export interface SceneText {
  kind: 'text';
  /** Anchor point: x per `anchor`, y is the top of the first line. */
  x: number;
  y: number;
  lines: string[];
  size: number;
  lineHeight: number;
  anchor: 'start' | 'middle' | 'end';
  weight: 400 | 600;
  font: Typeface;
  tone: TextTone;
  /** Text sitting on a filled shape takes its contrast colour from that paint. */
  on?: Paint;
  /** Plain text colour (edge labels, ERD markers). */
  color?: string;
  /** Draw a background plate behind the text (edge labels). */
  plate?: boolean;
}

export interface SceneIcon {
  kind: 'icon';
  /** Icon name as written in the code. */
  name: string;
  x: number;
  y: number;
  size: number;
  paint: Paint;
  /** Drawn inside a filled box: in `bold` mode it takes the box's contrast colour. */
  inside?: boolean;
}

export type Marker = 'none' | 'arrow' | 'one' | 'many';

export interface SceneEdge {
  kind: 'edge';
  id: string;
  points: Point[];
  route: ConnectorStyle;
  dashed: boolean;
  start: Marker;
  end: Marker;
  color?: string;
  /** Graph types: DSL id of the source node or group. With `to` it keys the edge for the run overlay, stable across code edits that reorder lines (unlike `id`). */
  from?: string;
  /** Graph types: DSL id of the target node or group. */
  to?: string;
  /** Drawn lighter (straight connectors in graph diagrams, spec §1.7). */
  soft?: boolean;
}

export interface SceneLine {
  kind: 'line';
  points: Point[];
  dashed: boolean;
  tone: 'muted' | 'normal';
}

export type SceneItem = SceneBox | SceneText | SceneIcon | SceneEdge | SceneLine;

/** Hit box of a draggable diagram element (graph types), in scene coordinates. Not painted. */
export interface SceneHandle {
  id: string;
  kind: 'node' | 'group';
  /** Parent group id, `""` at the root. */
  parent: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The element's box differs from the automatic layout (moved, or a group refitted around moved children). */
  moved: boolean;
}

export interface Scene {
  type: DiagramType;
  width: number;
  height: number;
  /** Paint order: first item is at the back. */
  items: SceneItem[];
  /** Translation `finishScene` applied: scene = layout + origin. */
  origin?: Point;
  /** Hit boxes for draggable elements (graph types only), in scene coordinates, paint order. */
  handles?: SceneHandle[];
}
