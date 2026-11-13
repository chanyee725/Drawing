import { useEffect, useRef } from 'react';
import type { ImageKind } from './export/actions';
import { IS_MAC } from './platform';
import { SCALES, describeExport, type ExportOptions } from './export/options';
import { Button } from './components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { Kbd } from './components/ui/kbd';

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

/** A pill that sets an option and keeps the menu open. */
const pill = 'h-7 flex-none justify-center rounded-md border px-2 text-xs data-[state=checked]:border-primary data-[state=checked]:bg-muted data-[state=checked]:font-semibold data-[state=checked]:text-foreground';
const keep = (fn: () => void) => (e: Event) => {
  e.preventDefault();
  fn();
};

export function ExportMenu({ open, onOpen, canvasReady, selected, options, onOptions, onImage, onMarkdown, pdfScope, onPdf, disabled }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  // The option pills come first in the DOM, so Radix's keyboard entry focus lands on "1배" and
  // Ctrl+E → Enter would change the PNG size. Move focus to the first export action once open.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>('[data-export]:not([data-disabled])')?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  const scope = selected ? '선택한 것' : '캔버스 전체';
  const items: { label: string; hint: string; kbd?: string; off: boolean; run: () => void; id: string }[] = [
    { id: 'svg', label: 'SVG로 내보내기', hint: `${scope} · ${describeExport({ ...options, scale: 1 }).split(' · ').slice(1).join(' · ')}`, off: !canvasReady, run: () => onImage('svg') },
    { id: 'png', label: 'PNG로 내보내기', hint: `${scope} · ${describeExport(options)}`, off: !canvasReady, run: () => onImage('png') },
    { id: 'copy', label: '이미지로 복사', hint: describeExport(options), kbd: 'Shift+Alt+C', off: !canvasReady, run: () => onImage('copy') },
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
    <div className="hidden shrink-0 md:block">
      <DropdownMenu open={open} onOpenChange={onOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={disabled} title={`내보내기 (${IS_MAC ? '⌘E' : 'Ctrl+E'})`} className="whitespace-nowrap">
            내보내기
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent ref={contentRef} align="end" aria-label="내보내기" className="w-72">
          <fieldset data-export-options className="m-0 flex min-w-0 flex-col gap-1 border-0 p-1 text-sm">
            <legend className="sr-only">이미지 옵션</legend>
            <DropdownMenuRadioGroup className="flex items-center gap-1" aria-label="PNG 크기" value={String(options.scale)} onValueChange={(v) => onOptions({ ...options, scale: Number(v) as ExportOptions['scale'] })}>
              <span className="mr-auto px-1 text-xs text-muted-foreground">PNG 크기</span>
              {SCALES.map((s) => (
                <DropdownMenuRadioItem key={s} value={String(s)} data-export-scale={s} className={pill} onSelect={keep(() => {})}>
                  {s}배
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuRadioGroup className="flex items-center gap-1" aria-label="색상" value={String(options.dark)} onValueChange={(v) => onOptions({ ...options, dark: v === 'true' })}>
              <span className="mr-auto px-1 text-xs text-muted-foreground">색상</span>
              {([false, true] as const).map((d) => (
                <DropdownMenuRadioItem key={String(d)} value={String(d)} data-export-dark={String(d)} className={pill} onSelect={keep(() => {})}>
                  {d ? '다크' : '라이트'}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuCheckboxItem data-export-transparent checked={options.transparent} className="h-7 text-xs" onCheckedChange={(c) => onOptions({ ...options, transparent: c === true })} onSelect={(e) => e.preventDefault()}>
              배경을 투명하게
            </DropdownMenuCheckboxItem>
          </fieldset>
          <DropdownMenuSeparator />
          {items.map((it) => (
            <DropdownMenuItem key={it.id} data-export={it.id} disabled={it.off} title={it.off ? '캔버스가 보이는 보기에서 쓸 수 있어요' : undefined} onSelect={() => it.run()} className="items-start">
              <div className="flex min-w-0 flex-1 flex-col">
                <span>{it.label}</span>
                <span className="text-xs text-muted-foreground">{it.off ? '캔버스가 보이는 보기에서 쓸 수 있어요' : it.hint}</span>
              </div>
              {it.kbd && <Kbd className="mt-0.5 shrink-0">{it.kbd}</Kbd>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
