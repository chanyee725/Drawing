// 작업 보드: the lead's tasks by stage (plan … blocked) with owner, ETA and the time in the current stage, in a side sheet.
// Reads the live `tasks` slice of the store; shows metadata only (titles, stages, times), never transcripts.
import { useState } from 'react';
import { SquareKanban, TriangleAlert } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { cn } from '../lib/utils';
import { useNow } from './AttentionStrip';
import { STAGES, etaLine, groupByStage, span, stageLabel, stageSpans } from './lib/board.ts';
import { useDispatch } from './store';
import type { BoardTask, TaskStage } from './types';

/** Bar colour per stage: the mix tells at a glance where a task spent its time. */
const BAR: Record<TaskStage, string> = {
  plan: 'bg-muted-foreground/40', impl: 'bg-foreground/60', review: 'bg-ok/70', test: 'bg-warn/70', merge: 'bg-foreground/30', done: 'bg-ok', blocked: 'bg-destructive',
};

/** "12분째"; "방금" under a minute. */
const inStage = (ms: number) => (ms < 60_000 ? '방금' : `${span(ms)}째`);

function TaskCard({ t, now }: { t: BoardTask; now: number }) {
  const spans = stageSpans(t, now);
  const total = spans.reduce((a, s) => a + s.ms, 0) || 1;
  const eta = etaLine(t, now);
  const owner = t.owner || '맡은 사람 없음';
  return (
    <li data-task={t.title} className={cn('flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2.5', t.stuck && 'border-warn/60 bg-warn/5')}>
      <p className="line-clamp-2 text-sm leading-5 font-medium">{t.title}</p>
      {t.stuck && (
        <p className="flex items-start gap-1.5 text-xs">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warn" />
          <span className="line-clamp-2">{t.stuck.label}</span>
        </p>
      )}
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span className="min-w-0 truncate" title={owner}>{owner}</span>
        <span data-in-stage className="ml-auto shrink-0" title="이 단계에 있은 시간">{stageLabel(t.stage)} {inStage(now - t.stageAt)}</span>
      </div>
      {eta && <p data-eta className={cn('text-[11px] tabular-nums', eta.late ? 'text-destructive' : 'text-muted-foreground')}>예상 {eta.text}</p>}
      <div role="img" aria-label={`단계별 시간: ${spans.map(s => `${stageLabel(s.stage)} ${span(s.ms)}`).join(', ')}`} className="flex h-1.5 gap-px overflow-hidden rounded-full bg-muted">
        {spans.map((s, i) => <span key={i} data-bar={s.stage} style={{ flexGrow: s.ms / total }} className={cn('min-w-px basis-0', BAR[s.stage])} />)}
      </div>
    </li>
  );
}

function Board({ tasks }: { tasks: BoardTask[] }) {
  const now = useNow(20_000);
  const groups = groupByStage(tasks);
  return (
    <div data-board className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 pt-0">
      {STAGES.map(s => (
        <section key={s.id} aria-label={s.label} data-stage={s.id} className="flex w-56 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2">
          <header className="flex items-center gap-2 px-1 text-sm font-semibold">
            {s.label}
            <Badge variant="secondary" className="rounded-md px-1.5 tabular-nums">{groups[s.id].length}</Badge>
          </header>
          <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            {groups[s.id].map(t => <TaskCard key={t.id} t={t} now={now} />)}
          </ul>
          {groups[s.id].length === 0 && <p className="px-1 py-3 text-xs text-muted-foreground">비어 있어요</p>}
        </section>
      ))}
    </div>
  );
}

/** The 작업 보드 button for the 세션 board's `actions` slot, with the sheet it opens. */
export function TaskBoardButton() {
  const [open, setOpen] = useState(false);
  const tasks = useDispatch(s => s.tasks);
  const openCount = tasks.filter(t => t.stage !== 'done').length;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SquareKanban aria-hidden />
        작업 보드
        <span className="text-xs text-muted-foreground tabular-nums">{openCount}</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" showCloseButton className="w-[min(1280px,100vw)] bg-background sm:max-w-none">
          <SheetHeader>
            <SheetTitle>작업 보드</SheetTitle>
            <SheetDescription>관리자가 적어 둔 작업을 단계별로 보여줘요.</SheetDescription>
          </SheetHeader>
          {tasks.length === 0 && <p className="px-4 pb-2 text-sm text-muted-foreground">아직 작업이 없어요. 관리자가 작업을 적으면 여기에 나타나요.</p>}
          <Board tasks={tasks} />
        </SheetContent>
      </Sheet>
    </>
  );
}
