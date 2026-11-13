// Nested document list shared by the dashboard and the project home: 41px rows, 24px indent per level.
import { ChevronRight, File, FolderClosed, MoreHorizontal } from 'lucide-react';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { cn } from '../lib/utils';
import { INDENT, ROW_HEIGHT, relativeTime, type Row } from './model';

type Props = {
  rows: Row[];
  onOpen: (path: string) => void;
  onToggle: (path: string) => void;
  onDelete?: (path: string, title: string) => void;
  /** Show a "created" column (the project home does, the dashboard keeps it short). */
  showCreated?: boolean;
  label: string;
  /** Files with a run going now: their row gets a 실행 중 badge. */
  running?: ReadonlySet<string>;
};

export function DocList({ rows, onOpen, onToggle, onDelete, showCreated = true, label, running }: Props) {
  return (
    // A plain list, not role=tree: rows hold their own buttons, so Tab moves through them and the
    // chevron is a disclosure button (aria-expanded) rather than a tree item needing arrow-key handling.
    <ul aria-label={label} className="m-0 list-none p-0">
      {rows.map(({ doc, depth, subs, expandable, expanded }) => (
        <li
          key={doc.path}
          data-doc-row={doc.path}
          data-depth={depth}
          className="group flex items-center gap-1 border-b pr-2 text-sm hover:bg-accent/60"
          style={{ height: ROW_HEIGHT, paddingLeft: depth * INDENT + 4 }}
        >
          {expandable ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${doc.title} 하위 문서`}
              aria-expanded={expanded}
              onClick={() => onToggle(doc.path)}
            >
              <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
            </Button>
          ) : (
            <span className="size-7 shrink-0" aria-hidden />
          )}
          {doc.bundle ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
              <FolderClosed className="size-4 shrink-0" />
              <span className="truncate">{doc.title}</span>
              {expandable && !expanded && <span className="shrink-0 text-[13px] tabular-nums">하위 {subs}</span>}
            </span>
          ) : (
            <button type="button" onClick={() => onOpen(doc.path)} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <File className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{doc.title}</span>
              {expandable && !expanded && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">하위 {subs}</span>}
              {running?.has(doc.path) && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-1.5 text-xs leading-[17px] text-foreground">
                  <span aria-hidden className="size-1.5 rounded-full bg-ok" />
                  실행 중
                </span>
              )}
            </button>
          )}
          {showCreated && <span className="hidden w-20 shrink-0 text-right text-[13px] text-muted-foreground md:block">{relativeTime(doc.createdAt)}</span>}
          <span className="w-20 shrink-0 text-right text-[13px] text-muted-foreground">{relativeTime(doc.modifiedAt)}</span>
          {!doc.bundle && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${doc.title} 메뉴`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onOpen(doc.path)}>열기</DropdownMenuItem>
                {onDelete && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(doc.path, doc.title)}>
                    보관함으로 보내기
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </li>
      ))}
    </ul>
  );
}
