import { useEffect, useState } from 'react';

type View = 'doc' | 'both' | 'canvas';

const VIEWS: { id: View; label: string }[] = [
  { id: 'doc', label: '문서' },
  { id: 'both', label: '둘 다' },
  { id: 'canvas', label: '캔버스' },
];

function useWorkspaceName() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setName(d?.workspace || null))
      .catch(() => setName(null));
  }, []);
  return name;
}

function Sidebar({ workspace }: { workspace: string | null }) {
  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r"
      style={{ background: 'var(--elevated)', borderColor: 'var(--border)' }}
    >
      <div className="flex h-12 items-center gap-2 px-4 font-semibold">
        <span className="inline-block size-5 rounded-md" style={{ background: 'var(--accent)' }} aria-hidden />
        <span className="truncate">{workspace ?? 'Drawing'}</span>
      </div>
      <div className="px-3 pb-2">
        <input
          type="search"
          disabled
          placeholder="파일 검색"
          aria-label="파일 검색"
          className="h-8 w-full rounded-md border px-2 text-sm outline-none"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
      </div>
      <div className="flex items-center justify-between px-4 pt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>파일</span>
        <button type="button" disabled className="rounded px-1.5 text-base leading-none opacity-50" aria-label="새 파일">
          +
        </button>
      </div>
      <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
        아직 파일이 없어요.
      </p>
    </aside>
  );
}

function TopBar({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4" style={{ borderColor: 'var(--border)' }}>
      <span className="truncate font-medium" style={{ color: 'var(--text-muted)' }}>
        제목 없는 파일
      </span>
      <div className="mx-auto flex rounded-md border p-0.5" style={{ borderColor: 'var(--border)' }} role="group" aria-label="보기 방식">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => onView(v.id)}
            className="h-7 rounded px-3 text-sm"
            style={
              view === v.id
                ? { background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 }
                : { color: 'var(--text-muted)' }
            }
          >
            {v.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled
        className="h-8 rounded-md border px-3 text-sm opacity-50"
        style={{ borderColor: 'var(--border)' }}
      >
        내보내기
      </button>
    </header>
  );
}

function CanvasArea() {
  return (
    <main
      className="flex flex-1 items-center justify-center"
      style={{
        backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
      aria-label="캔버스"
    >
      <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
        왼쪽에서 파일을 만들면 여기에서 그릴 수 있어요.
      </p>
    </main>
  );
}

export function App() {
  const workspace = useWorkspaceName();
  const [view, setView] = useState<View>('both');
  return (
    <div className="flex h-full">
      <Sidebar workspace={workspace} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar view={view} onView={setView} />
        <CanvasArea />
      </div>
    </div>
  );
}
