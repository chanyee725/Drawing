import { Download } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ImageKind } from './export/actions';
import { COPY_IMAGE_SHORTCUT, IS_MAC } from './platform';
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
  /** Below md the trigger is a 44px icon button (버전 기록 lives in the header's ⋯ menu). */
  narrow?: boolean;
};

/**
 * The option rows look like the header's segmented ToggleGroup (a muted track, the picked item raised) but keep
 * menu radio semantics, so arrow keys reach them inside the menu. Picking one keeps the menu open.
 */
// Keyboard focus draws an outline ring, so the picked-and-focused pill looks different from just picked
// (the raised background alone did not change). Below md the pills grow to a 40px touch target.
const track = 'flex h-7 items-center rounded-md bg-muted p-0.5 max-md:h-11';
const segment =
  'h-6 flex-none justify-center rounded-[5px] border border-transparent px-2 text-[13px] text-muted-foreground max-md:h-10 max-md:px-3 focus:bg-background/60 focus:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-ring forced-colors:focus-visible:outline-[Highlight] data-[state=checked]:border-border data-[state=checked]:bg-background data-[state=checked]:font-medium data-[state=checked]:text-foreground data-[state=checked]:shadow-xs';
const label = 'mr-auto px-1 text-[13px] text-muted-foreground';

export function ExportMenu({ open, onOpen, canvasReady, selected, options, onOptions, onImage, onMarkdown, pdfScope, onPdf, disabled, narrow }: Props) {
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
    { id: 'copy', label: '이미지로 복사', hint: describeExport(options), kbd: COPY_IMAGE_SHORTCUT, off: !canvasReady, run: () => onImage('copy') },
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
    <div className="shrink-0">
      <DropdownMenu open={open} onOpenChange={onOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          {narrow ? (
            <Button variant="outline" size="icon" disabled={disabled} aria-label="내보내기" title="내보내기" className="size-11">
              <Download />
            </Button>
          ) : (
            <Button variant="outline" disabled={disabled} title={`내보내기 (${IS_MAC ? '⌘E' : 'Ctrl+E'})`} className="whitespace-nowrap">
              내보내기
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent ref={contentRef} align="end" aria-label="내보내기" className="w-72">
          <div data-export-options className="flex min-w-0 flex-col gap-1.5 p-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span aria-hidden className={label}>PNG 크기</span>
              <DropdownMenuRadioGroup className={track} aria-label="PNG 크기" value={String(options.scale)} onValueChange={(v) => {
              const scale = SCALES.find((s) => String(s) === v);
              if (scale) onOptions({ ...options, scale });
            }}>
              {SCALES.map((s) => (
                <DropdownMenuRadioItem key={s} value={String(s)} data-export-scale={s} className={segment} onSelect={(e) => e.preventDefault()}>
                  {s}배
                </DropdownMenuRadioItem>
              ))}
              </DropdownMenuRadioGroup>
            </div>
            <div className="flex items-center gap-2">
              <span aria-hidden className={label}>색상</span>
              <DropdownMenuRadioGroup className={track} aria-label="색상" value={String(options.dark)} onValueChange={(v) => onOptions({ ...options, dark: v === 'true' })}>
              {([false, true] as const).map((d) => (
                <DropdownMenuRadioItem key={String(d)} value={String(d)} data-export-dark={String(d)} className={segment} onSelect={(e) => e.preventDefault()}>
                  {d ? '다크' : '라이트'}
                </DropdownMenuRadioItem>
              ))}
              </DropdownMenuRadioGroup>
            </div>
            <DropdownMenuCheckboxItem data-export-transparent checked={options.transparent} className="h-7 text-[13px]" onCheckedChange={(c) => onOptions({ ...options, transparent: c === true })} onSelect={(e) => e.preventDefault()}>
              배경을 투명하게
            </DropdownMenuCheckboxItem>
          </div>
          <DropdownMenuSeparator />
          {items.map((it) => (
            <DropdownMenuItem key={it.id} data-export={it.id} disabled={it.off} onSelect={() => it.run()} className="items-start max-md:min-h-11">
              <div className="flex min-w-0 flex-1 flex-col">
                <span>{it.label}</span>
                <span className="text-[13px] leading-[18px] text-muted-foreground">{it.off ? '캔버스가 보이는 보기에서 쓸 수 있어요' : it.hint}</span>
              </div>
              {it.kbd && <Kbd className="mt-0.5 shrink-0">{it.kbd}</Kbd>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
