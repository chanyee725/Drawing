import type { Block } from './api';
import { analyzeDiagram } from './dsl/adapter';

/** Canvas area. Live preview comes from analyzeDiagram().preview once E2/E3 are wired; E5 adds free-form drawing. */
export function CanvasPane({ blocks, hasFile }: { blocks: Block[]; hasFile: boolean }) {
  return (
    <main
      className="flex h-full min-h-64 flex-1 flex-col items-center justify-center gap-2 p-6"
      style={{ backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
      aria-label="캔버스"
    >
      {!hasFile ? (
        <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
          파일을 고르면 여기에 그려져요.
        </p>
      ) : (
        blocks.map((b, i) => {
          const a = analyzeDiagram(b.type, b.code);
          return (
            <div key={b.id} className="rounded-md border px-4 py-3 text-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }} data-preview={a.preview ? 'ready' : 'pending'}>
              다이어그램 {i + 1}: {a.preview ? '그렸어요' : '미리보기는 렌더러를 연결하면 보여요'}
            </div>
          );
        })
      )}
    </main>
  );
}
