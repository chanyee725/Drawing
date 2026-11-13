// `실행` view (E22, docs/design/dispatch-integration/3-ux-flow.md §4): steps, sessions and limits side by side, the
// run's history under them. Columns follow the view's own width (container query), so it stacks in a narrow pane.
// Session sheets (transcripts, in memory only) load lazily on click.
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Meter, StatusBadge } from '../dispatch/parts';
import { useDispatch } from '../dispatch/store.ts';
import { until } from '../dispatch/lib/format.ts';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { fmtClock, fmtCost, historyLines, runListText } from './runModel.ts';
import { useRunModel } from './useRunModel.ts';

const SessionSheet = lazy(() => import('../dispatch/SessionSheet').then((m) => ({ default: m.SessionSheet })));

const VIEW_TONE: Record<string, string> = { active: 'text-ok', review: 'text-ok', done: 'text-ok', blocked: 'text-destructive', pending: 'text-muted-foreground' };

function Column({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('min-w-0 border-b p-4 @3xl:border-r @3xl:border-b-0 @3xl:last:border-r-0', className)}>
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function Limits({ now }: { now: number }) {
  const l = useDispatch((s) => s.limits);
  const online = useDispatch((s) => s.ready && !s.unavailable);
  const guard = useDispatch((s) => s.settings.guard);
  if (!online) return <p className="text-sm text-muted-foreground">실행 중일 때 한도를 보여 줘요.</p>;
  const rows: [string, number | null | undefined, number | null | undefined][] = [
    ['Claude 5시간', l.five, l.fiveReset],
    ['주간', l.seven, l.sevenReset],
    ['Fable 주간', l.fable, l.fableReset],
  ];
  return (
    <ul className="space-y-3 text-sm">
      {rows.map(([name, v, reset]) => (
        <li key={name}>
          <div className="flex items-baseline justify-between gap-2">
            <span>{name}</span>
            <span className="tabular-nums">{v == null ? '—' : `${Math.round(v * 100)}%`}</span>
          </div>
          {v != null && <Meter value={v} label={`${name} 사용량`} className="mt-1" />}
          {v != null && reset ? <p className="mt-0.5 text-xs text-muted-foreground">{until(reset, now)} 뒤 초기화돼요</p> : null}
        </li>
      ))}
      <li className="text-xs text-muted-foreground">
        한도 가까우면 막기 · {guard.enabled ? `${Math.round(guard.five * 100)}% 켜짐` : '꺼짐'}
      </li>
    </ul>
  );
}

export default function RunView({ code }: { code: string | undefined }) {
  const m = useRunModel(code);
  const [sheet, setSheet] = useState<string | null>(null);
  if (!m.record) {
    return <p className="p-6 text-sm text-muted-foreground">아직 실행한 적이 없어요. 계획을 시작하면 여기에서 진행을 볼 수 있어요.</p>;
  }
  const history = historyLines(m.record, m.labels);
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto" data-run-view>
      <div className="grid grid-cols-1 border-b @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(12rem,0.8fr)]">
        <Column title="단계">
          <ol className="space-y-2 text-sm">
            {m.rows.map((r) => (
              <li key={r.id}>
                <div className="flex items-baseline gap-2">
                  <span aria-hidden className={r.paused === 'limit' ? 'text-warn' : r.paused ? 'text-muted-foreground' : VIEW_TONE[r.view]}>
                    {r.glyph}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.n} {r.title}
                    {r.paused !== 'limit' && <span className="sr-only"> · {r.label}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{r.time}</span>
                </div>
                {(r.agents.length > 0 || r.waiting) && (
                  <p className="pl-5 text-xs text-muted-foreground">
                    {r.agents.map((a) => a.name).join(', ')}
                    {r.waiting ? ' · 사람 기다림' : ''}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Column>
        <Column title="세션">
          {m.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 세션이 없어요.</p>
          ) : (
            <ul className="space-y-1">
              {m.sessions.map((s) => {
                const body = (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {s.roleName}
                        {s.model ? ` · ${s.model}` : ''}
                      </span>
                      {s.state && <StatusBadge state={s.state} />}
                    </div>
                    {s.branch && <p className="truncate text-xs text-muted-foreground">{s.branch}{s.pr ? ` · PR #${s.pr}` : ''}</p>}
                    {s.activity && <p className="truncate text-xs text-muted-foreground">지금: {s.activity}</p>}
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {s.cost != null ? fmtCost(s.cost) : '—'} · {fmtTok(s.tokens)} 토큰{s.ctxPct != null ? ` · 맥락 ${s.ctxPct}%` : ''}
                    </p>
                  </>
                );
                return (
                  <li key={s.sid}>
                    {s.live ? (
                      <button type="button" onClick={() => setSheet(s.sid)} className={cn('w-full rounded-md p-2 text-left text-sm hover:bg-accent', FOCUS_RING)} aria-label={`${s.name} 세션 열기`}>
                        {body}
                      </button>
                    ) : (
                      <div className="p-2 text-sm">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Column>
        <Column title="한도">
          <Limits now={m.now} />
        </Column>
      </div>
      <section aria-label="기록" className="p-4">
        <h2 className="mb-2 text-xs font-medium text-muted-foreground">기록 (최근 순)</h2>
        <ol className="space-y-1 text-sm">
          {history.map((h, i) => (
            <li key={i} className="flex gap-3">
              <time className="shrink-0 text-muted-foreground tabular-nums" dateTime={new Date(h.at).toISOString()}>
                {fmtClock(h.at)}
              </time>
              <span className="min-w-0">{h.text}</span>
            </li>
          ))}
        </ol>
        {m.data.runs.length > 1 && (
          <>
            <h2 className="mt-4 mb-2 text-xs font-medium text-muted-foreground">이 파일의 실행</h2>
            <ul className="space-y-1 text-sm">
              {m.data.runs.map((r) => (
                <li key={r.id} aria-current={r.id === m.record?.id ? 'true' : undefined} className="text-muted-foreground aria-[current=true]:text-foreground">
                  {runListText(r, m.now)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {sheet && (
        <Suspense fallback={null}>
          <SessionSheet id={sheet} onClose={() => setSheet(null)} />
        </Suspense>
      )}
    </div>
  );
}
