// Version history of the open file: the saved versions, a read-only preview, and "restore".
// Restoring is a normal save of that version's content over the current file (App does it).
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type HistoryEntry, type HistoryVersion } from './api';
import { documentToMarkdown } from './export/markdown';

type Props = {
  path: string;
  dark: boolean;
  onClose: () => void;
  /** Resolves with an error message, or null once the version is restored. */
  onRestore: (id: string) => Promise<string | null>;
};

const when = (t: number) => new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
// Server messages are English; show Korean copy by status, never the raw message.
const errText = (e: unknown, fallback: string) => {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 404) return '이 버전을 찾지 못했어요';
  if (status === 422) return '이 버전을 읽을 수 없어요';
  return fallback;
};

/** Block diagrams and free-form drawings of a version, drawn with the same renderers as the app (loaded on use). */
function Pictures({ v, dark }: { v: HistoryVersion; dark: boolean }) {
  const [svgs, setSvgs] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setSvgs([]);
    setFailed(false);
    (async () => {
      const out: string[] = [];
      const { renderBlock } = await import('./canvas/render');
      for (const b of v.blocks) out.push((await renderBlock({ ...b, id: `history:${v.id}:${b.id}` }, dark ? 'dark' : 'light')).svg);
      const elements = ((v.canvas as { elements?: unknown[] } | null)?.elements ?? []).filter((e) => !(e as { isDeleted?: boolean }).isDeleted && (e as { type?: string }).type !== 'image');
      if (elements.length) {
        const { exportToSvg } = await import('@excalidraw/excalidraw');
        const el = await exportToSvg({ elements: elements as never, appState: { exportBackground: false, exportWithDarkMode: dark }, files: null, exportPadding: 8 });
        out.push(el.outerHTML);
      }
      if (live) setSvgs(out);
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [v, dark]);
  if (failed) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>그림을 그리지 못했어요</p>;
  return (
    <div className="flex flex-col gap-3" aria-label="그림 미리보기">
      {svgs.map((s, i) => (
        // The SVG comes from our own renderers, not from file text.
        <div key={i} className="max-w-full overflow-auto rounded-md border p-2 [&_svg]:h-auto [&_svg]:max-w-full" style={{ borderColor: 'var(--border)' }} dangerouslySetInnerHTML={{ __html: s }} />
      ))}
    </div>
  );
}

export function HistoryDialog({ path, dark, onClose, onRestore }: Props) {
  const [versions, setVersions] = useState<HistoryEntry[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryVersion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    api
      .history(path)
      .then((v) => {
        if (!live) return;
        setVersions(v);
        if (v[0]) setPicked(v[0].id);
      })
      .catch((e) => live && (setVersions([]), setMessage(errText(e, '버전 기록을 불러오지 못했어요'))));
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    if (!picked) return setPreview(null);
    let live = true;
    setPreview(null);
    api
      .historyVersion(path, picked)
      .then((v) => live && setPreview(v))
      .catch((e) => live && setMessage(errText(e, '이 버전을 불러오지 못했어요')));
    return () => {
      live = false;
    };
  }, [path, picked]);

  useEffect(() => closeRef.current?.focus(), []);

  const restore = async () => {
    if (!picked || !preview || busy) return;
    if (!window.confirm(`${when(preview.time)} 버전으로 되돌릴까요? 지금 내용도 버전 기록에 남겨 둬요.`)) return;
    setBusy(true);
    setMessage(null);
    const err = await onRestore(picked);
    setBusy(false);
    if (err) setMessage(err);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgb(0 0 0 / 0.3)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="버전 기록"
        className="flex h-[min(40rem,calc(100%-2rem))] w-[min(56rem,100%)] flex-col overflow-hidden rounded-lg border shadow-xl"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--border)' }}>
          <h2 className="mr-auto font-medium">버전 기록</h2>
          <button ref={closeRef} type="button" className="h-7 rounded-md border px-3 text-sm" style={{ borderColor: 'var(--border)' }} onClick={onClose}>
            닫기
          </button>
        </div>
        {message && (
          <p role="alert" className="px-4 py-2 text-sm" style={{ background: 'var(--accent-soft)' }}>
            {message}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul className="max-h-40 shrink-0 overflow-auto border-b md:max-h-none md:w-56 md:border-b-0 md:border-r" style={{ borderColor: 'var(--border)' }} aria-label="저장된 버전">
            {versions === null && (
              <li className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                불러오는 중이에요…
              </li>
            )}
            {versions?.length === 0 && (
              <li className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                아직 저장된 버전이 없어요
              </li>
            )}
            {versions?.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={picked === v.id}
                  onClick={() => setPicked(v.id)}
                  className="w-full px-3 py-2 text-left text-sm"
                  style={picked === v.id ? { background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 } : undefined}
                >
                  {when(v.time)}
                </button>
              </li>
            ))}
          </ul>
          <section className="min-h-0 min-w-0 flex-1 overflow-auto p-4" aria-label="미리보기">
            {!picked ? null : !preview ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                불러오는 중이에요…
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  읽기 전용 미리보기예요
                </p>
                <pre data-testid="history-doc" className="whitespace-pre-wrap break-words font-sans text-sm">
                  {documentToMarkdown(preview.title, preview.document, preview.blocks)}
                </pre>
                <Pictures v={preview} dark={dark} />
              </div>
            )}
          </section>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-2" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            disabled={!preview || busy}
            onClick={() => void restore()}
            className="h-8 rounded-md px-3 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {busy ? '되돌리는 중이에요…' : '이 버전으로 되돌리기'}
          </button>
        </div>
      </div>
    </div>
  );
}
