// Diagram-as-code → laid-out Scene → SVG. Pure TS; runs in Node and in the browser.

import { parse } from '../dsl/index.ts';
import type { Diagnostic, Diagram, DiagramType } from '../dsl/index.ts';
import { layoutErd } from './layout-erd.ts';
import { layoutGraph } from './layout-graph.ts';
import { layoutSequence } from './layout-sequence.ts';
import type { Scene } from './scene.ts';
import { sceneToSvg } from './svg.ts';
import type { SvgOptions } from './svg.ts';

export type * from './scene.ts';
export { sceneToSvg } from './svg.ts';
export type { SvgOptions } from './svg.ts';
export type { Theme } from './theme.ts';
export { glyphFor } from './icons.ts';

/** Lay out a parsed diagram. Deterministic: the same AST always gives the same scene. */
export function layoutDiagram(diagram: Diagram): Promise<Scene> {
  switch (diagram.type) {
    case 'sequence':
      return layoutSequence(diagram);
    case 'erd':
      return layoutErd(diagram);
    default:
      return layoutGraph(diagram);
  }
}

export interface RenderResult {
  svg: string;
  scene: Scene;
  diagnostics: Diagnostic[];
}

/** Parse (if given code), lay out and paint. Never throws on bad code: a partial diagram renders. */
export async function renderDiagram(input: string | Diagram, options: SvgOptions & { type?: DiagramType } = {}): Promise<RenderResult> {
  const { ast, diagnostics } = typeof input === 'string' ? parse(input, options.type) : { ast: input, diagnostics: [] };
  const scene = await layoutDiagram(ast);
  return { svg: sceneToSvg(scene, options), scene, diagnostics };
}
