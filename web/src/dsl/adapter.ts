// Seam between the editor and the parser/renderer. The editor only calls `analyzeDiagram`.
// Parsing uses shared/dsl (E2). `preview` stays null until the E3 renderer is wired in:
// build the scene from `ast` here and the canvas pane picks it up.
import { parse, type DiagramType as ParserType, type Diagram } from '../../../shared/dsl/index.ts';

export type Diagnostic = {
  /** 1-based line */
  line: number;
  /** 1-based column */
  column: number;
  /** 0-based UTF-16 offset into the code and the length of the marked range */
  offset: number;
  length: number;
  message: string;
  severity: 'error' | 'warning';
};

export type Analysis = {
  /** Parsed diagram; null for types the parser does not support (BPMN). */
  ast: Diagram | null;
  diagnostics: Diagnostic[];
  /** Renderer output for the canvas preview. Opaque until E3 defines it. */
  preview: unknown | null;
  /** true when a parser handled this type. */
  parsed: boolean;
};

/** Editor block type (templates.ts) to parser type. BPMN has no parser yet. */
const PARSER_TYPE: Record<string, ParserType | undefined> = {
  architecture: 'cloud-architecture',
  flowchart: 'flowchart',
  sequence: 'sequence',
  erd: 'erd',
};

export function analyzeDiagram(type: string, code: string): Analysis {
  const pt = PARSER_TYPE[type];
  if (!pt) return { ast: null, diagnostics: [], preview: null, parsed: false };
  const { ast, diagnostics } = parse(code, pt);
  return { ast, diagnostics, preview: null, parsed: true };
}
