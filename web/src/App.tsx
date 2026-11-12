import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Block, type DpxFile, type TreeNode } from './api';
import type { CanvasFocus } from './canvas/ExcalidrawCanvas';
import { Sidebar } from './Sidebar';
import { TopBar, type View } from './TopBar';
import { Splitter } from './Splitter';
import { DocPane } from './DocPane';
import { CanvasPane } from './CanvasPane';
import { useTheme } from './theme';
import { fileStem } from './fileName';

const SAVE_DELAY = 700;
const RETRY_MIN = 1000;
const RETRY_MAX = 30000;
const NARROW = '(max-width: 767px)';

// The open file lives in the URL hash so a reload reopens it. Only the workspace-relative path is kept.
const hashPath = () => {
  const m = /^#file=(.+)$/.exec(window.location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
};
const setHashPath = (p: string | null) => {
  const url = `${window.location.pathname}${window.location.search}${p ? `#file=${encodeURIComponent(p)}` : ''}`;
  window.history.replaceState(null, '', url);
};

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const h = () => setNarrow(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return narrow;
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const narrow = useNarrow();
  const [navOpen, setNavOpen] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [file, setFile] = useState<DpxFile | null>(null);
  const [view, setView] = useState<View>('both');
  const [ratio, setRatio] = useState(0.45);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Set when a save got 409: the server's current revision, so "overwrite" can re-send against it.
  const [conflict, setConflict] = useState<{ revision?: number } | null>(null);
  // Bumped on every load from disk so the canvas restarts from the loaded content.
  const [loadSeq, setLoadSeq] = useState(0);
  // A request from the document to show a diagram block on the canvas; `n` makes each click a new request.
  const [focus, setFocus] = useState<CanvasFocus | null>(null);

  const fileRef = useRef<DpxFile | null>(null);
  const pathRef = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  // dirty: local edits not yet on disk. editSeq tells a finished save whether newer edits arrived meanwhile.
  const dirty = useRef(false);
  const editSeq = useRef(0);
  const inFlight = useRef(false);
  const retryDelay = useRef(0);
  const conflictRef = useRef(false);
  fileRef.current = file;
  pathRef.current = path;

  const refreshTree = useCallback(async () => {
    try {
      setTree(await api.tree());
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했어요');
    }
  }, []);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const saveRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => {});
  const schedule = useCallback((ms: number) => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void saveRef.current();
    }, ms);
  }, []);

  const save = useCallback(
    (keepalive = false) => {
      // Saves run one at a time so each PUT carries the revision returned by the previous one.
      saving.current = saving.current.then(async () => {
        const p = pathRef.current;
        const f = fileRef.current;
        if (!p || !f || !dirty.current || conflictRef.current) return;
        const seq = editSeq.current;
        inFlight.current = true;
        setStatus('저장 중이에요…');
        try {
          const saved = await api.saveFile(p, f, keepalive);
          if (pathRef.current !== p) return;
          setFile((cur) => (cur ? { ...cur, revision: saved.revision } : cur));
          if (fileRef.current) fileRef.current = { ...fileRef.current, revision: saved.revision };
          retryDelay.current = 0;
          if (editSeq.current === seq) {
            dirty.current = false;
            setStatus('저장했어요');
          }
          void refreshTree();
        } catch (e) {
          if (pathRef.current !== p) return;
          if (e instanceof ApiError && e.status === 409) {
            clearTimer();
            conflictRef.current = true;
            setConflict({ revision: e.revision });
            setStatus('다른 곳에서 바뀌었어요');
          } else {
            retryDelay.current = Math.min(RETRY_MAX, Math.max(RETRY_MIN, retryDelay.current * 2));
            setStatus('저장하지 못했어요. 잠시 뒤 다시 시도할게요');
            // A pending edit timer will save sooner; otherwise back off and retry.
            if (timer.current === null) schedule(retryDelay.current);
          }
        } finally {
          inFlight.current = false;
        }
      });
      return saving.current;
    },
    [refreshTree, schedule],
  );
  saveRef.current = save;

  const flush = useCallback(async () => {
    clearTimer();
    await save();
  }, [save]);

  const edit = useCallback(
    (patch: Partial<Pick<DpxFile, 'title' | 'document' | 'blocks' | 'canvas'>>) => {
      setFile((cur) => {
        if (!cur) return cur;
        const next = { ...cur, ...patch };
        fileRef.current = next;
        return next;
      });
      dirty.current = true;
      editSeq.current += 1;
      if (!conflictRef.current) setStatus('');
      schedule(SAVE_DELAY);
    },
    [schedule],
  );

  const load = useCallback((p: string, f: DpxFile) => {
    clearTimer();
    dirty.current = false;
    retryDelay.current = 0;
    conflictRef.current = false;
    setConflict(null);
    setPath(p);
    pathRef.current = p;
    setFile(f);
    fileRef.current = f;
    setLoadSeq((n) => n + 1);
    setFocus(null);
    setStatus('');
    setHashPath(p);
  }, []);

  const open = useCallback(
    async (p: string) => {
      await flush();
      if (dirty.current && !window.confirm('저장하지 못한 변경이 있어요. 그래도 다른 파일을 열까요?')) return;
      setError(null);
      try {
        load(p, await api.readFile(p));
        if (narrow) setNavOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : '파일을 열지 못했어요');
      }
    },
    [flush, load, narrow],
  );

  useEffect(() => {
    api.info().then((i) => setWorkspace(i.workspace || null)).catch(() => {});
    void refreshTree();
    const p = hashPath();
    if (p)
      api
        .readFile(p)
        .then((f) => load(p, f))
        .catch(() => setHashPath(null));
  }, [refreshTree, load]);

  // 409 choices: drop local edits and re-read, or re-send local edits against the server's revision.
  const reload = async () => {
    const p = pathRef.current;
    if (!p) return;
    await saving.current;
    try {
      load(p, await api.readFile(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 불러오지 못했어요');
    }
  };
  const overwrite = async () => {
    await saving.current;
    const f = fileRef.current;
    if (!f || conflict?.revision === undefined) return;
    const next = { ...f, revision: conflict.revision };
    fileRef.current = next;
    setFile(next);
    conflictRef.current = false;
    setConflict(null);
    dirty.current = true;
    clearTimer();
    await save();
  };

  // Warn before leaving with unsaved edits; on pagehide send them with keepalive.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const hide = () => {
      // Skip when a PUT is already running: it holds the same revision, so a second one would only 409.
      if (!dirty.current || inFlight.current || conflictRef.current) return;
      clearTimer();
      void save(true);
    };
    window.addEventListener('beforeunload', before);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('pagehide', hide);
    };
  }, [save]);

  const newFile = async () => {
    const name = window.prompt('새 파일 이름을 입력해 주세요');
    const p = name ? fileStem(name) : '';
    if (!p) return;
    await flush();
    try {
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
        clearTimer();
        dirty.current = false;
        conflictRef.current = false;
        setConflict(null);
        setPath(null);
        setFile(null);
        setHashPath(null);
      }
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : '지우지 못했어요');
    }
  };

  const showDoc = view !== 'canvas';
  const showCanvas = view !== 'doc';
  const showBlock = useCallback((blockId: string) => {
    setView((v) => (v === 'doc' ? 'both' : v));
    setFocus((f) => ({ blockId, n: (f?.n ?? 0) + 1 }));
  }, []);
  const doc = file && path && (
    <DocPane
      key={`${path}#${loadSeq}`}
      document={file.document}
      blocks={file.blocks}
      dark={theme === 'dark'}
      onDocument={(d) => edit({ document: d })}
      onBlocks={(b: Block[]) => edit({ blocks: b })}
      onShow={showBlock}
    />
  );
  const canvas = (
    <CanvasPane
      fileKey={file && path ? `${path}#${loadSeq}` : null}
      canvas={file?.canvas}
      blocks={file?.blocks ?? []}
      focus={focus}
      dark={theme === 'dark'}
      onChange={edit}
    />
  );

  const sidebar = (
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
  );

  return (
    <div className="flex h-full">
      {!narrow
        ? sidebar
        : navOpen && (
            <div className="fixed inset-0 z-20 flex">
              {sidebar}
              <button type="button" aria-label="파일 목록 닫기" className="flex-1" style={{ background: 'rgb(0 0 0 / 0.3)' }} onClick={() => setNavOpen(false)} />
            </div>
          )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={file?.title ?? ''}
          hasFile={!!file}
          status={status}
          view={view}
          onView={setView}
          onTitle={(title) => edit({ title })}
          onToggleNav={narrow ? () => setNavOpen((o) => !o) : undefined}
        />
        {conflict && (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm" style={{ background: 'var(--accent-soft)' }}>
            <span className="mr-auto">이 파일이 다른 곳에서 바뀌었어요. 어떻게 할까요?</span>
            <button type="button" className="h-7 rounded-md border px-3" style={{ borderColor: 'var(--border)' }} onClick={() => void reload()}>
              다시 불러오기
            </button>
            <button
              type="button"
              disabled={conflict.revision === undefined}
              className="h-7 rounded-md px-3 font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
              onClick={() => void overwrite()}
            >
              내 것으로 덮어쓰기
            </button>
          </div>
        )}
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
            <p>{narrow ? '파일 목록에서 파일을 만들거나 골라 주세요.' : '왼쪽에서 파일을 만들거나 골라 주세요.'}</p>
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
