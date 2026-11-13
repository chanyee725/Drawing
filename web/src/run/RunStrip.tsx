// Run status strip (E22, docs/design/dispatch-integration/3-ux-flow.md §4): one line under the top bar on every view
// of a pipeline file with runs, a second line only when a session needs a person. While a run is live it also keeps
// the Dispatch stream open (live session states, limits) and feeds the canvas overlay.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { connect } from '../dispatch/store.ts';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
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
};

export function RunStrip({ code, inRunView, onRunView }: Props) {
  const m = useRunModel(code);
  const [sheet, setSheet] = useState<string | null>(null);
  const block = m.record?.plan.snapshot.block;

  // Live session states and limits only while a run is live.
  useEffect(() => (m.running ? connect() : undefined), [m.running]);

  // The canvas overlay follows the live run; it goes away when the run ends.
  useEffect(() => {
    if (block) setRunSteps(block, m.running ? overlaySteps(m.rows) : null);
  }, [block, m.running, m.rows]);
  useEffect(() => (block ? () => setRunSteps(block, null) : undefined), [block]);

  if (!m.strip) return null;
  const s = m.strip;
  const first = s.attention[0];
  return (
    <div className="shrink-0 border-b bg-sidebar text-xs" data-run-strip>
      <div className="flex min-h-8 items-center gap-2 px-3">
        <span aria-hidden className={cn(s.state === 'running' ? 'text-ok' : 'text-muted-foreground')}>
          {s.glyph}
        </span>
        {s.progress.total > 0 && <progress className="run-progress w-16 shrink-0" value={s.progress.percent} max={100} aria-label="진행률" />}
        <span className="min-w-0 flex-1 truncate text-foreground" title={s.parts.join(' · ')}>
          {s.parts.join(' · ')}
        </span>
        <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-xs', FOCUS_RING)} aria-pressed={inRunView} onClick={onRunView}>
          실행 보기
        </Button>
      </div>
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
      {sheet && (
        <Suspense fallback={null}>
          <SessionSheet id={sheet} onClose={() => setSheet(null)} />
        </Suspense>
      )}
    </div>
  );
}
