import { FileText, Folder, Plus } from 'lucide-react';
import type { DocNode } from './api';
import { Button } from './components/ui/button';
import { FOCUS_RING } from './lib/focus';
import { cn } from './lib/utils';
import { displayName } from './Sidebar';

type Props = {
  /** The open document in the projects view; null until the view has it (a file just made). */
  node: DocNode | null;
  onOpen: (path: string) => void;
  onAdd: () => void;
};

const countText = (n: number) => (n ? `하위 ${n}개` : '');

/** The sub-document block at the end of a document (design doc 6 §2.4): same data as the sidebar. */
export function SubDocs({ node, onOpen, onAdd }: Props) {
  const children = node?.children ?? [];
  return (
    <section aria-labelledby="subdocs-title" className="mx-auto w-full max-w-3xl px-6 pb-12">
      <div className="border-t pt-4">
        <h2 id="subdocs-title" className="mb-1 px-2 text-sm font-semibold text-muted-foreground">
          하위 문서
        </h2>
        {children.length ? (
          <ul>
            {children.map((c) => (
              <li key={c.path}>
                {c.type === 'doc' ? (
                  <button type="button" onClick={() => onOpen(c.path)} className={cn('flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent max-md:min-h-11', FOCUS_RING)}>
                    <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{displayName(c)}</span>
                    <span className="num shrink-0 text-xs text-muted-foreground">{countText(c.count)}</span>
                  </button>
                ) : (
                  // A folder without its own document: shown so the list matches the sidebar, nothing to open.
                  <div className="flex min-h-10 items-center gap-2 px-2 text-sm text-muted-foreground">
                    <Folder aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="num shrink-0 text-xs">{countText(c.count)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-2 text-sm text-muted-foreground">아직 하위 문서가 없어요.</p>
        )}
        <Button variant="ghost" size="sm" onClick={onAdd} className={cn('mt-1 text-muted-foreground max-md:min-h-11', FOCUS_RING)}>
          <Plus />
          하위 문서 추가
        </Button>
      </div>
    </section>
  );
}
