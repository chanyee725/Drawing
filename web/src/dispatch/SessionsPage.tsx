// 세션 board: the needs-attention strip, a state filter and session cards grouped by role, most urgent first.
import { useMemo, useState, type ReactNode } from 'react';
import { GitBranch, TriangleAlert } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../lib/utils';
import { elapsed } from '../../../shared/dispatch/attention.ts';
import { AttentionStrip, SummaryLine, useNow } from './AttentionStrip';
import { fmtK, fmtUsd, isOpen, pct, stateOf, totalTok } from './lib/format.ts';
import { byUrgency, stateStart } from './lib/order.ts';
import { nowLine } from './lib/turn.ts';
import { Meter, ModelTag, StatusBadge } from './parts';
import { useDispatch } from './store';
import type { Session, SessionState } from './types';

const FILTERS: { id: 'all' | SessionState; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'working', label: '작업 중' },
  { id: 'waiting', label: '사람 기다림' },
  { id: 'stuck', label: '멈춤' },
  { id: 'failed', label: '실패' },
  { id: 'resting', label: '쉼' },
  { id: 'done', label: '완료' },
];

const sumCost = (ss: Session[]) => (ss.some(s => s.cost != null) ? ss.reduce((a, s) => a + (s.cost ?? 0), 0) : null);

/** "지금 단위 테스트 · 2분째": the activity category only (see nowLine). */
function NowLine({ s, now }: { s: Session; now: number }) {
  const a = nowLine(s);
  if (!a) return <p className="text-[13px] leading-5 text-muted-foreground">지금 생각 중</p>;
  const e = elapsed(a.since, now);
  return (
    <p data-now className="truncate text-[13px] leading-5 text-muted-foreground">
      지금 <span className="text-foreground">{a.label}</span>{e ? ` · ${e}째` : ''}
    </p>
  );
}

function SessionCard({ s, parent, now, onOpen }: { s: Session; parent?: Session; now: number; onOpen: () => void }) {
  const ctx = s.ctxWindow ? s.ctx / s.ctxWindow : 0;
  const state = stateOf(s);
  const live = s.status === 'running' || s.status === 'starting';
  const since = elapsed(stateStart(s, state), now);
  const flag = state === 'waiting' || state === 'stuck' || !!s.stall;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={parent ? `${parent.name}이(가) 만든 세션` : undefined}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        flag && 'border-warn/60 bg-warn/5',
        state === 'failed' && 'border-destructive/50 bg-destructive/5',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-semibold">{s.name}</span>
        <ModelTag provider={s.provider} label={`${s.modelLabel}${s.effort ? ` ${s.effort}` : ''}`} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground tabular-nums" title="이 상태가 된 뒤 지난 시간">{since ? `${since}째` : '방금'}</span>
          <StatusBadge state={state} />
        </span>
      </div>

      {s.stall && (
        <p className="flex items-start gap-1.5 text-xs">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warn" />
          <span className="line-clamp-1">{s.stall.reason}</span>
        </p>
      )}

      {live ? <NowLine s={s} now={now} />
        : s.attention ? <p className={cn('line-clamp-1 text-[13px] leading-5', s.attention.level === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{s.attention.reason}</p>
        : null}

      <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span className="shrink-0">{s.roleName}</span>
        {s.branch && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <GitBranch aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{s.branch}</span>
          </span>
        )}
        <span className="ml-auto shrink-0">{fmtUsd(s.cost)}</span>
        <span className="shrink-0">{fmtK(totalTok(s.usage))}</span>
        <span className="flex shrink-0 items-center gap-1" title={`컨텍스트 ${pct(ctx)}`}>
          <Meter value={ctx} label="컨텍스트" className="h-1 w-10" />
          {pct(ctx)}
        </span>
      </div>
    </button>
  );
}

/**
 * The 세션 board. `actions` sits right of the filter (PR 2 puts the task board button there);
 * `onUsage` opens the limits screen from a limit row.
 */
export function SessionsPage({ onOpen, onUsage, actions }: { onOpen: (id: string) => void; onUsage?: () => void; actions?: ReactNode }) {
  const sessions = useDispatch(s => s.sessions);
  const roles = useDispatch(s => s.roles);
  const [filter, setFilter] = useState<'all' | SessionState>('all');
  const [showDone, setShowDone] = useState(false);
  const now = useNow(20_000);

  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sessions.length };
    for (const s of sessions) { const st = stateOf(s); c[st] = (c[st] ?? 0) + 1; }
    return c;
  }, [sessions]);
  // Done sessions stay out of 전체 until asked for; failed ones are not done.
  const hideDone = filter === 'all' && !showDone;
  const list = useMemo(
    () => byUrgency(sessions.filter(s => {
      const st = stateOf(s);
      return filter === 'all' ? !(hideDone && st === 'done') : st === filter;
    }), stateOf),
    [sessions, filter, hideDone],
  );
  // Roles the server knows, then any role a session has that is not in the list.
  const groups = useMemo(() => {
    const known = roles.map(r => ({ id: r.id, name: r.name }));
    for (const s of list) if (!known.some(r => r.id === s.role)) known.push({ id: s.role, name: s.roleName || s.role });
    return known;
  }, [roles, list]);
  const doneCount = counts.done ?? 0;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-6 max-md:p-4">
      <div className="flex flex-col gap-2">
        <AttentionStrip onOpen={onOpen} onUsage={onUsage} />
        <SummaryLine />
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
          <p className="font-medium">아직 세션이 없어요</p>
          <p className="max-w-md text-sm text-muted-foreground">파이프라인을 시작하거나 관리자 세션이 팀을 만들면 여기에 보여요.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <Tabs value={filter} onValueChange={v => setFilter(v as typeof filter)} className="max-w-full min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
              <TabsList aria-label="상태로 거르기">
                {FILTERS.map(f => (
                  <TabsTrigger key={f.id} value={f.id} className="gap-1.5">
                    {f.label}
                    <span className="text-xs text-muted-foreground tabular-nums">{counts[f.id] ?? 0}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>

          {list.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">{hideDone ? '열려 있는 세션이 없어요.' : '이 상태의 세션이 없어요.'}</p>
          )}

          <div className="flex flex-col gap-8">
            {groups.map(role => {
              const ss = list.filter(s => s.role === role.id);
              if (!ss.length) return null;
              const cost = sumCost(ss);
              return (
                <section key={role.id} aria-label={role.name}>
                  <header className="mb-3 flex items-baseline gap-3">
                    <h2 className="text-[15px] font-semibold">{role.name}</h2>
                    <span className="text-sm text-muted-foreground tabular-nums">{ss.filter(isOpen).length}개 열림 / {ss.length}개</span>
                    {cost != null && <span className="text-sm text-muted-foreground tabular-nums">{fmtUsd(cost)}</span>}
                  </header>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
                    {ss.map(s => <SessionCard key={s.id} s={s} parent={s.parent ? byId.get(s.parent) : undefined} now={now} onOpen={() => onOpen(s.id)} />)}
                  </div>
                </section>
              );
            })}
          </div>

          {filter === 'all' && doneCount > 0 && (
            <Button variant="ghost" size="sm" className="self-start text-muted-foreground tabular-nums" onClick={() => setShowDone(v => !v)}>
              {showDone ? '완료 숨기기' : `완료 ${doneCount}개 보기`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
