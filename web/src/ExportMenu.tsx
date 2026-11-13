import { useEffect, useRef } from 'react';
import type { ImageKind } from './export/actions';
import { IS_MAC } from './platform';
import { SCALES, describeExport, type ExportOptions } from './export/options';

type Props = {
  open: boolean;
  onOpen: (open: boolean) => void;
  /** False in the document-only view: there is no canvas to export from. */
  canvasReady: boolean;
  /** The canvas has a selection (so the image goes out of the selection only). */
  selected: boolean;
  options: ExportOptions;
  onOptions: (o: ExportOptions) => void;
  onImage: (kind: ImageKind) => void;
  onMarkdown: () => void;
  /** Where the PDF comes from: the selected canvas shapes, the document, or the whole canvas. */
  pdfScope: 'selection' | 'document' | 'canvas';
  onPdf: () => void;
  disabled?: boolean;
};

export function ExportMenu({ open, onOpen, canvasReady, selected, options, onOptions, onImage, onMarkdown, pdfScope, onPdf, disabled }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus();
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
    { id: 'svg', label: 'SVG로 내보내기', hint: `${scope} · ${describeExport({ ...options, scale: 1 }).split(' · ').slice(1).join(' · ')}`, off: !canvasReady, run: () => onImage('svg') },
    { id: 'png', label: 'PNG로 내보내기', hint: `${scope} · ${describeExport(options)}`, off: !canvasReady, run: () => onImage('png') },
    { id: 'copy', label: '이미지로 복사', hint: `Shift+Alt+C · ${describeExport(options)}`, off: !canvasReady, run: () => onImage('copy') },
    {
      id: 'pdf',
      label: 'PDF로 저장(인쇄)',
      hint: `${pdfScope === 'document' ? '문서' : pdfScope === 'selection' ? '선택한 것' : '캔버스 전체'} · 인쇄 창에서 'PDF로 저장'을 골라요`,
      off: pdfScope !== 'document' && !canvasReady,
      run: onPdf,
    },
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
        <div role="menu" aria-label="내보내기" className="absolute right-0 top-9 z-30 w-64 rounded-lg border p-1 shadow-lg" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <fieldset data-export-options className="m-1 flex flex-col gap-1.5 border-b pb-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            <legend className="sr-only">이미지 옵션</legend>
            <div className="flex items-center gap-1" role="group" aria-label="PNG 크기">
              <span className="mr-auto px-1 text-xs" style={{ color: 'var(--text-muted)' }}>PNG 크기</span>
              {SCALES.map((s) => (
                <button key={s} type="button" data-export-scale={s} aria-pressed={options.scale === s} onClick={() => onOptions({ ...options, scale: s })} className="h-7 rounded-md border px-2 text-xs aria-pressed:font-semibold" style={{ borderColor: options.scale === s ? 'var(--brand)' : 'var(--border)' }}>
                  {s}배
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="색상">
              <span className="mr-auto px-1 text-xs" style={{ color: 'var(--text-muted)' }}>색상</span>
              {([false, true] as const).map((d) => (
                <button key={String(d)} type="button" data-export-dark={String(d)} aria-pressed={options.dark === d} onClick={() => onOptions({ ...options, dark: d })} className="h-7 rounded-md border px-2 text-xs aria-pressed:font-semibold" style={{ borderColor: options.dark === d ? 'var(--brand)' : 'var(--border)' }}>
                  {d ? '다크' : '라이트'}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 px-1 text-xs">
              <input type="checkbox" data-export-transparent checked={options.transparent} onChange={(e) => onOptions({ ...options, transparent: e.target.checked })} />
              배경을 투명하게
            </label>
          </fieldset>
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
