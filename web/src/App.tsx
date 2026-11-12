import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Block, type DpxFile, type TreeNode } from './api';
import type { CanvasData, CanvasFocus } from './canvas/ExcalidrawCanvas';
import { sameDrawing } from './canvas/sync';
import { Sidebar } from './Sidebar';
import { createFileSession, type FilePatch, type FileSession } from './fileSession';
import { useSession } from './useSession';
import { type WorkspaceEvent } from './externalChange';
import { TopBar, type View } from './TopBar';
import { Splitter } from './Splitter';
// TipTap and the diagram renderer are big; they load when a file is first opened.
const DocPane = lazy(() => import('./DocPane').then((m) => ({ default: m.DocPane })));
import { CanvasPane } from './CanvasPane';
import { LazyBoundary } from './LazyBoundary';
import { CHUNK_MESSAGE, isChunkLoadError } from './chunkError';
import { useTheme } from './theme';
import { fileStem } from './fileName';
import { parseHash } from './doc/outline';
import { ExportMenu } from './ExportMenu';
import { DEFAULT_EXPORT, type ExportOptions } from './export/options';
import { CommandPalette, type Command } from './CommandPalette';
import { exportBlock, exportCanvas, exportMarkdown, type ImageKind } from './export/actions';
import { blockExportTitle } from './export/markdown';
import type { CanvasHandle } from './export/types';
import { EXPORT_MENU_QUERY, IS_MAC } from './platform';

const NARROW = '(max-width: 767px)';

// The open file lives in the URL hash so a reload reopens it. Only the workspace-relative path is kept.
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

const NO_BLOCKS: Block[] = [];

// The panes read the file from the session themselves, so a canvas drag or a keystroke in the document
// re-renders only the pane that changed, not the whole app.
type DocSlotProps = {
  session: FileSession;
  dark: boolean;
  tree: TreeNode[];
  jump: { id: string; n: number } | null;
  onOpenFile: (path: string) => void;
  onNotice: (message: string) => void;
  onShow: (blockId: string) => void;
  onExportBlock: (b: Block, kind: ImageKind) => void;
  onFail: () => Promise<boolean>;
};
const DocSlot = memo(function DocSlot({ session, dark, tree, jump, onOpenFile, onNotice, onShow, onExportBlock, onFail }: DocSlotProps) {
  const path = useSession(session, (s) => s.path ?? '');
  const key = useSession(session, (s) => `${s.path}#${s.loadSeq}`);
  // Blocks as drawn: a new array only when a block's id, type or code changes, not when it moves.
  const blocks = useSession(session, (s) => s.file?.blocks ?? NO_BLOCKS, sameDrawing);
  const getBlocks = useCallback(() => session.getState().file?.blocks ?? NO_BLOCKS, [session]);
  const getCanvas = useCallback(() => session.getState().file?.canvas, [session]);
  const onDocument = useCallback((d: unknown) => session.edit({ document: d }), [session]);
  const onBlocks = useCallback((b: Block[]) => session.edit({ blocks: b }), [session]);
  return (
    <LazyBoundary key={key} onFail={onFail}>
      <Suspense
        fallback={
          <p className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
            문서를 불러오는 중이에요…
          </p>
        }
      >
        <DocPane
          key={key}
          // Read once when the pane starts (it is remounted per load).
          document={session.getState().file?.document}
          blocks={blocks}
          getBlocks={getBlocks}
          getCanvas={getCanvas}
          dark={dark}
          path={path}
          tree={tree}
          onOpenFile={onOpenFile}
          jump={jump}
          onNotice={onNotice}
          onDocument={onDocument}
          onBlocks={onBlocks}
          onShow={onShow}
          onExportBlock={onExportBlock}
        />
      </Suspense>
    </LazyBoundary>
  );
});

type CanvasSlotProps = {
  session: FileSession;
  focus: CanvasFocus | null;
  dark: boolean;
  handle: { current: CanvasHandle | null };
  onFail: () => Promise<boolean>;
};
const CanvasSlot = memo(function CanvasSlot({ session, focus, dark, handle, onFail }: CanvasSlotProps) {
  const fileKey = useSession(session, (s) => (s.file && s.path ? `${s.path}#${s.loadSeq}` : null));
  const canvas = useSession(session, (s) => s.file?.canvas);
  const blocks = useSession(session, (s) => s.file?.blocks ?? NO_BLOCKS);
  const onChange = useCallback((patch: { canvas?: CanvasData; blocks?: Block[] }) => session.edit(patch), [session]);
  return <CanvasPane fileKey={fileKey} canvas={canvas} blocks={blocks} focus={focus} dark={dark} onChange={onChange} handle={handle} onFail={onFail} />;
});

