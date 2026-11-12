// Seam between the editor and the parser/renderer (E2 parser, E3 renderer).
// The editor only calls `analyzeDiagram`. Until E2/E3 are merged it reports nothing.
// To wire E2/E3: replace the body with parse(type, code) and map parser errors to Diagnostic,
// and fill `preview` with the rendered scene. Nothing else in the editor needs to change.
import type { DiagramType } from './templates';

export type Diagnostic = {
  /** 1-based line */
  line: number;
  /** 1-based column, optional */
  column?: number;
  message: string;
  severity: 'error' | 'warning';
};

export type Analysis = {
  diagnostics: Diagnostic[];
  /** Renderer output for the canvas preview. Opaque until E3 defines it. */
  preview: unknown | null;
  /** false while no parser is connected, so the UI can say so. */
  connected: boolean;
};

export function analyzeDiagram(_type: DiagramType | string, _code: string): Analysis {
  return { diagnostics: [], preview: null, connected: false };
}
