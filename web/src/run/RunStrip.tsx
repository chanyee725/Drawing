// Run status strip (E22, docs/design/dispatch-integration/3-ux-flow.md §4): one line under the top bar on every view
// of a pipeline file with runs, a second line only when a session needs a person. While a run is live it also keeps
// the Dispatch stream open (live session states, limits) and feeds the canvas overlay. E27: 멈추기 while running,
// 이어서 하기 and 계획 다시 열기 while paused; amber while the usage-limit guard holds the run. E28: 복제해서 새 계획 on a
// done run (opens the new draft); while a past run is picked it says so, draws that run on the canvas and offers
// 최근 실행 보기.
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { connect } from '../dispatch/store.ts';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { ACTION_LABEL, DUPLICATE_LABEL, actionsFor, canDuplicate, requestAction, requestDuplicate, type RunAction } from './runControl.ts';
import { reloadRun, selectRun } from './runData.ts';
import { overlaySteps } from './runModel.ts';
import { setRunSteps } from './runStore.ts';
import { useRunModel } from './useRunModel.ts';

const SessionSheet = lazy(() => import('../dispatch/SessionSheet').then((m) => ({ default: m.SessionSheet })));

type Props = {
  /** Diagram code of the plan block (step titles). */
  code: string | undefined;
  /** The run view is showing (its button reads as current). */
  inRunView: boolean;
  onRunView: () => void;
  /** Open a file (the new draft after 복제해서 새 계획). */
  onOpenFile: (path: string) => void;
};

export function RunStrip({ code, inRunView, onRunView, onOpenFile }: Props) {
  const m = useRunModel(code);
  const [sheet, setSheet] = useState<string | null>(null);
  const [busy, setBusy] = useState<RunAction | 'duplicate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const block = m.record?.plan.snapshot.block;
  const path = m.data.path;
  const runState = m.record?.state;
  // A past run the person picked in the run view (E28), not the file's current one.
  const past = m.data.selected !== null;

  // A new state (or another file) makes an old refusal stale.
  useEffect(() => setError(null), [path, runState]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (confirming && !d.open) d.showModal();
    if (!confirming && d.open) d.close();
  }, [confirming]);

  // Live session states and limits only while a run is live.
  useEffect(() => (m.running ? connect() : undefined), [m.running]);

  // The canvas overlay follows the live run, or the past run the person picked; it goes away when the run ends.
  useEffect(() => {
    if (block) setRunSteps(block, m.running || past ? overlaySteps(m.rows) : null);
  }, [block, m.running, past, m.rows]);
  useEffect(() => (block ? () => setRunSteps(block, null) : undefined), [block]);

  if (!m.strip) return null;
  const s = m.strip;
  const first = s.attention[0];
  const actions = past ? [] : actionsFor(s.state);
  const duplicable = !past && canDuplicate(s.state);

  const duplicate = async () => {
    if (busy) return;
    setBusy('duplicate');
    setError(null);
    try {
      const r = await requestDuplicate(path);
      if ('error' in r) setError(r.error);
      else onOpenFile(r.path);
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: RunAction) => {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const err = await requestAction(action, path);
      if (err) setError(err);
      else setConfirming(false);
      await reloadRun();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn('shrink-0 border-b text-xs', s.tone === 'warn' ? 'bg-warn/15' : 'bg-sidebar')} data-run-strip data-run-state={s.state}>
      <div className="flex min-h-8 items-center gap-2 px-3">
        <span aria-hidden className={cn(s.tone === 'ok' ? 'text-ok' : s.tone === 'warn' ? 'text-warn' : 'text-muted-foreground')}>
          {s.glyph}
        </span>
        {s.progress.total > 0 && <progress className="run-progress w-16 shrink-0" value={s.progress.percent} max={100} aria-label="진행률" />}
        <span className="min-w-0 flex-1 truncate text-foreground" title={s.parts.join(' · ')}>
          {past && <span className="mr-1.5 rounded-sm border px-1 text-muted-foreground">지난 실행</span>}
          {s.parts.join(' · ')}
        </span>
        {past && (
          <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-xs', FOCUS_RING)} onClick={() => void selectRun(null)}>
            최근 실행 보기
          </Button>
        )}
        <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-xs', FOCUS_RING)} aria-pressed={inRunView} onClick={onRunView}>
          실행 보기
        </Button>
        {actions.map((a) => (
          <Button
            key={a}
            variant="ghost"
            size="sm"
            className={cn('h-6 px-2 text-xs', FOCUS_RING)}
            aria-disabled={busy !== null || undefined}
            onClick={() => (a === 'reopen' ? setConfirming(true) : void act(a))}
          >
            {busy === a ? `${ACTION_LABEL[a]}…` : ACTION_LABEL[a]}
          </Button>
        ))}
        {duplicable && (
          <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-xs', FOCUS_RING)} aria-disabled={busy !== null || undefined} onClick={() => void duplicate()}>
            {busy === 'duplicate' ? `${DUPLICATE_LABEL}…` : DUPLICATE_LABEL}
          </Button>
        )}
      </div>
      {error && !confirming && (
        <div className="flex min-h-8 items-center gap-2 border-t px-3" role="alert" data-run-error>
          <span aria-hidden className="text-destructive">
            ⚠
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground" title={error}>
            {error}
          </span>
          <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-xs', FOCUS_RING)} onClick={() => setError(null)}>
            닫기
          </Button>
        </div>
      )}
      {first && (
        <div className="flex min-h-8 items-center gap-2 border-t px-3" role="alert">
          <span aria-hidden className="text-warn">
            ⚠
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            확인 필요 {s.attention.length} · {first.text}
          </span>
          {m.sessions.find((x) => x.sid === first.sid)?.live && (
            <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-xs', FOCUS_RING)} onClick={() => setSheet(first.sid)}>
              열기
            </Button>
          )}
        </div>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setConfirming(false)}
        className="m-auto w-[min(28rem,calc(100%-2rem))] overscroll-contain rounded-lg border bg-background p-0 text-sm text-foreground shadow-md backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/40"
      >
        <h2 id={titleId} className="border-b px-4 py-2.5 text-sm font-semibold">
          계획을 다시 열까요?
        </h2>
        <p className="px-4 py-3">
          이번 실행은 멈춘 채로 끝나요. 끝난 단계는 다음에 시작하기를 누르면 완료로 이어져요.
        </p>
        {error && (
          <p className="px-4 pb-3 text-destructive" role="alert">
            {error}
          </p>
        )}
        <form method="dialog" className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
          <button type="submit" value="cancel" className={cn('h-7 rounded-md border px-3', FOCUS_RING)}>
            취소
          </button>
          <button
            type="button"
            aria-disabled={busy !== null || undefined}
            className={cn('h-7 rounded-md px-3 font-medium text-primary-foreground aria-disabled:opacity-50', FOCUS_RING)}
            style={{ background: 'var(--primary)' }}
            onClick={() => void act('reopen')}
          >
            계획 다시 열기
          </button>
        </form>
      </dialog>
      {sheet && (
        <Suspense fallback={null}>
          <SessionSheet id={sheet} onClose={() => setSheet(null)} />
        </Suspense>
      )}
    </div>
  );
}
