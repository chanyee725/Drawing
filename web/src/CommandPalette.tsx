import { useEffect, useMemo, useRef, useState } from 'react';

export type Command = { id: string; title: string; keys?: string; hint?: string; disabled?: boolean; keywords?: string[]; run: () => void };

/** Commands whose title or keyword contains the query (case-insensitive); an empty query keeps all. */
export function filterCommands(items: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((c) => c.title.toLowerCase().includes(q) || (c.keywords ?? []).some((k) => k.toLowerCase().includes(q)));
}

type Props = { commands: Command[]; onClose: () => void };

export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => filterCommands(commands, query), [commands, query]);
  // Focus returns to where it was before the palette opened (unless a command moves it itself).
  const opener = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    input.current?.focus();
    const back = opener.current;
    return () => {
      // Skip when focus already moved on to something real (not the palette's own input or body).
      const now = document.activeElement;
      if (back instanceof HTMLElement && back.isConnected && (!now || now === document.body || now === input.current)) back.focus();
    };
  }, []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    document.querySelector(`[data-cmd-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (c: Command | undefined) => {
    if (!c || c.disabled) return;
    onClose();
    // After the palette closes, so a canvas command sees the canvas focused again.
    setTimeout(c.run, 0);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(list[index]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" style={{ background: 'rgb(0 0 0 / 0.3)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="명령 팔레트" className="w-[min(32rem,calc(100%-2rem))] overflow-hidden rounded-lg border shadow-xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }} onKeyDown={onKey}>
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={list[index] ? `cmd-${list[index].id}` : undefined}
          placeholder="무엇을 할까요?"
          aria-label="명령 찾기"
          className="h-11 w-full border-b bg-transparent px-3 outline-none"
          style={{ borderColor: 'var(--border)' }}
        />
        <ul id="cmd-list" role="listbox" className="max-h-80 overflow-auto p-1">
          {list.length === 0 && (
            <li className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              맞는 명령이 없어요
            </li>
          )}
          {list.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === index}
              aria-disabled={c.disabled || undefined}
              data-cmd-index={i}
              data-cmd={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm"
              style={{ background: i === index ? 'var(--accent-soft)' : undefined, opacity: c.disabled ? 0.5 : 1 }}
            >
              <span className="flex-1">
                {c.title}
                {c.hint && (
                  <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {c.hint}
                  </span>
                )}
              </span>
              {c.keys && (
                <kbd className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {c.keys}
                </kbd>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
