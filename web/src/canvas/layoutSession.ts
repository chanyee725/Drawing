// The render side of layout edit mode (design §3.1, §5.3): ELK runs once per code, then every drag frame only composes.
// Draws exactly what `renderBlock` draws for the same code and layout, so the overlay matches the block image.
import { composeGraph, graphBase, sceneToSvg, type BlockLayout, type GraphBase, type LayoutBasis, type Scene } from '../../../shared/render/index.ts';
import type { GraphDiagram } from '../../../shared/dsl/index.ts';
import { basisOf, reconcileLayout } from '../../../shared/render/overrides.ts';
import { BLOCK_LAYOUT_VERSION } from '../../../shared/render/block-layout.ts';
import { analyzeDiagram } from '../dsl/adapter.ts';

export type LayoutSession = {
  /** type + code this session was made for. */
  key: string;
  basis: LayoutBasis;
  /** Picture for `layout` (light theme, like the block images), with its scene for hit boxes and origin. */
  compose(layout: BlockLayout | undefined): { scene: Scene; svg: string };
};

const keyOf = (type: string, code: string) => `${type}\n${code}`;

// Reason wording lives in reasons.ts, with the canvas-side reasons.
import { reasonText, type EditAction, type EditReasonCode } from './reasons.ts';
export { reasonText, type EditAction, type EditReasonCode };

/** Why a block's code cannot be laid out by hand (as a code), or null when it can. */
export function editReasonCode(b: { type: string; code: string; layout?: BlockLayout }): EditReasonCode | null {
  const { ast, diagnostics, parsed } = analyzeDiagram(b.type, b.code);
  if (!parsed || !ast || (ast.type !== 'cloud-architecture' && ast.type !== 'flowchart')) return 'kind';
  if (diagnostics.some((d) => d.severity === 'error')) return 'errors';
  if (b.layout && b.layout.v !== BLOCK_LAYOUT_VERSION) return 'version';
  if (!ast.children.length) return 'empty';
  return null;
}

/** The reason as text for an action, or null. */
export function editReason(b: { type: string; code: string; layout?: BlockLayout }, action: EditAction = 'move'): string | null {
  const code = editReasonCode(b);
  return code ? reasonText(code, action) : null;
}

const bases = new Map<string, Promise<{ ast: GraphDiagram; base: GraphBase }>>();

/** A session for the block's current code, or the reason there is none (see `editReason`). */
export async function openLayoutSession(b: { type: string; code: string; layout?: BlockLayout }, action: EditAction = 'move'): Promise<LayoutSession | { reason: string }> {
  const reason = editReason(b, action);
  if (reason) return { reason };
  const key = keyOf(b.type, b.code);
  let p = bases.get(key);
  if (!p) {
    const ast = analyzeDiagram(b.type, b.code).ast as GraphDiagram;
    p = graphBase(ast).then((base) => ({ ast, base }));
    bases.set(key, p);
    p.catch(() => bases.delete(key));
    if (bases.size > 8) bases.delete(bases.keys().next().value!);
  }
  let ast: GraphDiagram;
  let base: GraphBase;
  try {
    ({ ast, base } = await p);
  } catch {
    return { reason: '그리지 못했어요. 코드를 확인해 주세요' };
  }
  return {
    key,
    basis: basisOf(ast),
    compose(layout) {
      // Same as drawing the block: overrides the code no longer fits are left out (design §4.3).
      const scene = composeGraph(ast, base, reconcileLayout(ast, layout).layout);
      return { scene, svg: sceneToSvg(scene, { theme: 'light' }) };
    },
  };
}

export const sessionKey = (b: { type: string; code: string }) => keyOf(b.type, b.code);
