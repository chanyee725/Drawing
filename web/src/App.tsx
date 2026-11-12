import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pickDataSource, type ConnectionState, type DataSource, type FileDetail, type FileSummary } from './data';
import { applyFileEvent, paths, pickFile, sortFiles, sourcesFor } from './data/files';
import { DiagramView, type DiagramApi } from './view/DiagramView';
import { HistoryHighlight, HistoryPanel, useHistory } from './history';

function readUrl() {
  const q = new URLSearchParams(window.location.search);
  return { file: q.get('file'), page: q.get('page') };
}

function writeUrl(file: string | null, page: string | null) {
  const q = new URLSearchParams(window.location.search);
  if (file) q.set('file', file);
  else q.delete('file');
  if (page) q.set('page', page);
  else q.delete('page');
  const s = q.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
}

const sourceName = (f: FileSummary) => (f.source.kind === 'main' ? 'main' : `${f.source.label} (작업 중)`);

export function App() {
  const [ds, setDs] = useState<DataSource | null>(null);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(() => readUrl().file);
  const [pageId, setPageId] = useState<string | null>(() => readUrl().page);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [conn, setConn] = useState<ConnectionState>('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [api, setApi] = useState<DiagramApi | null>(null);

  const filesRef = useRef(files);
  filesRef.current = files;
  const fileIdRef = useRef(fileId);
  fileIdRef.current = fileId;

  // Fetch the selected file; coalesce bursts of change events into one refetch at a time.
  const fetching = useRef<{ id: string; dirty: boolean } | null>(null);
  const loadDetail = useCallback(
    async (id: string) => {
      if (!ds) return;
      if (fetching.current?.id === id) {
        fetching.current.dirty = true;
        return;
      }
      fetching.current = { id, dirty: false };
      try {
        for (;;) {
          const d = await ds.getFile(id);
          if (fileIdRef.current !== id) return;
          setDetail(d);
          if (!fetching.current?.dirty) break;
          fetching.current.dirty = false;
        }
      } catch {
        if (fileIdRef.current !== id) return;
        // A delete can reach us as a failed fetch before the `file` event: re-read the list.
        const list = await ds.listFiles().catch(() => null);
        if (list && !list.some((f) => f.id === id)) {
          setFiles(sortFiles(list));
          setNotice('보고 있던 파일이 지워졌어요.');
        } else if (fileIdRef.current === id) setNotice('파일을 불러오지 못했어요. 잠시 뒤 다시 시도해요.');
      } finally {
        if (fetching.current?.id === id) fetching.current = null;
      }
    },
    [ds],
  );

  useEffect(() => {
    pickDataSource().then(setDs);
  }, []);

  useEffect(() => {
    if (!ds) return;
    let alive = true;
    ds.listFiles()
      .then((list) => alive && (setFiles(sortFiles(list)), setListError(null)))
      .catch(() => alive && setListError('파일 목록을 불러오지 못했어요. 서버가 켜져 있는지 확인해 주세요.'));
    const off = ds.subscribe({
      onState: setConn,
      onFile: (f) => {
        if (f.deleted && f.id === fileIdRef.current) setNotice('보고 있던 파일이 지워졌어요.');
        setFiles((list) => applyFileEvent(list, f));
        if (!f.deleted && f.id === fileIdRef.current) loadDetail(f.id);
      },
      onChange: (c) => {
        if (c.fileId === fileIdRef.current) loadDetail(c.fileId);
      },
    });
    return () => {
      alive = false;
      off();
    };
  }, [ds, loadDetail]);

  // Keep the selection valid as the file list changes.
  const current = useMemo(() => pickFile(files, fileId, detail?.path ?? null), [files, fileId, detail?.path]);
  useEffect(() => {
    if (!files.length) return; // keep the URL's choice until the list has loaded
    const next = current?.id ?? null;
    if (next !== fileId) setFileId(next);
  }, [current, fileId, files.length]);

  useEffect(() => {
    setDetail((d) => (d && d.id === fileId ? d : null));
    if (fileId) loadDetail(fileId);
  }, [fileId, loadDetail]);

  const pages = detail?.pages ?? current?.pages ?? [];
  const page = pages.find((p) => p.id === pageId) ?? pages[0] ?? null;
  const pageXml = detail && page ? (detail.pages.find((p) => p.id === page.id)?.xml ?? null) : null;
  const hist = useHistory({ enabled: ds?.name === 'api', fileId: current?.id ?? null, pageId: page?.id ?? null, setPageId });

  useEffect(() => writeUrl(fileId, page?.id ?? null), [fileId, page?.id]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const allPaths = paths(files);
  const sources = current ? sourcesFor(files, current.path) : [];
  const selectCls = 'h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm';

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <span className="text-sm font-semibold">Draw-Pipelines</span>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600">
          파일
          <select
            className={selectCls}
            value={current?.path ?? ''}
            onChange={(e) => {
              const f = pickFile(files, null, e.target.value);
              setFileId(f?.id ?? null);
              setPageId(null);
            }}
            disabled={!allPaths.length}
            data-testid="file-picker"
          >
            {allPaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600">
          보는 곳
          <select
            className={selectCls}
            value={current?.id ?? ''}
            onChange={(e) => setFileId(e.target.value)}
            disabled={sources.length < 2}
            title={sources.length < 2 ? '다른 작업 공간에는 이 파일이 없어요' : undefined}
            data-testid="source-picker"
          >
            {sources.map((f) => (
              <option key={f.id} value={f.id}>
                {sourceName(f)}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500" data-testid="conn">
          <span
            className={`inline-block h-2 w-2 rounded-full ${conn === 'open' ? 'bg-green-500' : conn === 'retrying' ? 'bg-amber-500' : 'bg-neutral-300'}`}
          />
          {conn === 'open' ? '실시간으로 보고 있어요' : conn === 'retrying' ? '연결이 끊겨서 다시 잇고 있어요' : '연결하고 있어요'}
          {ds?.name === 'mock' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">예시 데이터</span>}
        </span>
      </header>

      {pages.length > 0 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-3" aria-label="페이지" data-testid="page-tabs">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              data-page-id={p.id}
              onClick={() => setPageId(p.id)}
              className={`relative shrink-0 border-b-2 px-3 py-2 text-sm ${
                p.id === page?.id ? 'border-neutral-900 font-medium text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800'
              }`}
              aria-current={p.id === page?.id ? 'page' : undefined}
            >
              {p.name}
            </button>
          ))}
        </nav>
      )}

      <main className="relative flex-1">
        {listError ? (
          <div className="flex h-full items-center justify-center text-sm text-red-600">{listError}</div>
        ) : !files.length ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            {ds ? '아직 보여 줄 다이어그램이 없어요.' : '불러오고 있어요.'}
          </div>
        ) : (
          <DiagramView
            xml={hist.view ? hist.view.xml : pageXml}
            resetKey={`${current?.path}\n${page?.id}`}
            flashKey={hist.view ? hist.view.key : `${current?.id}\n${page?.id}`}
            onApi={setApi}
          >
            <HistoryHighlight api={api} cells={hist.view?.cells ?? null} viewKey={hist.view?.key ?? null} />
          </DiagramView>
        )}
        {files.length > 0 && <HistoryPanel h={hist} />}
        {notice && (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white shadow" role="status">
            {notice}
          </div>
        )}
      </main>
    </div>
  );
}
