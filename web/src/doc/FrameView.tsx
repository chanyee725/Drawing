// How an embedded canvas frame looks in the document: its content, read-only.
// Clicking it shows the frame on the canvas. A frame deleted on the canvas shows a broken-reference note.
import { useContext, useEffect, useState } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { FrameEmbed } from './extensions';
import { DocContext } from './DiagramView';
import { blocksInFrame, frameLabel, frameSceneSig, framesOf, resolveFrame } from './model';
import { drawSig } from '../canvas/sync';
import { renderFrame, type FramePicture } from './framePreview';

function FrameView({ node, selected }: ReactNodeViewProps) {
  const { frameScene, frameBlocks, dark, onShowFrame } = useContext(DocContext);
  const id = typeof node.attrs.frameId === 'string' ? node.attrs.frameId : '';
  const saved = typeof node.attrs.name === 'string' ? node.attrs.name : '';
  const found = id ? resolveFrame(framesOf({ elements: frameScene }), id) : null;
  const [pic, setPic] = useState<FramePicture | null>(null);
  const frameEl = frameScene.find((e) => e.id === id);
  const mine = frameEl ? blocksInFrame({ x: frameEl.x ?? 0, y: frameEl.y ?? 0, width: frameEl.width ?? 0, height: frameEl.height ?? 0 }, frameBlocks) : [];
  const sig = `${frameSceneSig(frameScene)}|${mine.map((b) => `${b.id}@${b.x},${b.y},${b.w},${b.h}:${drawSig(b)}`).join(';')}`;
  useEffect(() => {
    if (!found) return;
    let live = true;
    renderFrame(frameScene, id, dark, mine).then(
      (p) => live && setPic(p),
      () => live && setPic(null),
    );
    return () => {
      live = false;
    };
    // Redraw only when the frame's own scene or the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!found, id, sig, dark]);

  const label = found ? frameLabel(found) : saved ? `프레임 ${saved}` : '프레임';
  return (
    <NodeViewWrapper as="figure" className={`doc-diagram doc-frame${selected ? ' is-selected' : ''}`} data-frame-embed="" data-frame-id={id} contentEditable={false}>
      {found ? (
        <button type="button" className="doc-diagram-pic" title="캔버스에서 보기" aria-label={`${label}, 캔버스에서 보기`} onClick={() => onShowFrame(id)}>
          {pic ? <img src={pic.dataURL} alt={label} width={pic.width} height={pic.height} draggable={false} /> : <span className="doc-diagram-wait">그리는 중이에요…</span>}
        </button>
      ) : (
        <p className="doc-diagram-gone" role="note">
          {saved ? `"${saved}" 프레임을 찾을 수 없어요. ` : '프레임을 찾을 수 없어요. '}캔버스에서 지웠을 수 있어요. 이 줄을 지워도 돼요.
        </p>
      )}
      <figcaption>{found ? `${label} · 누르면 캔버스로 가요` : label}</figcaption>
    </NodeViewWrapper>
  );
}

export const FrameEmbedView = FrameEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FrameView);
  },
});
