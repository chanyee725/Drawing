// Recently deleted files (kept 30 days) with a "restore" button each. The server puts a file back at its old path.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type TrashItem } from './api';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog';

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

  const hint = 'px-4 py-2 text-sm text-muted-foreground';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label="최근에 지운 파일" aria-describedby="trash-note" className="h-[min(32rem,calc(100%-2rem))] w-[min(36rem,calc(100%-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle className="mr-auto">최근에 지운 파일</DialogTitle>
          <Button ref={closeRef} variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </DialogHeader>
        <DialogDescription id="trash-note" className="px-4 py-2">
          지운 파일은 30일 동안 보관해요. 버전 기록도 함께 돌아와요.
        </DialogDescription>
        {message && (
          <p role="alert" className="bg-muted px-4 py-2 text-sm">
            {message}
          </p>
        )}
        <ul className="min-h-0 flex-1 overflow-auto border-t p-1.5" aria-label="지운 파일">
          {items === null && <li className={hint}>불러오는 중이에요…</li>}
          {items?.length === 0 && <li className={hint}>최근에 지운 파일이 없어요</li>}
          {items?.map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-accent">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm" title={label(i.path)}>
                  {label(i.path)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">{when(i.deletedAt)}에 지웠어요</div>
                {i.fromSnapshot && <div className="text-xs text-muted-foreground">앱 밖에서 지워서 마지막 버전 기록으로 돌아와요. 마지막으로 저장한 내용보다 오래됐을 수 있어요</div>}
              </div>
              <Button size="sm" className="shrink-0" disabled={busy !== null} onClick={() => void restore(i)}>
                {busy === i.id ? '되살리는 중이에요…' : '되살리기'}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
