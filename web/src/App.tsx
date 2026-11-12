import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Block, type DpxFile, type TreeNode } from './api';
import type { CanvasFocus } from './canvas/ExcalidrawCanvas';
import { Sidebar } from './Sidebar';
import { isRetryableSaveError } from './saveRetry';
import { TopBar, type View } from './TopBar';
import { Splitter } from './Splitter';
// TipTap and the diagram renderer are big; they load when a file is first opened.
const DocPane = lazy(() => import('./DocPane').then((m) => ({ default: m.DocPane })));
import { CanvasPane } from './CanvasPane';
import { useTheme } from './theme';
import { fileStem } from './fileName';
import { migrateDocument } from './doc/model';
import { ExportMenu } from './ExportMenu';
import { CommandPalette, type Command } from './CommandPalette';
import { exportBlock, exportCanvas, exportMarkdown, type ImageKind } from './export/actions';
import type { CanvasHandle } from './export/types';
import { EXPORT_MENU_QUERY, IS_MAC } from './platform';

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
  const [status, setStatusText] = useState('');
  // True while the status is a problem (failed save or conflict), so the top bar shows it on narrow screens too.
  const [statusAlert, setStatusAlert] = useState(false);
  const setStatus = useCallback((text: string, alert = false) => {
    setStatusText(text);
    setStatusAlert(alert);
  }, []);
  const [error, setError] = useState<string | null>(null);
  // Set when a save got 409: the server's current revision, so "overwrite" can re-send against it.
  const [conflict, setConflict] = useState<{ revision?: number } | null>(null);
  // Bumped on every load from disk so the canvas restarts from the loaded content.
  const [loadSeq, setLoadSeq] = useState(0);
  // A request from the document to show a diagram block on the canvas; `n` makes each click a new request.
  const [focus, setFocus] = useState<CanvasFocus | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelected, setExportSelected] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Set by the canvas while it is mounted (export, palette commands).
  const canvasHandle = useRef<CanvasHandle | null>(null);

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
            setStatus('다른 곳에서 바뀌었어요', true);
          } else if (!isRetryableSaveError(e)) {
            // The server refused this request (4xx); retrying the same body would fail forever.
            // Keep a pending edit timer: a newer edit may already have fixed the body.
            setStatus('저장하지 못했어요. 내용이나 파일 이름을 확인해 주세요', true);
          } else {
            retryDelay.current = Math.min(RETRY_MAX, Math.max(RETRY_MIN, retryDelay.current * 2));
            setStatus('저장하지 못했어요. 잠시 뒤 다시 시도할게요', true);
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
    // A file from before the document editor gets its diagrams listed in the document (once: saves store version 2).
    f = { ...f, document: migrateDocument(f) };
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
  const report = useCallback(
    (job: Promise<string> | string) =>
      Promise.resolve(job).then(
        (m) => setStatus(m),
        (e) => setStatus(e instanceof Error ? e.message : '내보내지 못했어요', true),
      ),
    [setStatus],
  );
  const imageExport = (kind: ImageKind) => void report(exportCanvas(canvasHandle.current, kind, fileRef.current?.title ?? ''));
  const markdownExport = () => {
    const f = fileRef.current;
    if (f) void report(Promise.resolve().then(() => exportMarkdown(f.title, f.document, f.blocks)));
  };
  const openExport = useCallback((o: boolean) => {
    if (o) setExportSelected(canvasHandle.current?.scope().selected ?? false);
    setExportOpen(o);
  }, []);
  const blockExport = useCallback(
    (b: Block, kind: ImageKind) => void report(exportBlock(b, kind, fileRef.current?.title ?? '')),
    [report],
  );

  // Global shortcuts (capture phase, so they win over the canvas and the editor): Ctrl/Cmd+K palette,
  // Ctrl/Cmd+E export, Shift+Alt+C copy as image. Tool keys, zoom, undo/redo, duplicate, delete and
  // select all are the canvas's own keys, active while the canvas has focus.
  const fileOpen = !!file;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // Mac uses only Cmd, everything else only Ctrl, so Mac's Ctrl+E/K stay with text fields.
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const k = e.code;
      // Inside a text field, the document editor or the code editor these keys belong to the editor
      // (Ctrl+E is "code" in the document), so the export shortcuts step aside; the menu and palette still work.
      const editing = e.target instanceof Element && !!e.target.closest('.ProseMirror, input, textarea, select, .cm-editor, [contenteditable="true"], [contenteditable=""]');
      if (mod && !e.shiftKey && !e.altKey && k === 'KeyK') {
        e.preventDefault();
        e.stopPropagation();
        setExportOpen(false);
        setPaletteOpen((o) => !o);
      } else if (mod && !e.shiftKey && !e.altKey && k === 'KeyE' && fileOpen && !editing && window.matchMedia(EXPORT_MENU_QUERY).matches) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        openExport(true);
      } else if (!mod && e.shiftKey && e.altKey && k === 'KeyC' && fileOpen && !editing) {
        e.preventDefault();
        e.stopPropagation();
        void report(exportCanvas(canvasHandle.current, 'copy', fileRef.current?.title ?? ''));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fileOpen, openExport, report]);

  const commands = (): Command[] => {
    const h = canvasHandle.current;
    const key = (k: Parameters<CanvasHandle['key']>[0]) => () => canvasHandle.current?.key(IS_MAC && k.ctrl ? { ...k, ctrl: false, meta: true } : k);
    const needCanvas = !h || !file;
    const M = IS_MAC ? '⌘' : 'Ctrl+';
    const canvasCmd = (id: string, title: string, keys: string | undefined, k: Parameters<CanvasHandle['key']>[0], keywords: string[] = []): Command => ({ id, title, keys, disabled: needCanvas, hint: needCanvas ? '캔버스가 보일 때' : undefined, keywords, run: key(k) });
    return [
      { id: 'export-svg', title: '캔버스를 SVG로 내보내기', disabled: needCanvas, keywords: ['export', 'svg', '내보내기', '이미지'], run: () => imageExport('svg') },
      { id: 'export-png', title: '캔버스를 PNG로 내보내기', disabled: needCanvas, keywords: ['export', 'png', '내보내기', '이미지'], run: () => imageExport('png') },
      { id: 'export-copy', title: '이미지로 복사', keys: 'Shift+Alt+C', disabled: needCanvas, keywords: ['copy', 'image', '복사', '클립보드'], run: () => imageExport('copy') },
      { id: 'export-md', title: '문서를 Markdown으로 내보내기', disabled: !file, keywords: ['export', 'markdown', 'md', '내보내기', '문서'], run: markdownExport },
      { id: 'view-doc', title: '보기: 문서', run: () => setView('doc'), keywords: ['view', '보기'] },
      { id: 'view-both', title: '보기: 둘 다', run: () => setView('both'), keywords: ['view', '보기'] },
      { id: 'view-canvas', title: '보기: 캔버스', run: () => setView('canvas'), keywords: ['view', '보기'] },
      { id: 'theme', title: theme === 'dark' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기', run: toggleTheme, keywords: ['theme', 'dark', 'light', '테마', '다크'] },
      canvasCmd('tool-select', '도구: 선택', 'V', { key: 'v' }, ['tool', 'select', '도구']),
      canvasCmd('tool-rect', '도구: 사각형', 'R', { key: 'r' }, ['tool', 'rectangle', '도구']),
      canvasCmd('tool-diamond', '도구: 마름모', 'D', { key: 'd' }, ['tool', 'diamond', '도구']),
      canvasCmd('tool-ellipse', '도구: 원', 'O', { key: 'o' }, ['tool', 'ellipse', 'circle', '도구']),
      canvasCmd('tool-arrow', '도구: 화살표', 'A', { key: 'a' }, ['tool', 'arrow', '도구']),
      canvasCmd('tool-line', '도구: 선', 'L', { key: 'l' }, ['tool', 'line', '도구']),
      canvasCmd('tool-draw', '도구: 그리기', 'P', { key: 'p' }, ['tool', 'draw', 'pencil', '도구']),
      canvasCmd('tool-text', '도구: 글자', 'T', { key: 't' }, ['tool', 'text', '도구']),
      canvasCmd('tool-eraser', '도구: 지우개', 'E', { key: 'e' }, ['tool', 'eraser', '도구']),
      canvasCmd('tool-hand', '도구: 손(화면 이동)', 'H', { key: 'h' }, ['tool', 'hand', 'pan', '도구']),
      canvasCmd('zoom-in', '확대', `${M}+`, { key: '=', code: 'Equal', ctrl: true }, ['zoom', '줌']),
      canvasCmd('zoom-out', '축소', `${M}-`, { key: '-', code: 'Minus', ctrl: true }, ['zoom', '줌']),
      canvasCmd('zoom-reset', '화면 크기 100%', `${M}0`, { key: '0', code: 'Digit0', ctrl: true }, ['zoom', '줌']),
      canvasCmd('zoom-fit', '모두 보이게 맞추기', 'Shift+1', { key: '!', code: 'Digit1', shift: true }, ['zoom', 'fit', '줌']),
      canvasCmd('undo', '실행 취소', `${M}Z`, { key: 'z', ctrl: true }, ['undo', '되돌리기']),
      canvasCmd('redo', '다시 실행', `${M}Shift+Z`, { key: 'z', ctrl: true, shift: true }, ['redo']),
      canvasCmd('duplicate', '복제', `${M}D`, { key: 'd', ctrl: true }, ['duplicate', 'copy']),
      canvasCmd('delete', '삭제', 'Delete', { key: 'Delete' }, ['delete', 'remove']),
      canvasCmd('select-all', '전체 선택', `${M}A`, { key: 'a', ctrl: true }, ['select', 'all']),
    ];
  };

  const doc = file && path && (
    <Suspense
      fallback={
        <p className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          문서를 불러오는 중이에요…
        </p>
      }
    >
      <DocPane
        key={`${path}#${loadSeq}`}
        document={file.document}
        blocks={file.blocks}
        canvas={file.canvas}
        dark={theme === 'dark'}
        onDocument={(d) => edit({ document: d })}
        onBlocks={(b: Block[]) => edit({ blocks: b })}
        onShow={showBlock}
        onExportBlock={blockExport}
      />
    </Suspense>
  );
  const canvas = (
    <CanvasPane
      fileKey={file && path ? `${path}#${loadSeq}` : null}
      canvas={file?.canvas}
      blocks={file?.blocks ?? []}
      focus={focus}
      dark={theme === 'dark'}
      onChange={edit}
      handle={canvasHandle}
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
          statusAlert={statusAlert}
          view={view}
          onView={setView}
          onTitle={(title) => edit({ title })}
          onToggleNav={narrow ? () => setNavOpen((o) => !o) : undefined}
          exportMenu={
            <ExportMenu
              open={exportOpen}
              onOpen={openExport}
              disabled={!file}
              canvasReady={showCanvas}
              selected={exportSelected}
              onImage={imageExport}
              onMarkdown={markdownExport}
            />
          }
        />
        {paletteOpen && <CommandPalette commands={commands()} onClose={() => setPaletteOpen(false)} />}
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
