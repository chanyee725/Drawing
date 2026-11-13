import type { ReactNode } from 'react';
import { Clock, Menu, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import { Kbd } from './components/ui/kbd';
import { Segmented, SegmentedItem } from './components/ui/segmented';
import { FOCUS_RING } from './lib/focus';
import { cn } from './lib/utils';
import { IS_MAC } from './platform';

export type View = 'doc' | 'both' | 'canvas';

const VIEWS: { id: View; label: string }[] = [
  { id: 'doc', label: '문서' },
  { id: 'both', label: '둘 다' },
  { id: 'canvas', label: '캔버스' },
];

type Props = {
  title: string;
  hasFile: boolean;
  status: string;
  /** The status is a problem: keep it visible on narrow screens. */
  statusAlert?: boolean;
  view: View;
  /** Below md: one pane at a time, so no 둘 다; 버전 기록 lives in the ⋯ menu. */
  narrow?: boolean;
  onView: (v: View) => void;
  onTitle: (t: string) => void;
  /** Set on narrow screens, where the sidebar is collapsed behind this toggle. */
  onToggleNav?: () => void;
  /** The export button and its menu. */
  exportMenu?: ReactNode;
  /** Opens the version history of the open file. */
  onHistory?: () => void;
  /** Opens the command menu (also Ctrl/Cmd+K). */
  onCommands?: () => void;
};

export function TopBar({ title, hasFile, status, statusAlert, view, narrow, onView, onTitle, onToggleNav, exportMenu, onHistory, onCommands }: Props) {
  return (
    <header className="flex h-(--h-bar) shrink-0 items-center gap-2 border-b bg-sidebar px-2 md:gap-3 md:px-3">
      {onToggleNav && (
        <Button variant="ghost" size="icon-sm" onClick={onToggleNav} aria-label="파일 목록 열기" className={FOCUS_RING}>
          <Menu />
        </Button>
      )}
      {hasFile ? (
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="제목 없는 파일"
          aria-label="파일 제목"
          className={`h-(--h-row) min-w-0 flex-1 rounded-md bg-transparent px-2 text-base font-medium outline-none placeholder:text-muted-foreground hover:bg-accent focus-visible:bg-background md:w-56 md:flex-none ${FOCUS_RING}`}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate px-2 text-muted-foreground md:flex-none">파일을 골라 주세요</span>
      )}
      <span
        className={cn('min-w-0 shrink-0 items-center gap-1.5 truncate text-xs md:inline-flex md:shrink', statusAlert ? 'inline-flex font-medium text-destructive' : 'hidden text-muted-foreground')}
        role={statusAlert ? 'alert' : undefined}
        aria-live="polite"
        title={status}
      >
        {status && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', statusAlert ? 'bg-destructive' : 'bg-muted-foreground')} />}
        <span className="md:hidden">{statusAlert ? '저장 안 됨' : ''}</span>
        <span className="hidden truncate md:inline">{status}</span>
      </span>
      <Segmented className="shrink-0 md:mx-auto" aria-label="보기 방식">
        {VIEWS.filter((v) => !narrow || v.id !== 'both').map((v) => (
          <SegmentedItem key={v.id} active={view === v.id} onClick={() => onView(v.id)} className={cn('px-2 md:px-3', FOCUS_RING)}>
            {v.label}
          </SegmentedItem>
        ))}
      </Segmented>
      {onCommands && (
        <Button variant="ghost" size="sm" onClick={onCommands} aria-label="명령 메뉴 열기" aria-haspopup="dialog" className={cn('hidden text-muted-foreground md:inline-flex', FOCUS_RING)}>
          <Search />
          <Kbd>{IS_MAC ? '⌘K' : 'Ctrl K'}</Kbd>
        </Button>
      )}
      {onHistory && (
        <Button variant="outline" size="sm" onClick={onHistory} disabled={!hasFile} aria-haspopup="dialog" className={cn('hidden shrink-0 md:inline-flex', FOCUS_RING)}>
          <Clock className="hidden md:block" />
          버전 기록
        </Button>
      )}
      {exportMenu}
    </header>
  );
}
