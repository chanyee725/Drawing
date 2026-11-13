import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Block, type DocNode, type DpxFile, type Project, type ProjectsView, type TreeNode } from './api';
import type { CanvasData, CanvasFocus } from './canvas/ExcalidrawCanvas';
import { sameDrawing } from './canvas/sync';
import { blocksInFrame, frameScene as sceneOf, frameSceneSig, type CanvasEl } from './doc/model';
import { Sidebar } from './Sidebar';
import { ShellHome } from './ShellHome';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { asTreeNode, docPlace, newFileDir, shellKey, subFolderOf, type Crumb, type Section } from './projectNav';
import { SubDocs } from './SubDocs';
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
import { moveErrorText, nameProblem, pathAfterMove, renameInitial, renameTarget } from './movePaths';
import { parseHash } from './doc/outline';
import { ExportMenu } from './ExportMenu';
import { DEFAULT_EXPORT, type ExportOptions } from './export/options';
import { HistoryDialog } from './HistoryDialog';
import { TrashDialog } from './TrashDialog';
import { CommandPalette } from './CommandPalette';
import { CommandRegistry, CommandRegistryContext, useCommandSource, type Command } from './commands';
import { displayName } from './Sidebar';
import {
  ArrowUpRight, Circle, Clock, Columns2, Copy, CopyPlus, Delete, Diamond, Eraser, File, FilePlus, FileText, FolderPlus, Hand, ImageDown,
  Maximize, Minus, Moon, MousePointer2, Move, PanelLeft, PanelRight, Pencil, Redo2, RotateCcw, Scan, Shapes, Square,
  SquareDashedMousePointer, Sun, Trash, Type, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { exportBlock, exportCanvas, exportDocumentPdf, exportMarkdown, type ImageKind } from './export/actions';
import { blockExportTitle } from './export/markdown';
import type { CanvasHandle } from './export/types';
import { EXPORT_MENU_QUERY, IS_MAC } from './platform';

const NARROW = '(max-width: 767px)';

// The open file lives in the URL hash so a reload reopens it. Only the workspace-relative path is kept.
const setHashPath = (p: string | null) => {
  const url = `${window.location.pathname}${window.location.search}${p ? `#file=${encodeURIComponent(p)}` : ''}`;
  window.history.replaceState({ drawing: 1 }, '', url);
};
// A link followed in this tab was cancelled or failed: the browser already added a history entry for it.
// Step back over that entry (state is null on entries the browser made) so history has no duplicate of the open file.
const undoLinkEntry = (current: string | null) => {
  if (window.history.state === null) window.history.back();
  else setHashPath(current);
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
// Showing something on the canvas: next to the document, or instead of it on a narrow screen.
const toCanvas = (v: View, narrow: boolean): View => (narrow ? 'canvas' : v === 'doc' ? 'both' : v);

type TreeFile = Extract<TreeNode, { type: 'file' }>;
/** Every file in the tree, depth first (folders in tree order). */
const filesOf = (nodes: TreeNode[]): TreeFile[] => nodes.flatMap((n) => (n.type === 'folder' ? filesOf(n.children) : [n]));

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
  onShowFrame: (frameId: string) => void;
  onExportBlock: (b: Block, kind: ImageKind) => void;
  onFail: () => Promise<boolean>;
};
const elementsOf = (canvas: unknown): CanvasEl[] => {
  const els = (canvas as { elements?: unknown } | null | undefined)?.elements;
  return Array.isArray(els) ? (els as CanvasEl[]) : [];
};
const inFrames = (blocks: Block[], els: CanvasEl[]): Block[] => {
  const frames = els.filter((e) => !e.isDeleted && (e.type === 'frame' || e.type === 'magicframe'));
  if (!frames.length) return NO_BLOCKS;
  return blocks.filter((b) => frames.some((f) => blocksInFrame({ x: f.x ?? 0, y: f.y ?? 0, width: f.width ?? 0, height: f.height ?? 0 }, [b]).length));
};
const sameFrameBlocks = (a: Block[], b: Block[]) => sameDrawing(a, b) && a.every((x, i) => x.x === b[i].x && x.y === b[i].y && x.w === b[i].w && x.h === b[i].h);
/** `value` once it has stopped changing for `ms`; a new `reset` key (another file) takes the live value at once. */
function useSettled<T>(value: T, ms: number, reset: string): T {
  const [v, setV] = useState({ value, reset });
  useEffect(() => {
    const t = setTimeout(() => setV({ value, reset }), ms);
    return () => clearTimeout(t);
  }, [value, ms, reset]);
  return v.reset === reset ? v.value : value;
}
const DocSlot = memo(function DocSlot({ session, dark, tree, jump, onOpenFile, onNotice, onShow, onShowFrame, onExportBlock, onFail }: DocSlotProps) {
  const path = useSession(session, (s) => s.path ?? '');
  const key = useSession(session, (s) => `${s.path}#${s.loadSeq}`);
  // Blocks as drawn: a new array only when a block's id, type or code changes, not when it moves.
  const blocks = useSession(session, (s) => s.file?.blocks ?? NO_BLOCKS, sameDrawing);
  // Frames and their contents: a new array only when one of those changes (not when a block or other drawing does).
  const liveFrameScene = useSession(session, (s) => sceneOf(elementsOf(s.file?.canvas)), (a, b) => frameSceneSig(a) === frameSceneSig(b));
  // Blocks inside a frame, with where they sit: the frame preview draws them (they are not canvas elements).
  const liveFrameBlocks = useSession(session, (s) => inFrames(s.file?.blocks ?? NO_BLOCKS, elementsOf(s.file?.canvas)), sameFrameBlocks);
  // A block dragged inside a frame changes this many times a second; the preview (and the pane's context) follows once it settles.
  // Frames and their blocks settle together, so a moved frame and its blocks never draw out of step.
  const framePair = useMemo(() => ({ scene: liveFrameScene, blocks: liveFrameBlocks }), [liveFrameScene, liveFrameBlocks]);
  const { scene: frameScene, blocks: frameBlocks } = useSettled(framePair, 250, key);
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
          frameScene={frameScene}
          frameBlocks={frameBlocks}
          onShowFrame={onShowFrame}
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
  const [projects, setProjects] = useState<ProjectsView | null>(null);
  // What the main panel shows; opening a file switches to the document screen.
  const [section, setSection] = useState<Section>({ kind: 'all' });
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // Set by the canvas while it is mounted (export, palette commands).
  const canvasHandle = useRef<CanvasHandle | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([api.tree(), api.projects()]);
      setTree(t);
      setProjects(p);
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
        setSection({ kind: 'doc' });
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
          setSection({ kind: 'doc' });
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
        else undoLinkEntry(session.getState().path);
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

  // Restore = a normal save of the old version's content. The current state is kept as a version first.
  const restoreVersion = async (id: string): Promise<string | null> => {
    const p = session.getState().path;
    if (!p) return '열린 파일이 없어요';
    await session.flush();
    if (session.isDirty() || session.getState().conflict) return '저장되지 않은 변경이 있어 되돌리지 못했어요';
    try {
      const old = await api.historyVersion(p, id);
      await api.historySnapshot(p);
      const cur = await api.readFile(p);
      await api.saveFile(p, { revision: cur.revision, title: old.title, document: old.document, canvas: old.canvas, blocks: old.blocks });
      load(p, await api.readFile(p));
      void refreshTree();
      setStatus('이전 버전으로 되돌렸어요');
      return null;
    } catch (e) {
      return e instanceof ApiError && e.status === 409 ? '다른 곳에서 바뀌었어요. 다시 시도해 주세요' : '되돌리지 못했어요. 잠시 뒤 다시 시도해 주세요';
    }
  };

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

  // New files go in the project shown (or the open file's project); a typed `a/b` path still works.
  // A sub-document goes in the folder named after the open document (design doc 6 §1).
  const newFile = async (sub = false) => {
    const dir = sub && path ? subFolderOf(path) : newFileDir(section, projects, path);
    const name = window.prompt(sub ? '하위 문서 이름을 입력해 주세요' : dir ? `새 파일 이름을 입력해 주세요 (${dir} 안에 만들어요)` : '새 파일 이름을 입력해 주세요');
    const stem = name ? fileStem(name) : '';
    if (!stem) return;
    const p = dir ? `${dir}/${stem}` : stem;
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
  // A project is a top-level folder (design doc 6 §1).
  const newProject = async () => {
    const name = window.prompt('새 프로젝트 이름을 입력해 주세요')?.trim();
    if (!name) return;
    const problem = nameProblem({ type: 'folder' }, name) ?? (name.includes('/') ? '이름에 / 나 \\를 넣을 수 없어요.' : null);
    if (problem) return setError(problem);
    try {
      await api.createFolder(name);
      await refreshTree();
      setSection({ kind: 'project', path: name });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? '같은 이름의 프로젝트가 이미 있어요' : e instanceof Error ? e.message : '만들지 못했어요');
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
      // This tab's own move already renames the open file; the echo must not close it.
      if (e.kind === 'tree' && e.from !== undefined && ownMoves.current.delete(e.from)) {
        void refreshTree();
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

  // Moves started here, by their `from` path: the server's SSE echo of them is not an outside move.
  const ownMoves = useRef(new Set<string>());
  // `title`: a renamed file takes the new name as its title too, because the sidebar shows the title.
  const move = async (n: TreeNode, to: string, title?: string): Promise<boolean> => {
    const from = n.path;
    ownMoves.current.add(from);
    setTimeout(() => ownMoves.current.delete(from), 5000);
    let readFailed = false;
    let release = () => {};
    try {
      await session.flush();
      // An edit made while the (possibly slow) move runs must not be saved to the old path. Only the open
      // file (or the folder holding it) needs this: holding for an unrelated move would also skip the save on tab close.
      const open = session.getState().path;
      if (open && (open === from || (n.type === 'folder' && open.startsWith(`${from}/`)))) release = session.hold();
      const r = await api.move(from, to, n.type);
      const next = pathAfterMove(session.getState().path, from, (r as { path?: string }).path ?? to, n.type);
      if (next) {
        // The revision is re-read: a name that was deleted before makes the server raise it.
        const fresh = await api.readFile(next).catch(() => null);
        if (!fresh) readFailed = true;
        session.rename(next, fresh?.revision);
        setHashPath(next);
      }
      if (title) {
        const dest = (r as { path?: string }).path ?? to;
        if (next) session.edit({ title });
        else {
          const f = await api.readFile(dest);
          await api.saveFile(dest, { ...f, title });
        }
      }
      await refreshTree();
      // The move worked but the new revision is unknown: the next save may ask to choose a version, so say why.
      if (readFailed) setError('옮겼어요. 다만 파일을 다시 읽지 못했어요. 저장이 안 되면 화면을 새로 고쳐 주세요');
      return true;
    } catch (e) {
      ownMoves.current.delete(from);
      setError(moveErrorText(e instanceof ApiError ? e.status : undefined, e instanceof Error ? e.message : ''));
      return false;
    } finally {
      release();
    }
  };
  // Rename from the sidebar. A document's sub-documents folder (`X/` next to `X.dpx.json`) takes the new name too.
  const renameEntry = async (entry: DocNode | Project) => {
    const n = asTreeNode(entry);
    const initial = renameInitial(n);
    const name = window.prompt('새 이름을 입력해 주세요', initial);
    if (name == null || name.trim() === initial) return;
    const problem = nameProblem(n, name);
    if (problem) return setError(problem);
    const to = renameTarget(n, name);
    if (!to) return;
    const ok = await move(n, to, n.type === 'file' ? fileStem(name) : undefined);
    if (ok && n.type === 'file' && 'children' in entry && entry.children.length) {
      const sub = subFolderOf(n.path);
      await move({ type: 'folder', name: sub.split('/').pop() ?? sub, path: sub, children: [] }, subFolderOf(to));
    }
    if (ok && section.kind === 'project' && section.path === n.path) setSection({ kind: 'project', path: to });
  };

  const remove = async (entry: DocNode | Project) => {
    const n = asTreeNode(entry);
    const label = n.type === 'file' ? n.title || n.name : n.name;
    const keep = n.type === 'file' ? "30일 동안은 '최근에 지운 파일'에서 되살릴 수 있어요." : "안에 있던 파일은 30일 동안 '최근에 지운 파일'에서 하나씩 되살릴 수 있어요. 빈 폴더는 돌아오지 않아요.";
    if (!window.confirm(`"${label}"을(를) 지울까요? ${keep}`)) return;
    removing.current = n.path;
    try {
      if (n.type === 'file') await api.removeFile(n.path);
      else await api.removeFolder(n.path);
      if (path && (path === n.path || path.startsWith(`${n.path}/`))) closeOpenFile();
      if (section.kind === 'project' && section.path === n.path) setSection({ kind: 'all' });
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : '지우지 못했어요');
    } finally {
      removing.current = null;
    }
  };

  // Narrow screens show one pane at a time (design doc 6 §6): 'both' shows the document there.
  const shown: View = narrow && view === 'both' ? 'doc' : view;
  const showDoc = shown !== 'canvas';
  const showCanvas = shown !== 'doc';
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const showBlock = useCallback((blockId: string) => {
    setView((v) => toCanvas(v, narrowRef.current));
    setFocus((f) => ({ blockId, n: (f?.n ?? 0) + 1 }));
  }, []);
  const showFrame = useCallback((frameId: string) => {
    setView((v) => toCanvas(v, narrowRef.current));
    setFocus((f) => ({ frameId, n: (f?.n ?? 0) + 1 }));
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
  const pdfScope = exportSelected ? 'selection' : showDoc ? 'document' : 'canvas';
  const pdfExport = () => void report(pdfScope === 'document' ? Promise.resolve().then(() => exportDocumentPdf(session.getState().file?.document)) : exportCanvas(canvasHandle.current, 'pdf', session.getState().file?.title ?? '', exportOptions));
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
    const lay = !needCanvas && h ? h.layout.state() : null;
    const layoutEditCmd = (): Command => ({
      id: 'layout-edit',
      group: 'block',
      icon: Move,
      title: lay?.editing ? '레이아웃 편집 끝내기' : '레이아웃 편집',
      disabled: !lay?.block,
      hint: lay?.block ? undefined : '블록을 하나 고를 때',
      keywords: ['layout', 'edit', 'node', '배치', '노드', '옮기기'],
      run: () => canvasHandle.current?.layout.edit(),
    });
    const layoutResetCmd = (): Command => ({
      id: 'layout-reset',
      group: 'block',
      icon: RotateCcw,
      title: '레이아웃 초기화',
      disabled: !lay?.moved,
      hint: lay?.moved ? undefined : lay?.block ? '옮긴 배치가 없어요' : '블록을 하나 고를 때',
      keywords: ['layout', 'reset', '배치', '초기화', '자동 배치'],
      run: () => canvasHandle.current?.layout.reset(),
    });
    const freeformCmd = (): Command => ({
      id: 'block-freeform',
      group: 'block',
      icon: Shapes,
      title: '자유 도형으로 바꾸기',
      disabled: !lay?.graph,
      hint: lay?.graph ? undefined : lay?.block ? '그래프 블록만 바꿀 수 있어요' : '블록을 하나 고를 때',
      keywords: ['freeform', 'convert', 'shapes', 'ungroup', '자유', '도형', '변환', '바꾸기'],
      run: () => canvasHandle.current?.layout.freeform(),
    });
    const canvasCmd = (id: string, title: string, keys: string | undefined, k: Parameters<CanvasHandle['key']>[0], keywords: string[], icon: Command['icon']): Command => ({ id, title, group: 'canvas', icon, keys, disabled: needCanvas, hint: needCanvas ? '캔버스가 보일 때' : undefined, keywords, run: key(k) });
    return [
      { id: 'new-file', title: '새 파일', icon: FilePlus, keywords: ['new', 'file', 'create', '만들기', '파일'], run: () => void newFile() },
      { id: 'new-folder', title: '새 폴더', icon: FolderPlus, keywords: ['new', 'folder', 'create', '만들기', '폴더'], run: () => void newFolder() },
      { id: 'export-svg', title: '캔버스를 SVG로 내보내기', icon: ImageDown, disabled: needCanvas, keywords: ['export', 'svg', '내보내기', '이미지'], run: () => imageExport('svg') },
      { id: 'export-png', title: '캔버스를 PNG로 내보내기', icon: ImageDown, disabled: needCanvas, keywords: ['export', 'png', '내보내기', '이미지'], run: () => imageExport('png') },
      { id: 'export-copy', title: '이미지로 복사', icon: Copy, keys: 'Shift+Alt+C', disabled: needCanvas, keywords: ['copy', 'image', '복사', '클립보드'], run: () => imageExport('copy') },
      { id: 'export-md', title: '문서를 Markdown으로 내보내기', icon: FileText, disabled: !hasFile, keywords: ['export', 'markdown', 'md', '내보내기', '문서'], run: markdownExport },
      { id: 'history', title: '버전 기록 열기', icon: Clock, disabled: !hasFile, keywords: ['history', 'version', 'restore', '버전', '기록', '되돌리기'], run: () => setHistoryOpen(true) },
      { id: 'trash', title: '최근에 지운 파일 보기', icon: Trash, keywords: ['trash', 'deleted', 'restore', '휴지통', '지운', '되살리기', '복구'], run: () => setTrashOpen(true) },
      { id: 'view-doc', title: '보기: 문서', group: 'view', icon: PanelLeft, run: () => setView('doc'), keywords: ['view', '보기'] },
      { id: 'view-both', title: '보기: 둘 다', group: 'view', icon: Columns2, run: () => setView('both'), keywords: ['view', '보기'] },
      { id: 'view-canvas', title: '보기: 캔버스', group: 'view', icon: PanelRight, run: () => setView('canvas'), keywords: ['view', '보기'] },
      { id: 'theme', title: theme === 'dark' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기', group: 'view', icon: theme === 'dark' ? Sun : Moon, run: toggleTheme, keywords: ['theme', 'dark', 'light', '테마', '다크'] },
      canvasCmd('tool-select', '도구: 선택', 'V', { key: 'v' }, ['tool', 'select', '도구'], MousePointer2),
      canvasCmd('tool-rect', '도구: 사각형', 'R', { key: 'r' }, ['tool', 'rectangle', '도구'], Square),
      canvasCmd('tool-diamond', '도구: 마름모', 'D', { key: 'd' }, ['tool', 'diamond', '도구'], Diamond),
      canvasCmd('tool-ellipse', '도구: 원', 'O', { key: 'o' }, ['tool', 'ellipse', 'circle', '도구'], Circle),
      canvasCmd('tool-arrow', '도구: 화살표', 'A', { key: 'a' }, ['tool', 'arrow', '도구'], ArrowUpRight),
      canvasCmd('tool-line', '도구: 선', 'L', { key: 'l' }, ['tool', 'line', '도구'], Minus),
      canvasCmd('tool-draw', '도구: 그리기', 'P', { key: 'p' }, ['tool', 'draw', 'pencil', '도구'], Pencil),
      canvasCmd('tool-text', '도구: 글자', 'T', { key: 't' }, ['tool', 'text', '도구'], Type),
      canvasCmd('tool-eraser', '도구: 지우개', 'E', { key: 'e' }, ['tool', 'eraser', '도구'], Eraser),
      canvasCmd('tool-hand', '도구: 손(화면 이동)', 'H', { key: 'h' }, ['tool', 'hand', 'pan', '도구'], Hand),
      canvasCmd('zoom-in', '확대', `${M}+`, { key: '=', code: 'Equal', ctrl: true }, ['zoom', '줌'], ZoomIn),
      canvasCmd('zoom-out', '축소', `${M}-`, { key: '-', code: 'Minus', ctrl: true }, ['zoom', '줌'], ZoomOut),
      canvasCmd('zoom-reset', '화면 크기 100%', `${M}0`, { key: '0', code: 'Digit0', ctrl: true }, ['zoom', '줌'], Scan),
      canvasCmd('zoom-fit', '모두 보이게 맞추기', 'Shift+1', { key: '!', code: 'Digit1', shift: true }, ['zoom', 'fit', '줌'], Maximize),
      canvasCmd('undo', '실행 취소', `${M}Z`, { key: 'z', ctrl: true }, ['undo', '되돌리기'], Undo2),
      canvasCmd('redo', '다시 실행', `${M}Shift+Z`, { key: 'z', ctrl: true, shift: true }, ['redo'], Redo2),
      canvasCmd('duplicate', '복제', `${M}D`, { key: 'd', ctrl: true }, ['duplicate', 'copy'], CopyPlus),
      canvasCmd('delete', '삭제', 'Delete', { key: 'Delete' }, ['delete', 'remove'], Delete),
      canvasCmd('select-all', '전체 선택', `${M}A`, { key: 'a', ctrl: true }, ['select', 'all'], SquareDashedMousePointer),
      layoutEditCmd(),
      layoutResetCmd(),
      freeformCmd(),
    ];
  };
  const fileCommands = (): Command[] =>
    filesOf(tree).map((f) => ({
      id: `file:${f.path}`,
      title: displayName(f),
      group: 'file',
      icon: File,
      hint: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : undefined,
      keywords: [f.name, f.path],
      disabled: f.path === path,
      searchOnly: true,
      run: () => void open(f.path),
    }));
  const [registry] = useState(() => new CommandRegistry());
  useCommandSource(registry, 'app', commands);
  useCommandSource(registry, 'files', fileCommands);

  const dark = theme === 'dark';
  const place = useMemo(() => docPlace(projects, path), [projects, path]);
  const doc = hasFile && path && (
    <>
      <DocSlot session={session} dark={dark} tree={tree} jump={jump} onOpenFile={openFile} onNotice={setStatus} onShow={showBlock} onShowFrame={showFrame} onExportBlock={blockExport} onFail={flushForReload} />
      <SubDocs node={place.node} onOpen={openFile} onAdd={() => void newFile(true)} />
    </>
  );
  const canvas = <CanvasSlot session={session} focus={focus} dark={dark} handle={canvasHandle} onFail={flushForReload} />;

  // The document screen sits flush against the sidebar (frame A); everything else is a floating panel (frame B).
  const docScreen = hasFile && section.kind === 'doc';
  const homeSection = section.kind === 'doc' ? ({ kind: 'all' } as const) : section;
  const showSection = useCallback(
    (s: Section) => {
      setSection(s);
      // The file stays loaded (its edits are already in the session); the address no longer names it.
      setHashPath(null);
      if (narrow) setNavOpen(false);
    },
    [narrow],
  );
  const openCrumb = (c: Crumb) => (c.kind === 'project' ? showSection({ kind: 'project', path: c.path }) : void open(c.path));

  // Shell shortcuts (doc 6 §5): A 모든 파일, R 최근, B 보관함, N 새 파일, "," 설정. Never inside a text field,
  // an editor, the canvas (its own tool keys) or a dialog: see shellKey.
  const newFileRef = useRef(newFile);
  newFileRef.current = newFile;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = shellKey(e);
      if (!k) return;
      e.preventDefault();
      if (k === 'all') showSection({ kind: 'all' });
      else if (k === 'recent') showSection({ kind: 'recent' });
      else if (k === 'archive') setTrashOpen(true);
      else if (k === 'new') void newFileRef.current();
      else setSettingsOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSection]);

  const sidebar = (
    <Sidebar
      workspace={workspace}
      view={projects}
      section={docScreen ? section : homeSection}
      current={docScreen ? path : null}
      onSection={showSection}
      onOpen={openFile}
      onNewFile={() => void newFile()}
      onNewProject={() => void newProject()}
      onRename={(n) => void renameEntry(n)}
      onDelete={(n) => void remove(n)}
      onArchive={() => setTrashOpen(true)}
      onCommands={() => {
        setExportOpen(false);
        setPaletteOpen(true);
      }}
      theme={theme}
      onToggleTheme={toggleTheme}
      settingsOpen={settingsOpen}
      onSettingsOpen={setSettingsOpen}
    />
  );

  return (
    <CommandRegistryContext.Provider value={registry}>
      <SidebarProvider openMobile={navOpen} onOpenMobileChange={setNavOpen}>
        {sidebar}
        <SidebarInset frame={docScreen ? 'attached' : 'floating'}>
          {historyOpen && path && <HistoryDialog path={path} dark={dark} onClose={() => setHistoryOpen(false)} onRestore={restoreVersion} />}
          {trashOpen && <TrashDialog onClose={() => setTrashOpen(false)} onRestored={() => void refreshTree()} />}
          {paletteOpen && <CommandPalette commands={registry.list()} onClose={() => setPaletteOpen(false)} />}
          {conflict && (
            <div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm" style={{ background: 'var(--brand-soft)' }}>
              <span className="mr-auto">이 파일이 다른 곳에서 바뀌었어요. 어떻게 할까요?</span>
              <button type="button" className="h-7 rounded-md border px-3" style={{ borderColor: 'var(--border)' }} onClick={() => void reload()}>
                다시 불러오기
              </button>
              <button
                type="button"
                disabled={conflict.revision === undefined}
                className="h-7 rounded-md px-3 font-medium text-brand-foreground disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
                onClick={overwrite}
              >
                내 것으로 덮어쓰기
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-center gap-2 px-4 py-2 text-sm" style={{ background: 'var(--brand-soft)' }}>
              <span>{error}</span>
              <button type="button" className="ml-auto underline" onClick={() => setError(null)}>
                닫기
              </button>
            </div>
          )}
          {!docScreen ? (
            <ShellHome section={homeSection} view={projects} narrow={narrow} onOpen={openFile} onNewFile={() => void newFile()} />
          ) : (
            <>
          <TopBar
            title={title}
            hasFile={hasFile}
            status={status}
            statusAlert={statusAlert}
            view={shown}
            onView={setView}
            narrow={narrow}
            trail={place.trail}
            onCrumb={openCrumb}
            onSubDoc={() => void newFile(true)}
            onTitle={(title) => edit({ title })}
            onHistory={() => setHistoryOpen(true)}
          onCommands={() => {
            setExportOpen(false);
            setPaletteOpen(true);
          }}
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
                pdfScope={pdfScope}
                onPdf={pdfExport}
              />
            }
          />
              {shown === 'both' ? (
            <Splitter ratio={ratio} onRatio={setRatio} left={doc} right={canvas} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {showDoc && doc}
              {showCanvas && canvas}
            </div>
          )}
            </>
          )}
        </SidebarInset>
      </SidebarProvider>
    </CommandRegistryContext.Provider>
  );
}
