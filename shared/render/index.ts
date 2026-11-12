// Diagram-as-code → laid-out Scene → SVG. Pure TS; runs in Node and in the browser.

import { parse } from '../dsl/index.ts';
import type { Diagnostic, Diagram, DiagramType } from '../dsl/index.ts';
import { layoutErd } from './layout-erd.ts';
import type { BlockLayout } from './block-layout.ts';
import { layoutGraph } from './layout-graph.ts';
import { layoutSequence } from './layout-sequence.ts';
import type { Scene } from './scene.ts';
import { sceneToSvg } from './svg.ts';
import type { SvgOptions } from './svg.ts';

export type * from './scene.ts';
export { sceneToSvg } from './svg.ts';
export type { SvgOptions } from './svg.ts';
export type { Theme } from './theme.ts';
export { glyphFor, iconFor } from './icons.ts';
export type { IconSet, ResolvedIcon } from './icons.ts';
export { composeGraph, graphBase } from './layout-graph.ts';
export type { GraphBase } from './layout-graph.ts';
export { BLOCK_LAYOUT_VERSION } from './block-layout.ts';
export type { BlockLayout, LayoutBasis, LayoutItem } from './block-layout.ts';

export interface LayoutOptions {
  /** Moved-node overrides (graph types only; sequence and ERD ignore them). */
  layout?: BlockLayout;
}

/** Lay out a parsed diagram. Deterministic: the same AST and layout always give the same scene. */
export function layoutDiagram(diagram: Diagram, options: LayoutOptions = {}): Promise<Scene> {
  switch (diagram.type) {
    case 'sequence':
      return layoutSequence(diagram);
    case 'erd':
      return layoutErd(diagram);
    default:
      return layoutGraph(diagram, options.layout);
  }
}

export interface RenderResult {
  svg: string;
  scene: Scene;
  diagnostics: Diagnostic[];
}

/** Parse (if given code), lay out and paint. Never throws on bad code: a partial diagram renders. */
export async function renderDiagram(input: string | Diagram, options: SvgOptions & LayoutOptions & { type?: DiagramType } = {}): Promise<RenderResult> {
  const { ast, diagnostics } = typeof input === 'string' ? parse(input, options.type) : { ast: input, diagnostics: [] };
  const scene = await layoutDiagram(ast, { layout: options.layout });
  return { svg: sceneToSvg(scene, options), scene, diagnostics };
}
