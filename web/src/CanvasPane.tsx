import { useEffect, useState } from 'react';
import type { Block } from './api';
import { analyzeDiagram, nextPreview, renderPreview, type Preview } from './dsl/adapter';
import type { Theme } from './theme';

/** One diagram's live SVG. Debounced; on errors the last good render stays visible. */
function BlockPreview({ block, index, theme }: { block: Block; index: number; theme: Theme }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState(false);
  const supported = analyzeDiagram(block.type, '').parsed;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      renderPreview(block.type, block.code, theme).then((r) => {
        if (cancelled) return;
        setPreview((p) => nextPreview(p, r));
        setDone(true);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [block.type, block.code, theme]);

  return (
    <figure
      className="max-w-full overflow-auto rounded-md border p-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      data-preview={preview ? (preview.stale ? 'stale' : 'ready') : 'pending'}
      aria-label={`다이어그램 ${index + 1}`}
    >
      {preview ? (
        <div dangerouslySetInnerHTML={{ __html: preview.svg }} />
      ) : (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {!supported ? '이 종류는 아직 그릴 수 없어요' : done ? '그릴 내용이 아직 없어요' : '그리는 중이에요'}
        </p>
      )}
      {preview?.stale && (
        <figcaption className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          코드에 오류 {preview.errors.length}개가 있어요 · 마지막으로 그린 모습을 보여줘요
        </figcaption>
      )}
    </figure>
  );
}

/** Canvas area: live SVG preview of each diagram block; E5 adds free-form drawing. */
export function CanvasPane({ blocks, hasFile, theme }: { blocks: Block[]; hasFile: boolean; theme: Theme }) {
  return (
    <main
      className="flex h-full min-h-64 flex-1 flex-col items-center justify-center gap-4 overflow-auto p-6"
      style={{ backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
      aria-label="캔버스"
    >
      {!hasFile ? (
        <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
          파일을 고르면 여기에 그려져요.
        </p>
      ) : (
        blocks.map((b, i) => <BlockPreview key={b.id} block={b} index={i} theme={theme} />)
      )}
    </main>
  );
}
