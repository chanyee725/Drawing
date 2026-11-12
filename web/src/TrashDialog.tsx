// Recently deleted files (kept 30 days) with a "restore" button each. The server puts a file back at its old path.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type TrashItem } from './api';

type Props = {
  onClose: () => void;
  /** A file was restored: refresh the tree. */
  onRestored: (path: string) => void;
};

const when = (t: number) => new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
const label = (path: string) => path.replace(/\.dpx\.json$/, '');
// Server messages are English; show Korean copy by status, never the raw message.
const errText = (e: unknown) => {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 409 && /parent/.test(e instanceof Error ? e.message : '')) return '같은 이름의 파일이 있는 자리라 되살릴 수 없어요. 그 파일의 이름을 바꾼 뒤 다시 해 보세요';
  if (status === 409) return '같은 이름의 파일이 이미 있어요. 이름을 바꾸거나 지운 뒤 다시 해 보세요';
  if (status === 404) return '이미 정리된 파일이에요';
  if (status === 422) return '이 파일은 읽을 수 없어서 되살리지 못했어요';
  return '되살리지 못했어요';
};

export function TrashDialog({ onClose, onRestored }: Props) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = () =>
    api
      .trash()
      .then(setItems)
      .catch(() => (setItems([]), setMessage('지운 파일 목록을 불러오지 못했어요')));
  useEffect(() => {
    void load();
    closeRef.current?.focus();
  }, []);
  // Esc closes from anywhere: after a restore the clicked button is gone and focus would fall to the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const restore = async (item: TrashItem) => {
    if (busy) return;
    setBusy(item.id);
    setMessage(null);
    try {
      const { path } = await api.restoreTrash(item.id);
      onRestored(path);
      await load();
    } catch (e) {
      setMessage(errText(e));
      if (e instanceof ApiError && e.status === 404) void load();
    } finally {
      setBusy(null);
      closeRef.current?.focus(); // the restored row (and its button) is gone: keep focus inside the dialog
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgb(0 0 0 / 0.3)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="최근에 지운 파일"
        className="flex h-[min(32rem,calc(100%-2rem))] w-[min(36rem,100%)] flex-col overflow-hidden rounded-lg border shadow-xl"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--border)' }}>
          <h2 className="mr-auto font-medium">최근에 지운 파일</h2>
          <button ref={closeRef} type="button" className="h-7 rounded-md border px-3 text-sm" style={{ borderColor: 'var(--border)' }} onClick={onClose}>
            닫기
          </button>
        </div>
        <p className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          지운 파일은 30일 동안 보관해요. 버전 기록도 함께 돌아와요.
        </p>
        {message && (
          <p role="alert" className="px-4 py-2 text-sm" style={{ background: 'var(--accent-soft)' }}>
            {message}
          </p>
        )}
        <ul className="min-h-0 flex-1 overflow-auto" aria-label="지운 파일">
          {items === null && (
            <li className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              불러오는 중이에요…
            </li>
          )}
          {items?.length === 0 && (
            <li className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              최근에 지운 파일이 없어요
            </li>
          )}
          {items?.map((i) => (
            <li key={i.id} className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--border)' }}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm" title={label(i.path)}>
                  {label(i.path)}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {when(i.deletedAt)}에 지웠어요
                </div>
              </div>
              <button type="button" disabled={busy !== null} onClick={() => void restore(i)} className="h-7 shrink-0 rounded-md px-3 text-sm font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                {busy === i.id ? '되살리는 중이에요…' : '되살리기'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
