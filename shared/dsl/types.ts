// Public types of the diagram-as-code parser. Pure data, JSON-serializable.

export type DiagramType = 'cloud-architecture' | 'flowchart' | 'sequence' | 'erd';
export type Severity = 'error' | 'warning';

/** A source range on one line. `line` and `column` are 1-based; `offset` is a 0-based UTF-16 index. */
export interface Span {
  line: number;
  column: number;
  offset: number;
  length: number;
}

export interface Diagnostic extends Span {
  message: string;
  severity: Severity;
}

/** Raw `[key: value, ...]` attributes. Values are unquoted strings. */
export type Attrs = Record<string, string>;

export type Direction = 'down' | 'up' | 'left' | 'right';

/** A global style line such as `colorMode bold`. It applies to elements defined after `span.line`. */
export interface GlobalStyle {
  key: string;
  value: string;
  span: Span;
}

export interface Legend {
  /** From `legend [position: ...]`. */
  position?: string;
  /** One entry per `[connection: -->, label: Async]` group. */
  entries: Attrs[];
  span: Span;
}

/** Normalized connection symbol. `>` is solid + end arrow, `<` start arrow, `--` dashed, and so on. */
export interface ArrowStyle {
  lineStyle: 'solid' | 'dashed';
  startArrow: boolean;
  endArrow: boolean;
  /** The symbol as written: `>`, `<`, `<>`, `-`, `--`, `-->`, `<--` or `<-->`. */
  symbol: string;
}

export interface DiagramBase {
  title?: string;
  /** Last value of each global style (`colorMode`, `wrap`, ...). */
  styles: Attrs;
  /** Every global style line in source order. */
  globalStyles: GlobalStyle[];
  legend?: Legend;
}

// ---------- cloud architecture and flowchart ----------

export interface GraphNode {
  kind: 'node';
  /** Unique name, used by edges. */
  id: string;
  name: string;
  /** `attrs.label` or the name. */
  label: string;
  attrs: Attrs;
  /** True when created only because a connection mentioned it. */
  implicit: boolean;
  span: Span;
}

export interface GraphGroup {
  kind: 'group';
  id: string;
  name: string;
  label: string;
  attrs: Attrs;
  children: GraphChild[];
  span: Span;
}

export type GraphChild = GraphNode | GraphGroup;

export interface GraphEdge extends ArrowStyle {
  id: string;
  /** Node or group id on the left of the symbol. */
  from: string;
  /** Node or group id on the right of the symbol. */
  to: string;
  label?: string;
  attrs: Attrs;
  /** Span of the connection symbol. */
  span: Span;
}

export interface GraphDiagram extends DiagramBase {
  type: 'cloud-architecture' | 'flowchart';
  /** Explicit direction, or the type's default (flowchart `down`, architecture `right`). */
  direction: Direction;
  /** Root-level nodes and groups in source order. Groups nest. */
  children: GraphChild[];
  /** All connections, chains and branches already expanded to single edges. */
  edges: GraphEdge[];
}

// ---------- sequence ----------

export interface SequenceColumn {
  id: string;
  name: string;
  label: string;
  attrs: Attrs;
  span: Span;
}

export interface SequenceMessage extends ArrowStyle {
  kind: 'message';
  from: string;
  to: string;
  label?: string;
  attrs: Attrs;
  span: Span;
}

export interface SequenceActivation {
  kind: 'activation';
  action: 'activate' | 'deactivate';
  column: string;
  span: Span;
}

export type SequenceBlockType = 'loop' | 'alt' | 'else' | 'opt' | 'par' | 'and' | 'break';

/** `else` and `and` are siblings that directly follow an `alt` / `par` block. */
export interface SequenceBlock {
  kind: 'block';
  blockType: SequenceBlockType;
  label?: string;
  attrs: Attrs;
  children: SequenceItem[];
  span: Span;
}

export type SequenceItem = SequenceMessage | SequenceActivation | SequenceBlock;

export interface SequenceDiagram extends DiagramBase {
  type: 'sequence';
  autoNumber: 'off' | 'on' | 'nested';
  /** Columns in display order (`order` applied, the rest by first appearance). */
  columns: SequenceColumn[];
  items: SequenceItem[];
}

// ---------- ERD ----------

export interface ErdField {
  name: string;
  type?: string;
  /** Lower-case metadata words such as `pk`, `fk`, `unique`, `not`, `null`. */
  meta: string[];
  attrs: Attrs;
  span: Span;
}

export interface ErdEntity {
  id: string;
  name: string;
  label: string;
  attrs: Attrs;
  fields: ErdField[];
  span: Span;
}

export interface ErdEndpoint {
  entity: string;
  field?: string;
  span: Span;
}

export type ErdCardinality = 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many';

export interface ErdRelationship {
  from: ErdEndpoint;
  to: ErdEndpoint;
  /** `<` one-to-many, `>` many-to-one, `-` one-to-one, `<>` many-to-many. */
  cardinality: ErdCardinality;
  label?: string;
  attrs: Attrs;
  span: Span;
}

export interface ErdDiagram extends DiagramBase {
  type: 'erd';
  notation: 'chen' | 'crows-foot';
  entities: ErdEntity[];
  relationships: ErdRelationship[];
}

export type Diagram = GraphDiagram | SequenceDiagram | ErdDiagram;

export interface ParseResult<D extends Diagram = Diagram> {
  ast: D;
  diagnostics: Diagnostic[];
}
