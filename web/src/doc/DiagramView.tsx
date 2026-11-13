// How an embedded diagram looks in the document: the block's live picture, read-only.
// Clicking it shows the block on the canvas, where its code is edited.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import type { Block } from '../api';
import type { ImageKind } from '../export/actions';
import { layoutSig } from '../canvas/sync';
import { renderBlock, type BlockPicture } from '../canvas/render';
import { DIAGRAM_TYPES } from '../dsl/templates';
import { RunLayer, RunLegend } from '../run/RunLayer';
import { useRunSteps } from '../run/runStore';
import { DiagramEmbed } from './extensions';
import type { CanvasEl } from './model';

export type DocCtx = {
  blocks: Block[];
  /** Canvas frames and what sits in them (see frameScene), for frame embeds. */
  frameScene: CanvasEl[];
  /** Diagram blocks that sit inside a canvas frame, with their canvas position (see App). */
  frameBlocks: Block[];
  dark: boolean;
  onShow: (blockId: string) => void;
  onShowFrame: (frameId: string) => void;
  onExport: (block: Block, kind: ImageKind) => void;
};
export const DocContext = createContext<DocCtx>({ blocks: [], frameScene: [], frameBlocks: [], dark: false, onShow: () => {}, onShowFrame: () => {}, onExport: () => {} });

export const typeLabel = (type: string) => DIAGRAM_TYPES.find((t) => t.id === type)?.label ?? type;

function DiagramView({ node, selected }: ReactNodeViewProps) {
  const { blocks, dark, onShow, onExport } = useContext(DocContext);
  const id = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : '';
  const block = blocks.find((b) => b.id === id);
  const [pic, setPic] = useState<BlockPicture | null>(null);
  const theme = dark ? 'dark' : 'light';
  useEffect(() => {
    if (!block) return;
    let live = true;
    void renderBlock(block, theme).then((p) => live && setPic(p));
    return () => {
      live = false;
    };
    // Redraw only when what the picture depends on changes, not when the block moves on the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.id, block?.type, block?.code, layoutSig(block?.layout), theme]);

  // The progress board sits over the picture as the button's sibling (not inside it: a button holding another button
  // is invalid and its accessible name would swallow the step labels). It follows the img as the column resizes.
  const steps = useRunSteps(block ? id : undefined);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; scale: number } | null>(null);
  const scene = pic?.scene;
  useEffect(() => {
    const s = stage.current;
    const i = img.current;
    if (!steps || !scene || !pic || !s || !i) {
      setBox(null);
      return;
    }
    const place = () => {
      const a = s.getBoundingClientRect();
      const b = i.getBoundingClientRect();
      const next = { left: b.left - a.left, top: b.top - a.top, scale: b.width / pic.width };
      setBox((old) => (old && old.left === next.left && old.top === next.top && old.scale === next.scale ? old : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(s);
    ro.observe(i);
    return () => ro.disconnect();
  }, [steps, scene, pic]);

  const label = block ? `${typeLabel(block.type)} 다이어그램` : '다이어그램';
  return (
    <NodeViewWrapper as="figure" className={`doc-diagram${selected ? ' is-selected' : ''}`} data-diagram="" data-block-id={id} contentEditable={false}>
      {block ? (
        <div ref={stage} className="doc-diagram-stage">
          <button type="button" className="doc-diagram-pic" title="캔버스에서 보기" aria-label={`${label}, 캔버스에서 보기`} onClick={() => onShow(id)}>
            {pic ? <img ref={img} src={pic.dataURL} alt={label} width={pic.width} height={pic.height} draggable={false} /> : <span className="doc-diagram-wait">그리는 중이에요…</span>}
          </button>
          {steps && scene && box && <RunLayer scene={scene} steps={steps} left={box.left} top={box.top} scale={box.scale} legend={false} />}
        </div>
      ) : (
        <p className="doc-diagram-gone">캔버스에서 지운 다이어그램이에요. 이 줄을 지워도 돼요.</p>
      )}
      {block && steps && scene && box && <RunLegend steps={steps} />}
      <figcaption>{block ? `${label} · 누르면 캔버스로 가요` : label}</figcaption>
      {block && (
        <div className="doc-diagram-actions" role="group" aria-label="다이어그램 내보내기">
          {(
            [
              ['svg', 'SVG'],
              ['png', 'PNG'],
              ['copy', '이미지 복사'],
              ['pdf', 'PDF'],
            ] as const
          ).map(([kind, text]) => (
            <button key={kind} type="button" data-export-block={kind} onClick={() => onExport(block, kind)}>
              {text}
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const DiagramEmbedView = DiagramEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView);
  },
});
