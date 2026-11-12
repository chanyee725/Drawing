import { Cursor, GRAPH_KEYS } from './common.ts';
import { parseErd } from './erd.ts';
import { parseGraph } from './graph.ts';
import { parseSequence } from './sequence.ts';
import { tokenize } from './tokenizer.ts';
import type { Diagnostic, Diagram, DiagramType, ErdDiagram, GraphDiagram, ParseResult, SequenceDiagram } from './types.ts';

export type * from './types.ts';
export { tokenize } from './tokenizer.ts';
export type { Token, TokenKind } from './tokenizer.ts';

/** First-line markers used by Eraser's `.eraserdiagram` files. */
const MARKERS: Record<string, DiagramType> = {
  'cloud-architecture-diagram': 'cloud-architecture',
  'flow-chart': 'flowchart',
  'flowchart-diagram': 'flowchart',
  'sequence-diagram': 'sequence',
  'entity-relationship-diagram': 'erd',
};

function stripMarker(code: string): { code: string; type?: DiagramType } {
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.replace(/\/\/.*$/, '').trim();
    if (text === '') continue;
    const type = MARKERS[text];
    if (!type) break;
    lines[i] = '';
    return { code: lines.join('\n'), type };
  }
  return { code };
}

/**
 * Guess the diagram type from the code: a first-line marker, sequence keywords, ERD keywords
 * (`notation`, `pk`/`fk`), `shape:` for flowcharts, otherwise cloud architecture.
 */
export function detectDiagramType(code: string): DiagramType {
  const marked = stripMarker(code).type;
  if (marked) return marked;
  const text = code.replace(/\/\/.*$/gm, '');
  if (/^\s*(activate|deactivate|autoNumber|order|loop|alt|else|opt|par|and|break)\b/m.test(text)) return 'sequence';
  if (/^\s*notation\b/m.test(text) || /\b(pk|fk)\b/.test(text)) return 'erd';
  if (/\bshape\s*:/.test(text)) return 'flowchart';
  return 'cloud-architecture';
}

function run(code: string, type: DiagramType): ParseResult {
  const src = code.replace(/^﻿/, '');
  const { tokens, diagnostics: lexDiagnostics } = tokenize(src);
  const c = new Cursor(src, tokens, GRAPH_KEYS);
  const ast: Diagram =
    type === 'sequence' ? parseSequence(c) : type === 'erd' ? parseErd(c) : parseGraph(c, type);
  const diagnostics = [...lexDiagnostics, ...c.diagnostics].sort(
    (a, b) => a.offset - b.offset || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1),
  );
  return { ast, diagnostics };
}

function emptyAst(type: DiagramType): Diagram {
  const base = { styles: {}, globalStyles: [] };
  if (type === 'sequence') return { ...base, type, autoNumber: 'off', columns: [], items: [] };
  if (type === 'erd') return { ...base, type, notation: 'chen', entities: [], relationships: [] };
  return { ...base, type, direction: type === 'flowchart' ? 'down' : 'right', children: [], edges: [] };
}

/**
 * Parse diagram-as-code. Never throws: bad input gives a partial AST plus diagnostics.
 * `type` defaults to `detectDiagramType(code)`.
 */
export function parse(code: string, type?: DiagramType): ParseResult {
  const stripped = stripMarker(String(code ?? ''));
  const resolved = type ?? stripped.type ?? detectDiagramType(stripped.code);
  try {
    return run(stripped.code, resolved);
  } catch (e) {
    const message = `Internal parser error: ${e instanceof Error ? e.message : String(e)}`;
    const diagnostic: Diagnostic = { message, severity: 'error', line: 1, column: 1, offset: 0, length: 0 };
    return { ast: emptyAst(resolved), diagnostics: [diagnostic] };
  }
}

export function parseArchitecture(code: string): ParseResult<GraphDiagram> {
  return parse(code, 'cloud-architecture') as ParseResult<GraphDiagram>;
}
export function parseFlowchart(code: string): ParseResult<GraphDiagram> {
  return parse(code, 'flowchart') as ParseResult<GraphDiagram>;
}
export function parseSequenceDiagram(code: string): ParseResult<SequenceDiagram> {
  return parse(code, 'sequence') as ParseResult<SequenceDiagram>;
}
export function parseErdDiagram(code: string): ParseResult<ErdDiagram> {
  return parse(code, 'erd') as ParseResult<ErdDiagram>;
}
