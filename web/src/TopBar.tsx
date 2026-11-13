import type { ReactNode } from 'react';
import { Clock, FilePlus, Menu, MoreHorizontal, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { Kbd } from './components/ui/kbd';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { FOCUS_RING } from './lib/focus';
import { cn } from './lib/utils';
import { IS_MAC } from './platform';
import type { Crumb } from './projectNav';

export type View = 'doc' | 'both' | 'canvas';

const VIEWS: { id: View; label: string }[] = [
  { id: 'doc', label: '문서' },
  { id: 'both', label: '둘 다' },
  { id: 'canvas', label: '캔버스' },
];
// 390px: one pane at a time (design doc 6 §6).
const NARROW_VIEWS = VIEWS.filter((v) => v.id !== 'both');

// 44px touch targets on narrow screens (design doc 6 §5).
const TOUCH = 'max-md:min-h-11 max-md:min-w-11';

type Props = {
  title: string;
  hasFile: boolean;
  status: string;
  /** The status is a problem: keep it visible on narrow screens. */
  statusAlert?: boolean;
  /** The view shown (on narrow screens never 'both'). */
  view: View;
  onView: (v: View) => void;
  onTitle: (t: string) => void;
  /** Narrow screen: the sidebar is a drawer behind the menu button and the view switch has two choices. */
  narrow?: boolean;
  onToggleNav?: () => void;
  /** Project, documents and groups above the open document. */
  trail?: Crumb[];
  onCrumb?: (c: Crumb) => void;
  /** The export button and its menu. */
  exportMenu?: ReactNode;
  /** Opens the version history of the open file. */
  onHistory?: () => void;
  /** Adds a document below the open one. */
  onSubDoc?: () => void;
  /** Opens the command menu (also Ctrl/Cmd+K). */
  onCommands?: () => void;
};

/** The document screen's 52px header (design doc 6 §2.4, frame A). */
export function TopBar({ title, hasFile, status, statusAlert, view, onView, onTitle, narrow, onToggleNav, trail = [], onCrumb, exportMenu, onHistory, onSubDoc, onCommands }: Props) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b bg-panel px-2 md:gap-3 md:px-3">
      {onToggleNav && (
        <Button variant="ghost" size="icon-sm" onClick={onToggleNav} aria-label="파일 목록 열기" className={cn(TOUCH, FOCUS_RING)}>
          <Menu />
        </Button>
      )}
      {hasFile ? (
        <nav aria-label="경로" className="flex min-w-0 flex-1 items-center md:flex-initial">
          <ol className="crumbs flex min-w-0 items-center text-muted-foreground">
            {trail.map((c) => (
              // Ancestors shrink first and are hidden on narrow screens; the open document never truncates away.
              <li key={c.path} className="hidden min-w-0 shrink items-center md:flex">
                {c.kind === 'group' ? (
                  <span className="max-w-40 truncate px-1" title={c.label}>
                    {c.label}
                  </span>
                ) : (
                  <button type="button" onClick={() => onCrumb?.(c)} title={c.label} className={cn('max-w-40 truncate rounded-sm px-1 hover:text-foreground hover:underline', FOCUS_RING)}>
                    {c.label}
                  </button>
                )}
              </li>
            ))}
            <li className="flex min-w-0 flex-1 items-center">
              <input
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder="제목 없는 파일"
                aria-label="파일 제목"
                aria-current="page"
                className={`h-(--h-row) w-full min-w-24 rounded-md bg-transparent px-2 text-base font-medium text-foreground outline-none placeholder:text-muted-foreground hover:bg-accent focus-visible:bg-background md:w-56 ${FOCUS_RING}`}
              />
            </li>
          </ol>
        </nav>
      ) : (
        <span className="min-w-0 flex-1 truncate px-2 text-muted-foreground md:flex-none">파일을 골라 주세요</span>
      )}
      <span
        className={cn('min-w-0 shrink-0 items-center gap-1.5 truncate text-xs md:inline-flex md:shrink', statusAlert ? 'inline-flex font-medium text-destructive' : 'hidden text-muted-foreground')}
        role={statusAlert ? 'alert' : undefined}
        aria-live="polite"
        title={status}
      >
        {status && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', statusAlert ? 'bg-destructive' : 'bg-text-4')} />}
        <span className="md:hidden">{statusAlert ? '저장 안 됨' : ''}</span>
        <span className="hidden truncate md:inline">{status}</span>
      </span>
      <ToggleGroup variant="segmented" size="sm" value={view} onValueChange={(v) => onView(v as View)} aria-label="보기 방식" className={cn('shrink-0 md:mx-auto', narrow && 'h-12')}>
        {(narrow ? NARROW_VIEWS : VIEWS).map((v) => (
          <ToggleGroupItem key={v.id} value={v.id} className={cn('px-2 md:px-3', narrow && 'h-11 min-w-11', FOCUS_RING)}>
            {v.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {onCommands && (
        <Button variant="ghost" size="sm" onClick={onCommands} aria-label="명령 메뉴 열기" aria-haspopup="dialog" className={cn('hidden text-muted-foreground md:inline-flex', FOCUS_RING)}>
          <Search />
          <Kbd>{IS_MAC ? '⌘K' : 'Ctrl K'}</Kbd>
        </Button>
      )}
      {exportMenu}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="더 보기" title="더 보기" className={cn(TOUCH, FOCUS_RING)}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label="더 보기">
          {onHistory && (
            <DropdownMenuItem disabled={!hasFile} onSelect={onHistory} className="max-md:min-h-11">
              <Clock />
              버전 기록
            </DropdownMenuItem>
          )}
          {onSubDoc && (
            <DropdownMenuItem disabled={!hasFile} onSelect={onSubDoc} className="max-md:min-h-11">
              <FilePlus />
              하위 문서 추가
            </DropdownMenuItem>
          )}
          {onCommands && narrow && (
            <DropdownMenuItem onSelect={onCommands} className="max-md:min-h-11">
              <Search />
              명령 메뉴
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
