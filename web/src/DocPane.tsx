import type { Block } from './api';
import { BlockEditor } from './BlockEditor';
import { DIAGRAM_TYPES, TEMPLATES, isDiagramType, type DiagramType } from './dsl/templates';
import { analyzeDiagram } from './dsl/adapter';

type Props = { blocks: Block[]; dark: boolean; onBlocks: (b: Block[]) => void };

const newId = () => `b_${Math.random().toString(36).slice(2, 10)}`;

export function DocPane({ blocks, dark, onBlocks }: Props) {
  const patch = (id: string, p: Partial<Block>) => onBlocks(blocks.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const add = () => {
    const type: DiagramType = 'architecture';
    // w = 0 marks a block not yet on the canvas; the canvas gives it the picture's size and a free spot.
    onBlocks([...blocks, { id: newId(), type, code: TEMPLATES[type], x: 0, y: 0, w: 0, h: 0 }]);
  };
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 p-6" aria-label="문서">
      {blocks.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          아직 다이어그램이 없어요. 아래 버튼으로 추가해 보세요.
        </p>
      )}
      {blocks.map((b, i) => (
        <article key={b.id} aria-label={`다이어그램 ${i + 1}`} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span style={{ color: 'var(--text-muted)' }}>종류</span>
              <select
                value={b.type}
                onChange={(e) => patch(b.id, { type: e.target.value })}
                className="h-8 rounded-md border px-2"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                {!isDiagramType(b.type) && <option value={b.type}>{b.type}</option>}
                {DIAGRAM_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {isDiagramType(b.type) && (
              <button
                type="button"
                className="h-8 rounded-md border px-3"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => {
                  if (!b.code.trim() || b.code === TEMPLATES[b.type as DiagramType] || window.confirm('지금 코드를 예시로 바꿀까요?'))
                    patch(b.id, { code: TEMPLATES[b.type as DiagramType] });
                }}
              >
                예시 넣기
              </button>
            )}
            <button
              type="button"
              className="ml-auto h-8 rounded-md px-3"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => window.confirm('이 다이어그램을 지울까요?') && onBlocks(blocks.filter((x) => x.id !== b.id))}
            >
              지우기
            </button>
          </div>
          <BlockEditor code={b.code} type={b.type} dark={dark} onChange={(code) => patch(b.id, { code })} />
          {!analyzeDiagram(b.type, b.code).parsed && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              이 종류는 아직 문법 검사를 지원하지 않아요.
            </p>
          )}
        </article>
      ))}
      <button type="button" onClick={add} className="h-9 self-start rounded-md border px-4 text-sm" style={{ borderColor: 'var(--border)' }}>
        + 다이어그램 추가
      </button>
    </section>
  );
}
