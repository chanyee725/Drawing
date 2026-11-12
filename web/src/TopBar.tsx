import type { ReactNode } from 'react';

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
  onView: (v: View) => void;
  onTitle: (t: string) => void;
  /** Set on narrow screens, where the sidebar is collapsed behind this toggle. */
  onToggleNav?: () => void;
  /** The export button and its menu. */
  exportMenu?: ReactNode;
  /** Opens the version history of the open file. */
  onHistory?: () => void;
};

export function TopBar({ title, hasFile, status, statusAlert, view, onView, onTitle, onToggleNav, exportMenu, onHistory }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:gap-3 md:px-4" style={{ borderColor: 'var(--border)' }}>
      {onToggleNav && (
        <button type="button" onClick={onToggleNav} aria-label="파일 목록 열기" className="h-8 shrink-0 rounded-md px-2 text-lg leading-none">
          ☰
        </button>
      )}
      {hasFile ? (
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="제목 없는 파일"
          aria-label="파일 제목"
          className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 font-medium outline-none focus:ring-2 md:w-56 md:flex-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate px-2 md:flex-none" style={{ color: 'var(--text-muted)' }}>
          파일을 골라 주세요
        </span>
      )}
      <span
        className={`min-w-0 shrink-0 truncate text-xs md:shrink md:inline ${statusAlert ? 'inline font-medium' : 'hidden'}`}
        style={{ color: statusAlert ? 'var(--danger)' : 'var(--text-muted)' }}
        role={statusAlert ? 'alert' : undefined}
        aria-live="polite"
        title={status}
      >
        <span className="md:hidden">{statusAlert ? '저장 안 됨' : ''}</span>
        <span className="hidden md:inline">{status}</span>
      </span>
      <div className="flex shrink-0 rounded-md border p-0.5 md:mx-auto" style={{ borderColor: 'var(--border)' }} role="group" aria-label="보기 방식">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => onView(v.id)}
            className="h-7 whitespace-nowrap rounded px-2 text-sm md:px-3"
            style={view === v.id ? { background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 } : { color: 'var(--text-muted)' }}
          >
            {v.label}
          </button>
        ))}
      </div>
      {onHistory && (
        <button
          type="button"
          onClick={onHistory}
          disabled={!hasFile}
          aria-haspopup="dialog"
          className="h-8 shrink-0 whitespace-nowrap rounded-md border px-2 text-sm disabled:opacity-50 md:px-3"
          style={{ borderColor: 'var(--border)' }}
        >
          버전 기록
        </button>
      )}
      {exportMenu}
    </header>
  );
}
