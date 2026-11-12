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
  view: View;
  onView: (v: View) => void;
  onTitle: (t: string) => void;
};

export function TopBar({ title, hasFile, status, view, onView, onTitle }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4" style={{ borderColor: 'var(--border)' }}>
      {hasFile ? (
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="제목 없는 파일"
          aria-label="파일 제목"
          className="h-8 w-56 rounded-md bg-transparent px-2 font-medium outline-none focus:ring-2"
        />
      ) : (
        <span className="px-2" style={{ color: 'var(--text-muted)' }}>
          파일을 골라 주세요
        </span>
      )}
      <span className="text-xs" style={{ color: 'var(--text-muted)' }} aria-live="polite">
        {status}
      </span>
      <div className="mx-auto flex rounded-md border p-0.5" style={{ borderColor: 'var(--border)' }} role="group" aria-label="보기 방식">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => onView(v.id)}
            className="h-7 rounded px-3 text-sm"
            style={view === v.id ? { background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 } : { color: 'var(--text-muted)' }}
          >
            {v.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled
        title="내보내기는 아직 준비 중이에요"
        className="h-8 rounded-md border px-3 text-sm opacity-50"
        style={{ borderColor: 'var(--border)' }}
      >
        내보내기
      </button>
    </header>
  );
}
