import { useEffect, useRef } from 'react';
import type { ImageKind } from './export/actions';
import { IS_MAC } from './platform';

type Props = {
  open: boolean;
  onOpen: (open: boolean) => void;
  /** False in the document-only view: there is no canvas to export from. */
  canvasReady: boolean;
  /** The canvas has a selection (so the image goes out of the selection only). */
  selected: boolean;
  onImage: (kind: ImageKind) => void;
  onMarkdown: () => void;
  disabled?: boolean;
};

export function ExportMenu({ open, onOpen, canvasReady, selected, onImage, onMarkdown, disabled }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onOpen]);

  const scope = selected ? '선택한 것' : '캔버스 전체';
  const items: { label: string; hint: string; off: boolean; run: () => void; id: string }[] = [
    { id: 'svg', label: 'SVG로 내보내기', hint: scope, off: !canvasReady, run: () => onImage('svg') },
    { id: 'png', label: 'PNG로 내보내기', hint: scope, off: !canvasReady, run: () => onImage('png') },
    { id: 'copy', label: '이미지로 복사', hint: 'Shift+Alt+C', off: !canvasReady, run: () => onImage('copy') },
    { id: 'md', label: '문서를 Markdown으로', hint: '다이어그램은 코드 블록', off: false, run: onMarkdown },
  ];
  return (
    <div ref={box} className="relative hidden shrink-0 md:block">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`내보내기 (${IS_MAC ? '⌘E' : 'Ctrl+E'})`}
        onClick={() => onOpen(!open)}
        className="h-8 whitespace-nowrap rounded-md border px-3 text-sm disabled:opacity-50"
        style={{ borderColor: 'var(--border)' }}
      >
        내보내기
      </button>
      {open && (
        <div role="menu" aria-label="내보내기" className="absolute right-0 top-9 z-30 w-60 rounded-lg border p-1 shadow-lg" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              data-export={it.id}
              disabled={it.off}
              title={it.off ? '캔버스가 보이는 보기에서 쓸 수 있어요' : undefined}
              onClick={() => {
                onOpen(false);
                it.run();
              }}
              className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-50"
            >
              <span>{it.label}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {it.off ? '캔버스가 보이는 보기에서 쓸 수 있어요' : it.hint}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
