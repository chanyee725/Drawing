// Version history of the open file: the saved versions, a rendered read-only preview, and "restore".
// Restoring is a normal save of that version's content over the current file (App does it).
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type HistoryEntry, type HistoryVersion } from './api';
import { documentToMarkdown } from './export/markdown';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { cn } from './lib/utils';

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

type Rendered = { html: string | null; rest: string[] };

/**
 * A version drawn the way the app shows it: the document with its diagrams in place, then the blocks the
 * document does not embed and the free-form drawing. Same renderers as the app, loaded on use.
 */
function Rendered({ v, dark }: { v: HistoryVersion; dark: boolean }) {
  const [out, setOut] = useState<Rendered | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setOut(null);
    setFailed(false);
    (async () => {
      const [{ renderBlock }, { versionHtml }] = await Promise.all([import('./canvas/render'), import('./doc/previewHtml')]);
      const pictures = new Map<string, string>();
      for (const b of v.blocks) pictures.set(b.id, (await renderBlock({ ...b, id: `history:${v.id}:${b.id}` }, dark ? 'dark' : 'light')).svg);
      const html = versionHtml(v.document, pictures);
      const embedded = new Set(html === null ? [] : [...html.matchAll(/data-block-id="([^"]*)"/g)].map((m) => m[1]));
      const rest = v.blocks.filter((b) => !embedded.has(b.id)).map((b) => pictures.get(b.id) ?? '');
      const elements = ((v.canvas as { elements?: unknown[] } | null)?.elements ?? []).filter((e) => !(e as { isDeleted?: boolean }).isDeleted && (e as { type?: string }).type !== 'image');
      if (elements.length) {
        const { exportToSvg } = await import('@excalidraw/excalidraw');
        const el = await exportToSvg({ elements: elements as never, appState: { exportBackground: false, exportWithDarkMode: dark }, files: null, exportPadding: 8 });
        rest.push(el.outerHTML);
      }
      if (live) setOut({ html, rest });
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [v, dark]);
  const picture = 'max-w-full overflow-auto rounded-md border p-2 [&_svg]:h-auto [&_svg]:max-w-full';
  // Until it is drawn (or when it cannot be), the text of the document still shows.
  const text = (
    <pre className="font-sans text-sm break-words whitespace-pre-wrap">{documentToMarkdown('', v.document, v.blocks).trim()}</pre>
  );
  return (
    <>
      {out?.html != null ? (
        // The HTML comes from the editor's schema serializer and our own renderers, not from raw file text.
        <div className="doc-editor history-doc min-h-0! [&_figure]:my-3 [&_figure_svg]:h-auto [&_figure_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: out.html }} />
      ) : (
        text
      )}
      {failed && <p className="text-sm text-muted-foreground">그림을 그리지 못했어요</p>}
      {!!out?.rest.length && (
        <div className="flex flex-col gap-3" aria-label="그림 미리보기">
          {out.rest.map((s, i) => (
            <div key={i} className={picture} dangerouslySetInnerHTML={{ __html: s }} />
          ))}
        </div>
      )}
    </>
  );
}

export function HistoryDialog({ path, dark, onClose, onRestore }: Props) {
  const [versions, setVersions] = useState<HistoryEntry[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryVersion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .history(path)
      .then((v) => {
        if (!live) return;
        setVersions(v);
        if (v[0]) setPicked(v[0].id);
      })
      .catch(() => live && (setVersions([]), setMessage('버전 기록을 불러오지 못했어요')));
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

  const hint = 'px-3 py-2 text-sm text-muted-foreground';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label="버전 기록" aria-describedby={undefined} className="h-[min(40rem,calc(100%-2rem))] w-[min(56rem,calc(100%-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle className="mr-auto">버전 기록</DialogTitle>
          <Button variant="ghost" size="icon-sm" aria-label="닫기" title="닫기" onClick={onClose} className="max-md:size-11">
            <X />
          </Button>
        </DialogHeader>
        {message && (
          <p role="alert" className="bg-muted px-4 py-2 text-sm">
            {message}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul className="max-h-40 shrink-0 overflow-auto border-b p-1.5 md:max-h-none md:w-56 md:border-r md:border-b-0" aria-label="저장된 버전">
            {versions === null && <li className={hint}>불러오는 중이에요…</li>}
            {versions?.length === 0 && <li className={hint}>아직 저장된 버전이 없어요</li>}
            {versions?.map((v) => (
              <li key={v.id}>
                <Button
                  variant="ghost"
                  aria-pressed={picked === v.id}
                  onClick={() => setPicked(v.id)}
                  className={cn('h-(--h-row) w-full justify-start px-2.5 tabular-nums', picked === v.id && 'bg-muted font-semibold text-foreground')}
                >
                  {when(v.time)}
                </Button>
              </li>
            ))}
          </ul>
          <section className="min-h-0 min-w-0 flex-1 overflow-auto p-4" aria-label="미리보기">
            {!picked ? null : !preview ? (
              <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>
            ) : (
              <article data-testid="history-doc" aria-label="읽기 전용 미리보기" className="mx-auto flex max-w-2xl flex-col gap-4">
                <p className="text-xs text-muted-foreground">읽기 전용 미리보기예요</p>
                <h3 className="text-xl font-semibold break-words">{preview.title || '제목 없는 파일'}</h3>
                <Rendered v={preview} dark={dark} />
              </article>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button disabled={!preview || busy} onClick={() => void restore()}>
            {busy ? '되돌리는 중이에요…' : '이 버전으로 되돌리기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
