import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Block, type DpxFile, type TreeNode } from './api';
import { Sidebar } from './Sidebar';
import { TopBar, type View } from './TopBar';
import { Splitter } from './Splitter';
import { DocPane } from './DocPane';
import { CanvasPane } from './CanvasPane';
import { useTheme } from './theme';

const SAVE_DELAY = 700;

type Status = '' | '저장 중이에요…' | '저장했어요' | '저장하지 못했어요. 다시 시도해 볼게요' | '다른 곳에서 바뀌었어요. 다시 불러와 주세요';

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [file, setFile] = useState<DpxFile | null>(null);
  const [view, setView] = useState<View>('both');
  const [ratio, setRatio] = useState(0.45);
  const [status, setStatus] = useState<Status>('');
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<DpxFile | null>(null);
  const pathRef = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  fileRef.current = file;
  pathRef.current = path;

  const refreshTree = useCallback(async () => {
    try {
      setTree(await api.tree());
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했어요');
    }
  }, []);

  useEffect(() => {
    api.info().then((i) => setWorkspace(i.workspace || null)).catch(() => {});
    void refreshTree();
  }, [refreshTree]);

  const save = useCallback(() => {
    // Saves run one at a time so each PUT carries the revision returned by the previous one.
    saving.current = saving.current.then(async () => {
      const p = pathRef.current;
      const f = fileRef.current;
      if (!p || !f) return;
      setStatus('저장 중이에요…');
      try {
        const saved = await api.saveFile(p, f);
        if (pathRef.current === p) {
          setFile((cur) => (cur ? { ...cur, revision: saved.revision } : cur));
          if (fileRef.current) fileRef.current = { ...fileRef.current, revision: saved.revision };
          setStatus('저장했어요');
        }
        void refreshTree();
      } catch (e) {
        setStatus(e instanceof ApiError && e.status === 409 ? '다른 곳에서 바뀌었어요. 다시 불러와 주세요' : '저장하지 못했어요. 다시 시도해 볼게요');
      }
    });
    return saving.current;
  }, [refreshTree]);

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
      await save();
    } else {
      await saving.current;
    }
  }, [save]);

  const edit = useCallback(
    (patch: Partial<Pick<DpxFile, 'title' | 'blocks'>>) => {
      setFile((cur) => {
        if (!cur) return cur;
        const next = { ...cur, ...patch };
        fileRef.current = next;
        return next;
      });
      setStatus('');
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void save();
      }, SAVE_DELAY);
    },
    [save],
  );

  const open = useCallback(
    async (p: string) => {
      await flush();
      setError(null);
      try {
        const f = await api.readFile(p);
        setPath(p);
        pathRef.current = p;
        setFile(f);
        fileRef.current = f;
        setStatus('');
      } catch (e) {
        setError(e instanceof Error ? e.message : '파일을 열지 못했어요');
      }
    },
    [flush],
  );

  // Save the pending edit when the tab closes or hides.
  useEffect(() => {
    const h = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
        const p = pathRef.current;
        const f = fileRef.current;
        if (p && f)
          void fetch(`/api/file?path=${encodeURIComponent(p)}`, {
            method: 'PUT',
            keepalive: true,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(f),
          });
      }
    };
    window.addEventListener('pagehide', h);
    return () => window.removeEventListener('pagehide', h);
  }, []);

  const newFile = async () => {
    const name = window.prompt('새 파일 이름을 입력해 주세요');
    if (!name?.trim()) return;
    await flush();
    try {
      const p = name.trim();
      await api.createFile(p, p.split('/').pop() ?? p);
      await refreshTree();
      await open(p);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? '같은 이름의 파일이 이미 있어요' : e instanceof Error ? e.message : '만들지 못했어요');
    }
  };
  const newFolder = async () => {
    const name = window.prompt('새 폴더 이름을 입력해 주세요');
    if (!name?.trim()) return;
    try {
      await api.createFolder(name.trim());
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : '만들지 못했어요');
    }
  };
  const remove = async (n: TreeNode) => {
    const label = n.type === 'file' ? n.title || n.name : n.name;
    if (!window.confirm(`"${label}"을(를) 지울까요?`)) return;
    try {
      if (n.type === 'file') await api.removeFile(n.path);
      else await api.removeFolder(n.path);
      if (path && (path === n.path || path.startsWith(`${n.path}/`))) {
        setPath(null);
        setFile(null);
      }
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : '지우지 못했어요');
    }
  };

  const showDoc = view !== 'canvas';
  const showCanvas = view !== 'doc';
  const doc = file && <DocPane blocks={file.blocks} dark={theme === 'dark'} onBlocks={(b: Block[]) => edit({ blocks: b })} />;
  const canvas = <CanvasPane blocks={file?.blocks ?? []} hasFile={!!file} />;

  return (
    <div className="flex h-full">
      <Sidebar
        workspace={workspace}
        tree={tree}
        current={path}
        onOpen={(p) => void open(p)}
        onNewFile={() => void newFile()}
        onNewFolder={() => void newFolder()}
        onDelete={(n) => void remove(n)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={file?.title ?? ''} hasFile={!!file} status={status} view={view} onView={setView} onTitle={(title) => edit({ title })} />
        {error && (
          <div role="alert" className="flex items-center gap-2 px-4 py-2 text-sm" style={{ background: 'var(--accent-soft)' }}>
            <span>{error}</span>
            <button type="button" className="ml-auto underline" onClick={() => setError(null)}>
              닫기
            </button>
          </div>
        )}
        {!file ? (
          <main className="flex flex-1 items-center justify-center" style={{ color: 'var(--text-muted)' }}>
            <p>왼쪽에서 파일을 만들거나 골라 주세요.</p>
          </main>
        ) : view === 'both' ? (
          <Splitter ratio={ratio} onRatio={setRatio} left={doc} right={canvas} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {showDoc && doc}
            {showCanvas && canvas}
          </div>
        )}
      </div>
    </div>
  );
}
