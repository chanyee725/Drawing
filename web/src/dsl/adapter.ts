// Seam between the editor and the parser/renderer. The editor only calls `analyzeDiagram`.
// Parsing uses shared/dsl (E2); the live preview uses shared/render (E3) via `renderPreview`.
import { parse, type DiagramType as ParserType, type Diagram } from '../../../shared/dsl/index.ts';
import { renderDiagram, sceneToSvg, type BlockLayout, type Scene } from '../../../shared/render/index.ts';
import { reconcileForSave, reconcileLayout, type ReconcileReason } from '../../../shared/render/overrides.ts';
import { BLOCK_LAYOUT_VERSION } from '../../../shared/render/block-layout.ts';

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
  /** true when a parser handled this type. */
  parsed: boolean;
};

/** Editor block type (templates.ts) to parser type. BPMN has no parser yet. */
const PARSER_TABLE: Record<string, ParserType> = {
  architecture: 'cloud-architecture',
  flowchart: 'flowchart',
  sequence: 'sequence',
  erd: 'erd',
};

const parserType = (type: string): ParserType | undefined => (Object.hasOwn(PARSER_TABLE, type) ? PARSER_TABLE[type] : undefined);

export function analyzeDiagram(type: string, code: string): Analysis {
  const pt = parserType(type);
  if (!pt) return { ast: null, diagnostics: [], parsed: false };
  const { ast, diagnostics } = parse(code, pt);
  return { ast, diagnostics, parsed: true };
}

export type Preview = {
  /** SVG markup of the last successful render. */
  svg: string;
  /** Errors of the code that is currently typed. Non-empty means `svg` is from earlier code. */
  errors: Diagnostic[];
  /** true when `svg` does not match the current code. */
  stale: boolean;
  /** true when the renderer failed (threw) on the current code, so `errors` says nothing about it. */
  failed: boolean;
  /** Laid-out scene behind `svg`, kept so a theme change can repaint it without the code. */
  scene: Scene;
  /** Theme `svg` was painted with. */
  theme: PreviewTheme;
};

type PreviewTheme = 'light' | 'dark';
export type RenderOutcome = {
  svg: string;
  diagnostics: Diagnostic[];
  scene: Scene;
  theme: PreviewTheme;
  /** Set when the code changed so much that the saved layout was left out of this drawing (design §4.2). */
  reset?: ReconcileReason;
};

/** Render the code to SVG. Returns null for unsupported types or when rendering fails. */
export async function renderPreview(type: string, code: string, theme: PreviewTheme, layout?: BlockLayout): Promise<RenderOutcome | null> {
  const pt = parserType(type);
  if (!pt) return null;
  try {
    if (!layout) {
      const { svg, diagnostics, scene } = await renderDiagram(code, { type: pt, theme });
      return { svg, diagnostics, scene, theme };
    }
    // Drawing never changes the file: overrides the code no longer fits are left out here and pruned on save.
    const { ast, diagnostics } = parse(code, pt);
    const kept = ast.type === 'sequence' || ast.type === 'erd' ? { layout: undefined } : reconcileLayout(ast, layout);
    const { svg, scene } = await renderDiagram(ast, { theme, layout: kept.layout });
    return { svg, diagnostics, scene, theme, ...('reset' in kept && kept.reset ? { reset: kept.reset } : {}) };
  } catch {
    return null;
  }
}

/**
 * The block with its layout cleaned up for the code it has now (design §4.3), or null when the file would not change.
 * Only for code that parses cleanly: with errors the canvas shows the last good picture, so nothing is pruned.
 */
export function prunedLayout<B extends { type: string; code: string; layout?: BlockLayout }>(b: B): B | null {
  // A layout of an unknown version is read-only: never wiped or rewritten (design §2.1).
  if (!b.layout || b.layout.v !== BLOCK_LAYOUT_VERSION) return null;
  const { ast, diagnostics, parsed } = analyzeDiagram(b.type, b.code);
  if (!parsed || !ast || diagnostics.some((d) => d.severity === 'error')) return null;
  const { layout: _drop, ...rest } = b;
  // A layout only belongs to graph diagrams; after switching to another kind it is dead weight.
  if (ast.type === 'sequence' || ast.type === 'erd') return rest as B;
  const r = reconcileForSave({ ast, diagnostics }, b.layout);
  if (!r.changed) return null;
  return (r.layout ? { ...rest, layout: r.layout } : rest) as B;
}

/**
 * Decide what the canvas shows after a render attempt for a block of `type`: a clean
 * render replaces the preview; a render with errors (or a failed one) keeps the last
 * good SVG, repainted when `theme` differs from the one it was drawn with. An
 * unsupported type shows nothing, so an earlier drawing never lingers.
 */
export function nextPreview(prev: Preview | null, result: RenderOutcome | null, type?: string, theme?: PreviewTheme): Preview | null {
  if (type !== undefined && !parserType(type)) return null;
  const errors = result ? result.diagnostics.filter((d) => d.severity === 'error') : [];
  if (result && errors.length === 0) {
    return { svg: result.svg, errors: [], stale: false, failed: false, scene: result.scene, theme: result.theme };
  }
  if (!prev) return null;
  const want = theme ?? result?.theme ?? prev.theme;
  const svg = want === prev.theme ? prev.svg : sceneToSvg(prev.scene, { theme: want });
  return { ...prev, svg, theme: want, errors, stale: true, failed: !result };
}
