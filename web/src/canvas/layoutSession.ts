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

export type EditReasonCode = 'kind' | 'errors' | 'version' | 'empty';
/** What the user is trying to do; the wording of a reason follows it. */
export type EditAction = 'move' | 'freeform';

const REASON_TEXT: Record<EditAction, Record<EditReasonCode, string>> = {
  move: {
    kind: '이 종류는 아직 노드를 옮길 수 없어요',
    errors: '코드 오류를 고치면 옮길 수 있어요',
    version: '새 버전에서 만든 배치라 여기서는 고칠 수 없어요',
    empty: '옮길 노드가 없어요',
  },
  freeform: {
    kind: '이 블록은 자유 도형으로 바꿀 수 없어요',
    errors: '코드 오류를 고치면 자유 도형으로 바꿀 수 있어요',
    version: '새 버전에서 만든 배치라 여기서는 바꿀 수 없어요',
    empty: '바꿀 노드가 없어요',
  },
};

export const reasonText = (code: EditReasonCode, action: EditAction = 'move') => REASON_TEXT[action][code];

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
