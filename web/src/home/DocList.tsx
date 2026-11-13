// Document lists shared by the dashboard and the project home (layout B, doc 6 §3.1): full-width 41px rows
// with a bottom line, 24px indent per level, then 만든 때 / 고친 때 columns (만든 때 hidden on narrow screens).
import { ChevronRight, File, FolderClosed, MoreHorizontal } from 'lucide-react';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { useId } from 'react';
import type { ProjectDoc, RecentFile } from '../api';
import { cn } from '../lib/utils';
import { INDENT, ROW_HEIGHT, locationOf, relativeTime, runningBelow, subCount } from './model';

/** Left padding of a row (17px at the top level, as in the group head). */
const PAD = 16;
const ROW = 'group flex items-center gap-1 border-b pr-3 text-sm hover:bg-accent/60';
const TIME = 'w-20 shrink-0 text-right text-[13px] text-muted-foreground tabular-nums';
const CREATED = cn(TIME, 'hidden md:block');
const OPEN = 'flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** The time columns; screen readers hear the column name with the value (the head row is visual only). */
function Times({ created, modified, showCreated = true }: { created: number; modified: number; showCreated?: boolean }) {
  return (
    <>
      {showCreated && (
        <span className={CREATED}>
          <span className="sr-only">만든 때 </span>
          {relativeTime(created)}
        </span>
      )}
      <span className={TIME}>
        <span className="sr-only">고친 때 </span>
        {relativeTime(modified)}
      </span>
    </>
  );
}

function RowMenu({ path, title, onOpen, onDelete }: { path: string; title: string; onOpen: (p: string) => void; onDelete?: (p: string, t: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${title} 메뉴`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen(path)}>열기</DropdownMenuItem>
        {onDelete && (
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(path, title)}>
            보관함으로 보내기
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Column names above a list; visual only (each row names its own columns for screen readers). */
export function ColumnHead({ location = false, showCreated = true }: { location?: boolean; showCreated?: boolean }) {
  return (
    <div aria-hidden data-slot="column-head" className="flex h-8 items-center gap-1 border-b pr-3 text-[13px] text-muted-foreground" style={{ paddingLeft: PAD + 32 }}>
      <span className="min-w-0 flex-1">이름</span>
      {location && <span className="hidden w-48 shrink-0 sm:block">위치</span>}
      {showCreated && <span className={cn(CREATED, 'text-[13px]')}>만든 때</span>}
      <span className={TIME}>고친 때</span>
      <span className="size-7 shrink-0" />
    </div>
  );
}

type Props = {
  /** Top-level documents; sub-documents are their `children`. */
  docs: ProjectDoc[];
  /** Paths of folded parents (open by default). */
  collapsed: ReadonlySet<string>;
  onOpen: (path: string) => void;
  onToggle: (path: string) => void;
  onDelete?: (path: string, title: string) => void;
  showCreated?: boolean;
  label: string;
  /** Files with a run going now: their row gets a 실행 중 badge (a folded parent shows one for its sub-documents). */
  running?: ReadonlySet<string>;
};
type ItemProps = Omit<Props, 'docs' | 'label'> & { doc: ProjectDoc; depth: number };

function RunningBadge({ below }: { below?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-1.5 text-xs leading-[17px] text-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-ok" />
      {below ? '하위 실행 중' : '실행 중'}
    </span>
  );
}

/**
 * Nested document list: each sub-document list sits inside its parent's <li>, so screen readers keep the
 * hierarchy (level and count) without role=tree. Rows hold their own buttons, so Tab moves through them and the
 * chevron is a disclosure button (aria-expanded, aria-controls) rather than a tree item needing arrow keys.
 * role="list" because list-style:none drops list semantics in Safari.
 */
export function DocList({ docs, label, ...rest }: Props) {
  return (
    <ul role="list" aria-label={label} className="m-0 list-none p-0">
      {docs.map((doc) => (
        <DocItem key={doc.path} doc={doc} depth={0} {...rest} />
      ))}
    </ul>
  );
}

function DocItem({ doc, depth, collapsed, onOpen, onToggle, onDelete, showCreated = true, running }: ItemProps) {
  const listId = useId();
  const expandable = doc.children.length > 0;
  const expanded = expandable && !collapsed.has(doc.path);
  const subs = subCount(doc);
  const self = !!running?.has(doc.path);
  const below = expandable && !expanded && !!running && runningBelow(doc, running);
  const folded = expandable && !expanded && (
    <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">하위 {subs}</span>
  );
  return (
    <li data-doc-row={doc.path} data-depth={depth}>
      <div className={ROW} style={{ height: ROW_HEIGHT, paddingLeft: PAD + depth * INDENT }}>
        {expandable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${doc.title} 하위 문서`}
            aria-expanded={expanded}
            aria-controls={expanded ? listId : undefined}
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
            {folded}
            {below && <RunningBadge below />}
          </span>
        ) : (
          <button type="button" onClick={() => onOpen(doc.path)} className={OPEN}>
            <File className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{doc.title}</span>
            {folded}
            {self && <RunningBadge />}
            {below && !self && <RunningBadge below />}
          </button>
        )}
        <Times created={doc.createdAt} modified={doc.modifiedAt} showCreated={showCreated} />
        {doc.bundle ? <span className="size-7 shrink-0" aria-hidden /> : <RowMenu path={doc.path} title={doc.title} onOpen={onOpen} onDelete={onDelete} />}
      </div>
      {expanded && (
        <ul role="list" id={listId} aria-label={`${doc.title} 하위 문서`} className="m-0 list-none p-0">
          {doc.children.map((c) => (
            <DocItem key={c.path} doc={c} depth={depth + 1} collapsed={collapsed} onOpen={onOpen} onToggle={onToggle} onDelete={onDelete} showCreated={showCreated} running={running} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Flat file list with a 위치 column (전체 and 최근 tabs). */
export function FileList({ files, label, onOpen, onDelete }: { files: RecentFile[]; label: string; onOpen: (path: string) => void; onDelete?: (path: string, title: string) => void }) {
  return (
    <ul role="list" aria-label={label} className="m-0 list-none p-0">
      {files.map((f) => (
        <li key={f.path} data-doc-row={f.path} className={ROW} style={{ height: ROW_HEIGHT, paddingLeft: PAD }}>
          <span className="size-7 shrink-0" aria-hidden />
          <button type="button" onClick={() => onOpen(f.path)} className={OPEN}>
            <File className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{f.title}</span>
          </button>
          <span className="hidden w-48 shrink-0 truncate text-[13px] text-muted-foreground sm:block">
            <span className="sr-only">위치 </span>
            {locationOf(f)}
          </span>
          <Times created={f.createdAt} modified={f.modifiedAt} />
          <RowMenu path={f.path} title={f.title} onOpen={onOpen} onDelete={onDelete} />
        </li>
      ))}
    </ul>
  );
}
