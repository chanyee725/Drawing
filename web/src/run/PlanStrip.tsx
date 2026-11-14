// The plan gate under the top bar (E20, docs/design/dispatch-integration/3-ux-flow.md §3): while a pipeline file
// is a 계획, it says what would start and holds the one 시작하기 button; the confirm shows sessions, limits,
// what the person changed and unanswered asks. Running files are E22's strip, so this one hides then.
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FileSession } from '../fileSession';
import { useSession } from '../useSession';
import { PLAN_CHANGED_NOTICE, confirmSnapshot, isPlanChanged, limitLine, startError, unansweredAsks, type PipelineStatus, type PlanSnapshot } from './planStripModel';
import { openPlanConfirm, requestStart } from './planOpen';
import { events } from '../lib/events';

async function readStatus(path: string): Promise<PipelineStatus | null> {
  const res = await fetch(`/api/pipeline?path=${encodeURIComponent(path)}`);
  if (!res.ok) return null;
  return (await res.json()) as PipelineStatus;
}

export function PlanStrip({ session }: { session: FileSession }) {
  const path = useSession(session, (s) => (s.file ? s.path : null));
  const revision = useSession(session, (s) => s.file?.revision ?? null);
  const hasPlan = useSession(session, (s) => !!s.file?.plan);
  const document = useSession(session, (s) => s.file?.document);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The plan the dialog shows; 시작하기 sends this revision, never a later one.
  const [shown, setShown] = useState<PlanSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const noticeId = useId();
  const blockersId = useId();

  const refresh = useCallback(async () => {
    if (!path || !hasPlan) return setStatus(null);
    const st = await readStatus(path).catch(() => null);
    // A different file may be open by the time the answer comes back.
    if (session.getState().path === path) setStatus(st);
  }, [path, hasPlan, session]);

  // The file's own saves change blockers and changes; so does the server's `pipeline` event (start, write_plan).
  useEffect(() => {
    setError(null);
    void refresh();
  }, [refresh, revision]);
  useEffect(() => {
    if (!path || !hasPlan) return;
    return events.subscribeJson<{ path?: string }>('pipeline', (e) => {
      if (e.path === path) void refresh();
    });
  }, [path, hasPlan, refresh]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (confirming && !d.open) d.showModal();
    if (!confirming && d.open) d.close();
  }, [confirming]);

  if (!path || !status || status.state !== 'plan') return null;
  const blocked = status.blockers.length > 0;
  const asks = unansweredAsks(document);
  const view = shown ?? status;
  const viewLimits = limitLine(view.limits);

  // Unsaved edits belong to the plan the person approves, so save first, then show what the server holds.
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await openPlanConfirm(session, path, readStatus);
      if (r.kind === 'refuse') return setError(r.message);
      if (r.kind === 'gone') return void refresh();
      const st = r.status;
      setStatus(st);
      setShown(confirmSnapshot(st));
      setNotice(null);
      setConfirming(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '시작하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!shown) return;
    setBusy(true);
    setError(null);
    try {
      const { res, body } = await requestStart(path, shown);
      if (!res.ok) {
        if (isPlanChanged(res.status, body)) {
          // Stay in the dialog with the new plan, so the person confirms what will really run.
          const st = await readStatus(path).catch(() => null);
          if (st && st.state === 'plan') {
            setStatus(st);
            setShown(confirmSnapshot(st));
            setNotice(PLAN_CHANGED_NOTICE);
            return;
          }
        }
        setError(startError(res.status, body));
        setConfirming(false);
        void refresh();
        return;
      }
      setConfirming(false);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '시작하지 못했어요');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Alert role="status" className="bg-muted" data-testid="plan-strip">
      <span aria-hidden="true">◐</span>
      <span className="mr-auto">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : blocked ? (
          <>계획이에요. 지금은 시작할 수 없어요: {status.blockers[0]}</>
        ) : (
          <>계획이에요. 고칠 곳을 고친 뒤 시작해 주세요.</>
        )}
      </span>
      <span className="text-muted-foreground">예상 {status.sessions}세션</span>
      {/* A disabled button gets no pointer events, so the tooltip with every blocker sits on the wrapper. */}
      <span title={blocked ? status.blockers.join('\n') : undefined} data-testid="start-wrap" className="inline-flex">
        <Button
          size="sm"
          disabled={blocked || busy}
          aria-describedby={blocked ? blockersId : undefined}
          className="px-3 text-sm hover:bg-primary"
          onClick={() => void open()}
        >
          시작하기
        </Button>
      </span>
      {blocked && <span id={blockersId} className="sr-only">{status.blockers.join(', ')}</span>}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setConfirming(false)}
        className="m-auto w-[min(28rem,calc(100%-2rem))] overscroll-contain rounded-lg border bg-background p-0 text-sm text-foreground shadow-md backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/40"
      >
        <h2 id={titleId} className="border-b px-4 py-2.5 text-sm font-semibold">
          이 계획으로 시작할까요?
        </h2>
        <div className="flex flex-col gap-1.5 px-4 py-3">
          <p>
            세션 {view.sessions}개{viewLimits ? ` · ${viewLimits}` : ''}
          </p>
          <p>바뀐 점: {view.changes.length ? view.changes.join(', ') : '없어요'}</p>
          {/* Space is reserved (visibility, not display) so the buttons do not move under the pointer. */}
          <p id={noticeId} role="alert" className="text-destructive" style={{ visibility: notice ? 'visible' : 'hidden' }}>
            {notice ?? PLAN_CHANGED_NOTICE}
          </p>
          {asks > 0 && <p className="text-destructive">물어볼 것 {asks}개에 답이 없어요. 그래도 시작할까요?</p>}
        </div>
        <form method="dialog" className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
          <Button type="submit" value="cancel" variant="outline" size="sm" className="bg-transparent px-3 text-sm">
            취소
          </Button>
          <Button
            size="sm"
            disabled={busy}
            aria-describedby={notice ? noticeId : undefined}
            className="px-3 text-sm hover:bg-primary"
            onClick={() => void start()}
          >
            시작하기
          </Button>
        </form>
      </dialog>
    </Alert>
  );
}
