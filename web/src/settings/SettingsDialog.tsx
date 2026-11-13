// Settings dialog (E57): a native modal <dialog> with a section nav (일반, 모델 연결, 실행), like Linear's
// settings. showModal() gives the inert page, focus containment, Esc and focus return to the opener.
// Model connect/disconnect goes through the server's provider routes, which run the user's own CLI login;
// nothing here reads, shows or keeps a token, key or account name: status and percentages only.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type DispatchSettings, type ProviderInfo } from '../api';
import { Switch } from '../components/ui/switch';
import { cn } from '../lib/utils';
import type { ThemePref } from '../theme';
import { MODELS_CHANGED } from './context';
import {
  busyIds,
  fractionFrom,
  LOGIN_ENDED_NOTE,
  LOGIN_POLL_LIMIT_MS,
  loginsEndedUnconnected,
  loginUnlessClosed,
  oneAtATime,
  providerRows,
  SECTIONS,
  THEME_CHOICES,
  wholeFrom,
  type LimitsView,
  type ProviderId,
  type ProviderRow,
  type SettingsSection,
} from './model';

type Props = {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  themePref: ThemePref;
  onThemePref: (t: ThemePref) => void;
};

export function SettingsDialog({ section, onSection, onClose, themePref, onThemePref }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const panelId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // Logins still running when the dialog goes away are cancelled, so no CLI login is left behind unseen.
  // A login requested just before closing is only seen once its request returns; `closed` lets that cancel it.
  const logins = useRef<ProviderId[]>([]);
  const closed = useRef(false);
  useEffect(
    () => () => {
      closed.current = true;
      for (const id of logins.current) void api.providerCancel(id).catch(() => {});
      logins.current = [];
    },
    [],
  );
  const onLogins = useCallback((ids: ProviderId[]) => (logins.current = ids), []);
  const isClosed = useCallback(() => closed.current, []);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="settings-dialog"
      onClose={onClose}
      className="settings-dialog m-auto h-[min(560px,calc(100dvh-2rem))] w-[min(760px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-lg border bg-background p-0 text-foreground shadow-md max-md:h-[calc(100dvh-1rem)] max-md:w-[calc(100vw-1rem)]"
    >
      <div className="flex h-full flex-col md:flex-row">
        <nav aria-label="설정 메뉴" className="flex shrink-0 flex-col gap-1 border-b p-3 md:w-48 md:border-r md:border-b-0">
          <h2 id={titleId} className="px-2 pb-2 text-sm font-semibold">
            설정
          </h2>
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={s.id === section ? 'page' : undefined}
                  onClick={() => onSection(s.id)}
                  className={cn(
                    'relative flex h-8 w-full items-center rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground max-md:h-11 max-md:px-3',
                    'aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground',
                    // Not colour alone: a bar marks the current section (also kept in forced-colors mode).
                    'aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-1.5 aria-[current=page]:before:left-0 aria-[current=page]:before:border-l-2 aria-[current=page]:before:border-foreground',
                  )}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-labelledby={panelId} className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b px-4 py-2.5">
            <h3 id={panelId} className="text-sm font-semibold">
              {current.label}
            </h3>
            <form method="dialog" className="ml-auto">
              <button type="submit" className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground max-md:h-11">
                닫기
              </button>
            </form>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {section === 'general' && <GeneralPanel pref={themePref} onPref={onThemePref} />}
            {section === 'models' && <ModelsPanel onLogins={onLogins} isClosed={isClosed} />}
            {section === 'run' && <RunPanel />}
          </div>
        </section>
      </div>
    </dialog>
  );
}

