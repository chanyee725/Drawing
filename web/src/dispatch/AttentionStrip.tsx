// "확인 필요" strip at the top of 세션: sessions waiting on a person, stuck or failed, late tasks, failed merge
// checks and usage limits from 75 %. Each row says why, for how long, and opens what to look at.
import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronRight, CircleCheck, Clock, Gauge, GitMerge, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { attentionItems, elapsed, type AttentionItem, type AttentionKind } from '../../../shared/dispatch/attention.ts';
import { TONE_TEXT, fmtK, fmtUsd, isOpen, stateOf, totalTok, until } from './lib/format.ts';
import { StatusBadge } from './parts';
import { useDispatch } from './store';
import type { Session } from './types';

/** Rows shown before "n건 더 보기". */
const SHOWN = 5;

export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// Non-session rows get their own shape + label, so they also read without colour.
const KIND: Record<Exclude<AttentionKind, 'session'>, { Icon: LucideIcon; label: string }> = {
  late: { Icon: Clock, label: '지연' },
  mismatch: { Icon: TriangleAlert, label: '단계 불일치' },
  merge: { Icon: GitMerge, label: '병합 안 됨' },
  limit: { Icon: Gauge, label: '한도' },
};

function Mark({ item }: { item: AttentionItem }) {
  if (item.kind === 'session') return <StatusBadge state={item.state ?? 'stuck'} />;
  const { Icon, label } = KIND[item.kind];
  return (
    <Badge variant="outline" className="gap-1 pl-1.5 text-foreground/80">
      <Icon aria-hidden className={cn('size-3.5!', TONE_TEXT[item.level])} strokeWidth={2.5} />
      {label}
    </Badge>
  );
}

/** "8분째", "14분 지연", "2시간 뒤 초기화". */
function howLong(item: AttentionItem, now: number) {
  if (item.kind === 'limit') return item.resetAt ? `${until(item.resetAt, now)} 뒤 초기화` : null;
  const e = elapsed(item.since, now);
  if (e == null) return null;
  if (item.kind === 'late') return e ? `${e} 지연` : '막 지연됐어요';
  return e ? `${e}째` : '방금';
}

const ACTION: Record<AttentionKind, string> = { session: '열기', late: '세션 열기', mismatch: '세션 열기', merge: '관리자 열기', limit: '사용량 보기' };

function Row({ item, now, onClick }: { item: AttentionItem; now: number; onClick?: () => void }) {
  const time = howLong(item, now);
  const Box = onClick ? 'button' : 'div';
  return (
    <li>
      <Box
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={cn(
          'group/row grid w-full grid-cols-[7rem_minmax(0,10rem)_minmax(0,1fr)_7rem_5.5rem] items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-[13px]',
          'max-sm:grid-cols-[7rem_minmax(0,1fr)_auto] max-sm:[&>[data-reason]]:col-span-3 max-sm:[&>[data-go]]:hidden',
          onClick && 'cursor-pointer transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
        )}
      >
        <span className="flex min-w-0"><Mark item={item} /></span>
        <span className="min-w-0 truncate font-medium" title={item.who}>{item.who}</span>
        <span data-reason className="min-w-0 truncate text-muted-foreground max-sm:order-last" title={item.reason}>{item.reason}</span>
        <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">{time}</span>
        <span data-go className={cn('inline-flex shrink-0 items-center justify-end gap-0.5 text-xs text-muted-foreground', onClick ? 'group-hover/row:text-foreground' : 'invisible')}>
          {ACTION[item.kind]}
          <ChevronRight aria-hidden className="size-3.5" />
        </span>
      </Box>
    </li>
  );
}

/** `onUsage` opens the limits screen (PR 2); without it limit rows are not clickable. */
export function AttentionStrip({ onOpen, onUsage }: { onOpen: (id: string) => void; onUsage?: () => void }) {
  const sessions = useDispatch(s => s.sessions);
  const tasks = useDispatch(s => s.tasks);
  const limits = useDispatch(s => s.limits);
  const guard = useDispatch(s => s.settings.guard);
  const now = useNow();
  const [all, setAll] = useState(false);
  const listId = useId();
  const items = useMemo(() => attentionItems({ sessions, tasks, limits, guard, now, stateOf }), [sessions, tasks, limits, guard, now]);
  const go = (i: AttentionItem) =>
    i.kind === 'limit' ? onUsage : i.sessionId && sessions.some(s => s.id === i.sessionId) ? () => onOpen(i.sessionId!) : undefined;

  // One live region that stays mounted, so screen readers hear rows come and go; the ticking clock stays quiet.
  return (
    <div aria-live="polite" aria-relevant="additions">
      {items.length === 0 ? (
        <div className="flex h-8 items-center gap-2 rounded-md border bg-card px-3 text-xs text-muted-foreground">
          <CircleCheck aria-hidden className="size-3.5 shrink-0 text-ok" />
          지금 볼 것 없어요
        </div>
      ) : (
        <section aria-label="확인 필요" className="min-w-0 overflow-hidden rounded-md border bg-card">
          <header className="flex h-8 items-center gap-2 border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
            <h2 className="min-w-0 flex-1 truncate font-medium">확인 필요</h2>
            <span className="shrink-0 tabular-nums">
              {items.some(i => i.level === 'bad') && <span className="text-destructive">급함 {items.filter(i => i.level === 'bad').length} · </span>}
              <span className="text-foreground">{items.length}건</span>
            </span>
          </header>
          <ul id={listId} className="divide-y">
            {(all ? items : items.slice(0, SHOWN)).map(i => <Row key={i.key} item={i} now={now} onClick={go(i)} />)}
          </ul>
          {items.length > SHOWN && (
            <Button variant="ghost" size="sm" className="w-full justify-start rounded-none border-t text-xs text-muted-foreground"
              onClick={() => setAll(v => !v)} aria-expanded={all} aria-controls={listId}>
              {all ? '접기' : `${items.length - SHOWN}건 더 보기`}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

const sumCost = (ss: Session[]) => (ss.some(s => s.cost != null) ? ss.reduce((a, s) => a + (s.cost ?? 0), 0) : null);

/** One small summary line: open sessions, working, waiting, cost, tokens. */
export function SummaryLine() {
  const sessions = useDispatch(s => s.sessions);
  const c: Record<string, number> = {};
  for (const s of sessions) { const st = stateOf(s); c[st] = (c[st] ?? 0) + 1; }
  const items: [string, string | number][] = [
    ['열린 세션', `${sessions.filter(isOpen).length}/${sessions.length}`],
    ['작업 중', c.working ?? 0],
    ['사람 기다림', c.waiting ?? 0],
    ['비용 (API 환산)', fmtUsd(sumCost(sessions) ?? 0)],
    ['토큰', fmtK(sessions.reduce((a, s) => a + totalTok(s.usage), 0))],
  ];
  return (
    <p aria-label="요약" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([k, v]) => <span key={k} className="whitespace-nowrap">{k} <span className="font-medium text-foreground tabular-nums">{v}</span></span>)}
    </p>
  );
}
