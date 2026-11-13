import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Command as CommandPrimitive } from 'cmdk';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from './components/ui/command';
import { DialogContent } from './components/ui/dialog';
import { Kbd } from './components/ui/kbd';
import { FolderClosed } from 'lucide-react';
import { cn } from './lib/utils';
import { filterCommands, groupCommands, type Command as Cmd } from './commands';

export { filterCommands } from './commands';
export type { Command } from './commands';

type Props = {
  commands: Cmd[];
  onClose: () => void;
  /** Project the user is in: its name is shown as a chip, and its files (under its path) are listed first. */
  scope?: { path: string; name: string } | null;
  /** Start with only this section (G P opens the menu on projects). */
  onlyGroup?: Cmd['group'];
};

/** Documents of the current project shown before the user types. */
const SCOPE_DOCS = 6;

/** The Ctrl/Cmd+K menu: one search box over every registered command, in sections, keyboard first. */
export function CommandPalette({ commands, onClose, scope, onlyGroup }: Props) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(onlyGroup);
  const list = useMemo(() => {
    const inScope = (c: Cmd) => !!scope && !!c.hint?.startsWith(`${scope.path}/`);
    // With no search, the 문서 section lists the current project's documents (files are otherwise search-only).
    const scoped = !query.trim() ? commands.filter((c) => c.searchOnly && inScope(c)).slice(0, SCOPE_DOCS) : [];
    const found = [...scoped, ...filterCommands(commands, query)].filter((c) => !group || c.group === group);
    // Files of the current project come first inside their section.
    return scope ? [...found.filter(inScope), ...found.filter((c) => !inScope(c))] : found;
  }, [commands, query, group, scope]);
  const groups = useMemo(() => groupCommands(list), [list]);
  // Sections reorder the list, so the first row on screen is the first enabled one in section order.
  const first = useMemo(() => groups.flatMap((g) => g.items).find((c) => !c.disabled)?.id ?? '', [groups]);
  const [selected, setSelected] = useState(first);
  // Only a new search resets the selection; the list itself is rebuilt on every app render.
  useEffect(() => setSelected(first), [query]);
  const input = useRef<HTMLInputElement>(null);

  // Focus returns to where it was before the menu opened (unless a command moves it itself).
  const opener = useRef<Element | null>(document.activeElement);
  // focus() alone puts the caret back at the document start in an editor, so keep the range too.
  const [saved] = useState<Range | null>(() => {
    const sel = window.getSelection();
    return sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  });
  useEffect(() => {
    const back = opener.current;
    return () => {
      // Skip when focus already moved on to something real (not the menu's own input or body).
      const now = document.activeElement;
      if (back instanceof HTMLElement && back.isConnected && (!now || now === document.body || now === input.current)) {
        back.focus();
        const sel = window.getSelection();
        if (saved && sel && saved.startContainer.isConnected && back.contains(saved.commonAncestorContainer)) {
          sel.removeAllRanges();
          sel.addRange(saved);
        }
      }
    };
  }, []);

  const run = (c: Cmd) => {
    if (c.disabled) return;
    onClose();
    // After the menu closes, so a canvas command sees the canvas focused again.
    setTimeout(c.run, 0);
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        // 648px at 14% from the top (design doc 6 §2.5); under 640px it docks to the top edge, full width.
        overlayClassName="bg-black/50"
        className={cn(
          'top-[14%] w-[min(648px,calc(100%-2rem))] translate-y-0 rounded-lg bg-popover shadow-pop',
          'max-sm:top-0 max-sm:w-full max-sm:rounded-t-none max-sm:border-x-0 max-sm:border-t-0 max-sm:pt-[env(safe-area-inset-top)]',
        )}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
        // The unmount effect above restores focus and the editor selection; Radix would only restore focus.
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (e.isComposing) e.preventDefault();
        }}
      >
        <DialogPrimitive.Title className="sr-only">명령 팔레트</DialogPrimitive.Title>
        <Command shouldFilter={false} loop value={selected} onValueChange={setSelected} label="명령 찾기" className="rounded-lg bg-transparent">
          <div className="flex items-center border-b pr-3 [&>div]:flex-1 [&>div]:border-b-0">
            <CommandInput
              ref={input}
              value={query}
              // G P keeps the menu on projects while typing; Backspace in an empty box widens it to everything.
              onValueChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !query && group && !e.nativeEvent.isComposing) setGroup(undefined);
              }}
              placeholder={group === 'project' ? '프로젝트 이름을 입력해요' : '명령이나 파일 이름을 입력해요'}
              className="h-11"
            />
            {group === 'project' && (
              <span data-slot="group-chip" title="지우기를 누르면 모든 명령을 찾아요" className="mr-1.5 shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground">
                프로젝트만
              </span>
            )}
            {scope && (
              <span data-slot="scope-chip" title={`범위: ${scope.name} 프로젝트`} className="inline-flex max-w-40 shrink-0 items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                <FolderClosed aria-hidden className="size-3 shrink-0" />
                <span className="sr-only">범위:</span>
                <span className="truncate">{scope.name}</span>
              </span>
            )}
          </div>
          <CommandList className="max-h-[min(400px,60vh)] max-sm:max-h-[min(480px,70dvh)]">
            <CommandEmpty>맞는 명령이 없어요</CommandEmpty>
            {groups.map((g) => (
              <CommandPrimitive.Group
                key={g.id}
                heading={g.label}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {g.items.map((c) => {
                  const Icon = c.icon;
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      disabled={c.disabled}
                      onSelect={() => run(c)}
                      data-cmd={c.id}
                      className="h-8 cursor-pointer rounded-md py-0 max-sm:h-11 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                    >
                      {Icon && <Icon className="size-4 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate">
                        {c.title}
                        {c.hint && <span className="ml-2 text-xs text-muted-foreground">{c.hint}</span>}
                      </span>
                      {c.keys && <CommandShortcut className="tracking-normal">{c.keys}</CommandShortcut>}
                    </CommandItem>
                  );
                })}
              </CommandPrimitive.Group>
            ))}
          </CommandList>
        </Command>
        <div className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground max-sm:hidden" aria-hidden>
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> 이동
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> 열기
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> 닫기
          </span>
        </div>
      </DialogContent>
    </DialogPrimitive.Root>
  );
}