function GeneralPanel({ pref, onPref }: { pref: ThemePref; onPref: (t: ThemePref) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">테마</legend>
      <div className="flex flex-wrap gap-2">
        {THEME_CHOICES.map((t) => (
          <label
            key={t.id}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:checked]:border-foreground has-[:checked]:font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring max-md:h-11"
          >
            <input type="radio" name="theme" value={t.id} checked={pref === t.id} onChange={() => onPref(t.id)} className="accent-foreground" />
            {t.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type Load<T> = { kind: 'loading' } | { kind: 'off'; message: string } | { kind: 'ok'; value: T };

function ModelsPanel({ onLogins, isClosed }: { onLogins: (ids: ProviderId[]) => void; isClosed: () => boolean }) {
  const [state, setState] = useState<Load<{ providers: Record<string, ProviderInfo>; limits: LimitsView }>>({ kind: 'loading' });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Logins seen running at the last load, to notice one that ended without connecting.
  const running = useRef<ProviderId[]>([]);
  const load = useCallback(async () => {
    try {
      const d = await api.dispatch();
      if (!d.enabled) return setState({ kind: 'off', message: d.message ?? '이 서버에선 모델 연결을 쓸 수 없어요.' });
      const [s, limits] = await Promise.all([api.dispatchState(), api.limits().catch(() => ({}))]);
      const providers = s.providers ?? {};
      if (loginsEndedUnconnected(running.current, providers).length) setError(LOGIN_ENDED_NOTE);
      running.current = busyIds(providers);
      onLogins(running.current);
      setState({ kind: 'ok', value: { providers, limits: limits as LimitsView } });
      window.dispatchEvent(new Event(MODELS_CHANGED));
    } catch {
      setState({ kind: 'off', message: '모델 상태를 불러오지 못했어요.' });
    }
  }, [onLogins]);
  useEffect(() => {
    void load();
  }, [load]);
  // While a CLI login runs, check back every 2 s until it ends, and give up after LOGIN_POLL_LIMIT_MS.
  const busy = state.kind === 'ok' && busyIds(state.value.providers).length > 0;
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > LOGIN_POLL_LIMIT_MS) {
        clearInterval(t);
        setError('로그인을 너무 오래 기다렸어요. 다시 확인을 눌러 주세요.');
        return;
      }
      void load();
    }, 2000);
    return () => clearInterval(t);
  }, [busy, load]);

  // One request at a time: a double click before the buttons turn disabled is dropped.
  const act = useMemo(
    () =>
      oneAtATime(async (row: ProviderRow) => {
        setPending(row.id);
        setError(null);
        try {
          if (row.action === 'connect') {
            await loginUnlessClosed(row.id, api.providerLogin, api.providerCancel, isClosed);
            if (isClosed()) return;
          } else if (row.action === 'disconnect') await api.providerLogout(row.id);
          else if (row.action === 'cancel') await api.providerCancel(row.id);
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : '요청이 실패했어요.');
        } finally {
          setPending(null);
        }
      }),
    [load, isClosed],
  );
  const recheck = useMemo(
    () =>
      oneAtATime(async () => {
        setPending('refresh');
        setError(null);
        try {
          await api.providerRefresh();
          await load();
        } catch {
          setError('다시 확인하지 못했어요.');
        } finally {
          setPending(null);
        }
      }),
    [load],
  );

  if (state.kind === 'loading') return <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>;
  if (state.kind === 'off') return <p className="text-sm text-muted-foreground">{state.message}</p>;
  const rows = providerRows(state.value.providers, state.value.limits);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">이 컴퓨터에 설치된 CLI로 로그인해요. 로그인 정보는 각 CLI가 보관하고, 여기에는 남지 않아요.</p>
      <ul aria-label="모델" className="flex flex-col divide-y rounded-md border">
        {rows.map((r) => (
          <li key={r.id} data-provider={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
            <i aria-hidden className={cn('size-2 shrink-0 rounded-full', r.tone === 'ok' ? 'bg-ok' : r.tone === 'warn' ? 'bg-warn' : 'bg-muted-foreground')} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{r.name}</span>
              <span className="text-xs text-muted-foreground" data-testid="provider-status">
                {r.status}
                {r.windows.map((w) => (
                  <span key={w.label} className="tabular-nums">
                    {' · '}
                    {w.label} {w.pct}%
                  </span>
                ))}
              </span>
              {r.loginUrl && (
                <a href={r.loginUrl} target="_blank" rel="noreferrer noopener" className="text-xs underline">
                  로그인 페이지 열기
                </a>
              )}
              {r.error && <span className="text-xs text-destructive">{r.error}</span>}
            </div>
            {r.action && (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void act(r)}
                aria-label={`${r.name} ${actionLabel(r)}`}
                className={cn(
                  'h-8 shrink-0 rounded-md px-3 text-sm disabled:opacity-50 max-md:h-11',
                  r.action === 'connect' ? 'bg-primary font-medium text-primary-foreground' : 'border hover:bg-accent',
                )}
              >
                {actionLabel(r)}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending !== null} onClick={() => void recheck()} className="h-8 rounded-md border px-3 text-sm hover:bg-accent disabled:opacity-50 max-md:h-11">
          다시 확인
        </button>
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      </div>
    </div>
  );
}

const actionLabel = (r: ProviderRow) => (r.action === 'connect' ? '연결' : r.action === 'disconnect' ? '연결 끊기' : '취소');

function RunPanel() {
  const [settings, setSettings] = useState<Load<DispatchSettings>>({ kind: 'loading' });
  const [pr, setPr] = useState<boolean | null | 'unsupported'>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.dispatch();
        if (!d.enabled) return alive && setSettings({ kind: 'off', message: d.message ?? '이 서버에선 실행 설정을 쓸 수 없어요.' });
        const s = await api.dispatchState();
        if (alive) setSettings(s.settings ? { kind: 'ok', value: s.settings } : { kind: 'off', message: '실행 설정을 불러오지 못했어요.' });
      } catch {
        if (alive) setSettings({ kind: 'off', message: '실행 설정을 불러오지 못했어요.' });
      }
    })();
    api.prTracking().then(
      (r) => alive && setPr(r.on),
      () => alive && setPr('unsupported'),
    );
    return () => {
      alive = false;
    };
  }, []);

  const save = async (patch: Parameters<typeof api.saveDispatchSettings>[0]) => {
    try {
      const next = await api.saveDispatchSettings(patch);
      setSettings({ kind: 'ok', value: next });
      setNote('저장했어요.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : '저장하지 못했어요.');
    }
  };
  const togglePr = async (on: boolean) => {
    try {
      setPr((await api.setPrTracking(on)).on);
      setNote('저장했어요.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : '저장하지 못했어요.');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {settings.kind === 'loading' && <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>}
      {settings.kind === 'off' && <p className="text-sm text-muted-foreground">{settings.message}</p>}
      {settings.kind === 'ok' && (
        <>
          <Group title="사용량 한도" hint="Claude 사용량이 이만큼 차면 새 작업을 멈춰요.">
            <NumberField label="5시간 한도 (%)" value={Math.round(settings.value.guard.five * 100)} parse={fractionFrom} invalid="1~100 사이 숫자를 넣어 주세요" onSave={(five) => void save({ guard: { five } })} />
            <NumberField label="주간 한도 (%)" value={Math.round(settings.value.guard.seven * 100)} parse={fractionFrom} invalid="1~100 사이 숫자를 넣어 주세요" onSave={(seven) => void save({ guard: { seven } })} />
          </Group>
          <Group title="세션 길이" hint="세션이 너무 길어지면 새 세션으로 넘겨요.">
            <NumberField
              label="토큰 한도 (백만)"
              value={settings.value.team.handoffMTokens ?? 15}
              parse={(v) => wholeFrom(v, 2, 500)}
              invalid="2~500 사이 숫자를 넣어 주세요"
              onSave={(handoffMTokens) => void save({ team: { handoffMTokens } })}
            />
            <NumberField
              label="컨텍스트 한도 (%)"
              value={settings.value.team.ctxHandoff ?? 70}
              parse={(v) => wholeFrom(v, 30, 95)}
              invalid="30~95 사이 숫자를 넣어 주세요"
              onSave={(ctxHandoff) => void save({ team: { ctxHandoff } })}
            />
          </Group>
        </>
      )}
      <Group title="PR·CI 추적" hint="이 워크스페이스에서 gh로 PR과 CI 상태를 확인해요.">
        <label className="flex min-h-8 items-center gap-3 text-sm max-md:min-h-11">
          <Switch checked={pr === true} disabled={pr === null || pr === 'unsupported'} onCheckedChange={(on) => void togglePr(on)} />
          {pr === 'unsupported' ? '이 서버에선 바꿀 수 없어요' : pr ? '켜짐' : '꺼짐'}
        </label>
      </Group>
      <p role="status" className="text-xs text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{title}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-4">{children}</div>
    </fieldset>
  );
}

/** A number saved on blur or Enter; an out-of-range value shows why and is not sent. */
function NumberField<T>({ label, value, parse, invalid, onSave }: { label: string; value: number; parse: (v: string) => T | null; invalid: string; onSave: (v: T) => void }) {
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState(false);
  const id = useId();
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    if (text === String(value)) return setBad(false);
    const v = parse(text);
    setBad(v === null);
    if (v !== null) onSave(v);
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={text}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}-err` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className="h-8 w-28 rounded-md border bg-transparent px-2 text-sm tabular-nums aria-[invalid=true]:border-destructive max-md:h-11"
      />
      {bad && (
        <span id={`${id}-err`} className="text-xs text-destructive">
          {invalid}
        </span>
      )}
    </div>
  );
}