export function App() {
  const [theme, toggleTheme] = useTheme();
  const narrow = useNarrow();
  const [navOpen, setNavOpen] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [view, setView] = useState<View>('both');
  const [ratio, setRatio] = useState(0.45);
  const [error, setError] = useState<string | null>(null);
  // A request from the document to show a diagram block on the canvas; `n` makes each click a new request.
  const [focus, setFocus] = useState<CanvasFocus | null>(null);
  // A heading link was opened: the document pane scrolls to it.
  const [jump, setJump] = useState<{ id: string; n: number } | null>(null);
  const jumpTo = useCallback((id: string | null) => setJump(id ? { id, n: Date.now() } : null), []);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT);
  const exportOptionsRef = useRef(exportOptions);
  exportOptionsRef.current = exportOptions;
  const [exportSelected, setExportSelected] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Set by the canvas while it is mounted (export, palette commands).
  const canvasHandle = useRef<CanvasHandle | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      setTree(await api.tree());
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했어요');
    }
  }, []);

  // The open file and its saving (debounce, retry, conflict) live outside React; App reads only the
  // slices it shows, never blocks, canvas or document.
  const [session] = useState(() => createFileSession({ saveFile: (p, f, keepalive) => api.saveFile(p, f, keepalive), onSaved: () => void refreshTree() }));
  const path = useSession(session, (s) => s.path);
  const hasFile = useSession(session, (s) => !!s.file);
  const title = useSession(session, (s) => s.file?.title ?? '');
  const status = useSession(session, (s) => s.status);
  const statusAlert = useSession(session, (s) => s.statusAlert);
  const conflict = useSession(session, (s) => s.conflict);
  const setStatus = session.setStatus;
  const edit = useCallback((patch: FilePatch) => session.edit(patch), [session]);
  const flushForReload = useCallback(() => session.flushForReload(), [session]);

  const load = useCallback(
    (p: string, f: DpxFile) => {
      session.load(p, f);
      setFocus(null);
      setJump(null);
      setHashPath(p);
    },
    [session],
  );

  /** Opens `p`; false when the user cancelled or the file could not be read (the current file stays open). */
  const open = useCallback(
    async (p: string): Promise<boolean> => {
      await session.flush();
      if (session.isDirty() && !window.confirm('저장하지 못한 변경이 있어요. 그래도 다른 파일을 열까요?')) return false;
      setError(null);
      try {
        load(p, await api.readFile(p));
        if (narrow) setNavOpen(false);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '파일을 열지 못했어요');
        return false;
      }
    },
    [session, load, narrow],
  );
  const openFile = useCallback((p: string) => void open(p), [open]);

  useEffect(() => {
    api.info().then((i) => setWorkspace(i.workspace || null)).catch(() => {});
    void refreshTree();
    const link = parseHash(window.location.hash);
    if (link)
      api
        .readFile(link.path)
        .then((f) => {
          load(link.path, f);
          jumpTo(link.heading);
        })
        .catch(() => setHashPath(null));
  }, [refreshTree, load, jumpTo]);

  // A heading link pasted into the address bar of this tab (only the hash changes, so the page does not reload).
  useEffect(() => {
    const onHash = () => {
      const link = parseHash(window.location.hash);
      if (!link) return;
      // Drop `&h=` (same file) or restore the open file's hash (cancelled or failed open), so the
      // address bar always names the open file and following the same link again fires `hashchange`.
      const current = session.getState().path;
      if (link.path === current) {
        setHashPath(current);
        return jumpTo(link.heading);
      }
      void open(link.path).then((ok) => {
        if (ok) jumpTo(link.heading);
        else setHashPath(session.getState().path);
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [session, open, jumpTo]);

  // 409 choices: drop local edits and re-read, or re-send local edits against the server's revision.
  const reload = async () => {
    const p = session.getState().path;
    if (!p) return;
    await session.idle();
    try {
      load(p, await api.readFile(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 불러오지 못했어요');
    }
  };
  const overwrite = () => void session.overwrite();

  // Warn before leaving with unsaved edits; on pagehide send them with keepalive.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (session.hasUnsaved()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const hide = () => session.saveOnHide();
    window.addEventListener('beforeunload', before);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('pagehide', hide);
    };
  }, [session]);

  const newFile = async () => {
    const name = window.prompt('새 파일 이름을 입력해 주세요');
    const p = name ? fileStem(name) : '';
    if (!p) return;
    await session.flush();
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
  // Path this tab is deleting right now (see the SSE handler below).
  const removing = useRef<string | null>(null);
  // The open file is gone (deleted or moved away): drop it and its pending save.
  const closeOpenFile = useCallback(() => {
    session.close();
    setHashPath(null);
  }, [session]);

  // Other tabs and outside edits: keep the file list current, reload the open file when it changed and holds no unsaved edits.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.addEventListener('workspace', (m) => {
      let e: WorkspaceEvent;
      try {
        e = JSON.parse((m as MessageEvent<string>).data) as WorkspaceEvent;
      } catch {
        return;
      }
      if (session.external(e, (p) => api.readFile(p), load) === 'close') {
        setHashPath(null);
        // Our own delete can be announced before its response arrives: that close needs no error.
        if (!removing.current) setError('열어 둔 파일이 지워졌거나 옮겨졌어요');
      }
      void refreshTree();
    });
    return () => es.close();
  }, [session, load, refreshTree]);

  const remove = async (n: TreeNode) => {
    const label = n.type === 'file' ? n.title || n.name : n.name;
    if (!window.confirm(`"${label}"을(를) 지울까요?`)) return;
    removing.current = n.path;
    try {
      if (n.type === 'file') await api.removeFile(n.path);
      else await api.removeFolder(n.path);
      if (path && (path === n.path || path.startsWith(`${n.path}/`))) closeOpenFile();
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : '지우지 못했어요');
    } finally {
      removing.current = null;
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
        (e) => setStatus(isChunkLoadError(e) ? CHUNK_MESSAGE : e instanceof Error ? e.message : '내보내지 못했어요', true),
      ),
    [setStatus],
  );
  const imageExport = (kind: ImageKind) => void report(exportCanvas(canvasHandle.current, kind, session.getState().file?.title ?? '', exportOptions));
  const markdownExport = () => {
    const f = session.getState().file;
    if (f) void report(Promise.resolve().then(() => exportMarkdown(f.title, f.document, f.blocks)));
  };
  const openExport = useCallback((o: boolean) => {
    if (o) setExportSelected(canvasHandle.current?.scope().selected ?? false);
    setExportOpen(o);
  }, []);
  const blockExport = useCallback(
    (b: Block, kind: ImageKind) => {
      const f = session.getState().file;
      void report(exportBlock(b, kind, blockExportTitle(f?.title ?? '', b, f?.blocks ?? []), exportOptionsRef.current));
    },
    [report, session],
  );

  // Global shortcuts (capture phase, so they win over the canvas and the editor): Ctrl/Cmd+K palette,
  // Ctrl/Cmd+E export, Shift+Alt+C copy as image. Tool keys, zoom, undo/redo, duplicate, delete and
  // select all are the canvas's own keys, active while the canvas has focus.
  const fileOpen = hasFile;
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
        void report(exportCanvas(canvasHandle.current, 'copy', session.getState().file?.title ?? '', exportOptionsRef.current));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fileOpen, openExport, report, session]);

  const commands = (): Command[] => {
    const h = canvasHandle.current;
    const key = (k: Parameters<CanvasHandle['key']>[0]) => () => canvasHandle.current?.key(IS_MAC && k.ctrl ? { ...k, ctrl: false, meta: true } : k);
    const needCanvas = !h || !hasFile;
    const M = IS_MAC ? '⌘' : 'Ctrl+';
    const canvasCmd = (id: string, title: string, keys: string | undefined, k: Parameters<CanvasHandle['key']>[0], keywords: string[] = []): Command => ({ id, title, keys, disabled: needCanvas, hint: needCanvas ? '캔버스가 보일 때' : undefined, keywords, run: key(k) });
    return [
      { id: 'export-svg', title: '캔버스를 SVG로 내보내기', disabled: needCanvas, keywords: ['export', 'svg', '내보내기', '이미지'], run: () => imageExport('svg') },
      { id: 'export-png', title: '캔버스를 PNG로 내보내기', disabled: needCanvas, keywords: ['export', 'png', '내보내기', '이미지'], run: () => imageExport('png') },
      { id: 'export-copy', title: '이미지로 복사', keys: 'Shift+Alt+C', disabled: needCanvas, keywords: ['copy', 'image', '복사', '클립보드'], run: () => imageExport('copy') },
      { id: 'export-md', title: '문서를 Markdown으로 내보내기', disabled: !hasFile, keywords: ['export', 'markdown', 'md', '내보내기', '문서'], run: markdownExport },
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

  const dark = theme === 'dark';
  const doc = hasFile && path && (
    <DocSlot session={session} dark={dark} tree={tree} jump={jump} onOpenFile={openFile} onNotice={setStatus} onShow={showBlock} onExportBlock={blockExport} onFail={flushForReload} />
  );
  const canvas = <CanvasSlot session={session} focus={focus} dark={dark} handle={canvasHandle} onFail={flushForReload} />;

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
          title={title}
          hasFile={hasFile}
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
              disabled={!hasFile}
              canvasReady={showCanvas}
              selected={exportSelected}
              options={exportOptions}
              onOptions={setExportOptions}
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
              onClick={overwrite}
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
        {!hasFile ? (
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
