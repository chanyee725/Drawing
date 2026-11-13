// Command registry for the Ctrl/Cmd+K menu. Features register a source (a function that lists their commands
// with fresh state); the menu reads every source each time it opens, so no command list goes stale.
import { createContext, useContext, useEffect, useRef, type ComponentType } from 'react';

/** Menu sections, in display order. */
export const GROUPS = [
  { id: 'action', label: '동작' },
  { id: 'view', label: '보기' },
  { id: 'canvas', label: '캔버스' },
  { id: 'block', label: '블록' },
  { id: 'file', label: '파일' },
] as const;
export type CommandGroup = (typeof GROUPS)[number]['id'];

export type Command = {
  id: string;
  title: string;
  /** Section in the menu; defaults to 'action'. */
  group?: CommandGroup;
  /** Shortcut shown on the right, e.g. 'Shift+Alt+C'. */
  keys?: string;
  /** Short note after the title (why it is disabled, or a folder for a file). */
  hint?: string;
  disabled?: boolean;
  /** Extra words the search matches (English names, synonyms). */
  keywords?: string[];
  icon?: ComponentType<{ className?: string }>;
  /** Shown only while the user searches (e.g. files, which would crowd the empty menu). */
  searchOnly?: boolean;
  run: () => void;
};

export type CommandSource = () => readonly Command[];

/** Commands whose title or keyword contains the query (case-insensitive); an empty query keeps all but search-only ones. */
export function filterCommands(items: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter((c) => !c.searchOnly);
  return items.filter((c) => c.title.toLowerCase().includes(q) || (c.keywords ?? []).some((k) => k.toLowerCase().includes(q)));
}

/** Splits commands into the menu's sections (GROUPS order, registration order inside), dropping empty ones. */
export function groupCommands(items: readonly Command[]): { id: CommandGroup; label: string; items: Command[] }[] {
  return GROUPS.map((g) => ({ ...g, items: items.filter((c) => (c.group ?? 'action') === g.id) })).filter((g) => g.items.length > 0);
}

export class CommandRegistry {
  private sources = new Map<string, CommandSource>();

  /** Adds (or replaces) the source named `name`; the returned function removes it again. */
  register(name: string, source: CommandSource): () => void {
    this.sources.set(name, source);
    return () => {
      if (this.sources.get(name) === source) this.sources.delete(name);
    };
  }

  /** Every registered command, sources in registration order; a later duplicate id is dropped. */
  list(): Command[] {
    const seen = new Set<string>();
    const out: Command[] = [];
    for (const source of this.sources.values()) {
      for (const c of source()) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
      }
    }
    return out;
  }
}

export const CommandRegistryContext = createContext<CommandRegistry | null>(null);

export function useCommandRegistry(): CommandRegistry {
  const r = useContext(CommandRegistryContext);
  if (!r) throw new Error('useCommandRegistry needs a CommandRegistryContext provider');
  return r;
}

/** Registers `source` under `name` in `registry` while the calling component is mounted; the latest render's source is used. */
export function useCommandSource(registry: CommandRegistry, name: string, source: CommandSource): void {
  const latest = useRef(source);
  latest.current = source;
  useEffect(() => registry.register(name, () => latest.current()), [registry, name]);
}

/** useCommandSource with the registry from context, for features below the app root. */
export function useRegisterCommands(name: string, source: CommandSource): void {
  useCommandSource(useCommandRegistry(), name, source);
}
