import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Command as CommandPrimitive } from 'cmdk';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from './components/ui/command';
import { DialogContent } from './components/ui/dialog';
import { Kbd } from './components/ui/kbd';
import { filterCommands, groupCommands, type Command as Cmd } from './commands';

export { filterCommands } from './commands';
export type { Command } from './commands';

type Props = { commands: Cmd[]; onClose: () => void };

/** The Ctrl/Cmd+K menu: one search box over every registered command, in sections, keyboard first. */
export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => filterCommands(commands, query), [commands, query]);
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
        className="top-[15vh] w-[min(560px,calc(100%-2rem))] translate-y-0 rounded-lg bg-popover shadow-pop"
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
          <CommandInput
            ref={input}
            value={query}
            onValueChange={setQuery}
            placeholder="명령이나 파일 이름을 입력해요"
            className="h-11"
          />
          <CommandList className="max-h-[min(400px,60vh)]">
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
                      className="h-8 cursor-pointer rounded-md py-0 data-[selected=true]:bg-brand-soft"
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
        <div className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> 이동
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> 실행
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> 닫기
          </span>
        </div>
      </DialogContent>
    </DialogPrimitive.Root>
  );
}
