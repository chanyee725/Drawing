// How an embedded diagram looks in the document: the block's live picture, read-only.
// Clicking it shows the block on the canvas, where its code is edited.
import { createContext, useContext, useEffect, useState } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import type { Block } from '../api';
import { renderBlock, type BlockPicture } from '../canvas/render';
import { DIAGRAM_TYPES } from '../dsl/templates';
import { DiagramEmbed } from './extensions';

export type DocCtx = { blocks: Block[]; dark: boolean; onShow: (blockId: string) => void };
export const DocContext = createContext<DocCtx>({ blocks: [], dark: false, onShow: () => {} });

export const typeLabel = (type: string) => DIAGRAM_TYPES.find((t) => t.id === type)?.label ?? type;

function DiagramView({ node, selected }: ReactNodeViewProps) {
  const { blocks, dark, onShow } = useContext(DocContext);
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
  }, [block?.id, block?.type, block?.code, theme]);

  const label = block ? `${typeLabel(block.type)} 다이어그램` : '다이어그램';
  return (
    <NodeViewWrapper as="figure" className={`doc-diagram${selected ? ' is-selected' : ''}`} data-diagram="" data-block-id={id} contentEditable={false}>
      {block ? (
        <button type="button" className="doc-diagram-pic" title="캔버스에서 보기" aria-label={`${label}, 캔버스에서 보기`} onClick={() => onShow(id)}>
          {pic ? <img src={pic.dataURL} alt={label} width={pic.width} height={pic.height} draggable={false} /> : <span className="doc-diagram-wait">그리는 중이에요…</span>}
        </button>
      ) : (
        <p className="doc-diagram-gone">캔버스에서 지운 다이어그램이에요. 이 줄을 지워도 돼요.</p>
      )}
      <figcaption>{block ? `${label} · 누르면 캔버스로 가요` : label}</figcaption>
    </NodeViewWrapper>
  );
}

export const DiagramEmbedView = DiagramEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView);
  },
});
