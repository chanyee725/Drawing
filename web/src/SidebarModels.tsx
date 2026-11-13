// Sidebar model rows (design doc 6 §2.1, issue E51): one row per model (Claude 42% · Codex 81% · Gemini) with a
// status dot and its text, aligned with the nav rows. A row opens the connect dialog for that model.
// The dialog uses the server's provider routes: connect reuses the CLI's own login or starts its browser login;
// disconnect only turns the model off in Drawing. Nothing here reads credentials or logs anything.
import { useCallback, useEffect, useState } from 'react';
import { api, type DispatchStatus, type ProviderLimits, type ProviderState } from './api';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from './components/ui/sidebar';
import { cn } from './lib/utils';
import { modelStatus, percent, type ModelLine, type ModelTone } from './projectNav';

const PROVIDERS = [
  ['claude', 'Claude'],
  ['openai', 'Codex'],
  ['gemini', 'Gemini'],
] as const;

const DOT: Record<ModelTone, string> = { ok: 'bg-ok', warn: 'bg-warn', off: 'bg-muted-foreground' };

/** Connection and 5-hour usage per provider. Polls slowly; `reload` after a connect or disconnect. */
function useModels() {
  const [status, setStatus] = useState<DispatchStatus | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderState>>({});
  const [limits, setLimits] = useState<ProviderLimits>({});
  const reload = useCallback(async () => {
    try {
      const s = await api.dispatch();
      setStatus(s);
      if (!s.enabled) return;
      const [pv, lim] = await Promise.all([api.providers(), api.limits().catch(() => ({}))]);
      setProviders(pv);
      setLimits(lim);
    } catch {
      setStatus({ enabled: false });
    }
  }, []);
  useEffect(() => {
    void reload();
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);
  const lines: ModelLine[] = PROVIDERS.map(([id, name]) => {
    const pv = providers[id];
    const connected = !!pv?.connected;
    const windows = id === 'claude' ? limits.claude?.windows : id === 'openai' ? limits.openai?.windows : undefined;
    return {
      id,
      name,
      installed: pv?.installed ?? null,
      connected,
      pct: connected ? percent(windows?.[0]?.used) : null,
      reached: id === 'gemini' && connected && !!limits.gemini?.reached,
    };
  });
  return { status, lines, providers, reload };
}

export function SidebarModels() {
  const { status, lines, providers, reload } = useModels();
  const [openId, setOpenId] = useState<string | null>(null);
  if (!status) return null;
  const on = status.enabled;
  const line = lines.find((m) => m.id === openId) ?? null;
  return (
    <>
      <SidebarMenu aria-label="모델 연결">
        {lines.map((m) => {
          const s = modelStatus(m, on);
          return (
            <SidebarMenuItem key={m.id}>
              <SidebarMenuButton aria-label={`${m.name} ${s.long}, 연결 설정 열기`} title={`${m.name}: ${s.long}`} onClick={() => setOpenId(m.id)}>
                {/* Same 17px slot as the nav icons, so names line up with 모든 파일, 최근, 보관함. */}
                <span aria-hidden className="grid size-[17px] shrink-0 place-items-center">
                  <i className={cn('size-2 rounded-full', DOT[s.tone])} />
                </span>
                <span className="truncate">{m.name}</span>
                <span className={cn('ml-auto shrink-0 text-xs tabular-nums', s.tone === 'warn' ? 'text-foreground' : 'text-muted-foreground')}>{s.text}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
      <ConnectDialog line={line} enabled={on} reason={status.message} state={openId ? providers[openId] : undefined} reload={reload} onClose={() => setOpenId(null)} />
    </>
  );
}

type DialogProps = {
  line: ModelLine | null;
  enabled: boolean;
  reason?: string;
  state?: ProviderState;
  reload: () => Promise<void>;
  onClose: () => void;
};

function ConnectDialog({ line, enabled, reason, state, reload, onClose }: DialogProps) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = line?.id;
  // Reset when another model opens; stop waiting once the browser login finishes.
  useEffect(() => {
    setWaiting(false);
    setError(null);
  }, [id]);
  useEffect(() => {
    if (!waiting) return;
    if (line?.connected) setWaiting(false);
    else if (state && !state.busy && state.error) {
      setWaiting(false);
      setError(state.error);
    }
  }, [waiting, line?.connected, state]);
  // While a browser login runs, check every 2 seconds.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [waiting, reload]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '잘 안 됐어요. 다시 해 주세요.');
    }
    await reload();
  };
  const connect = () =>
    act(async () => {
      const r = await api.providerLogin(id!);
      if (!r.connected) setWaiting(true);
    });
  const cancel = () => act(async () => {
    setWaiting(false);
    await api.providerCancel(id!);
  });
  const disconnect = () => act(() => api.providerLogout(id!));

  const s = line ? modelStatus(line, enabled) : null;
  const missing = line?.installed === false;
  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(400px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{line?.name} 연결</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 px-4 py-3 text-sm">
          {s && (
            <p className="flex items-center gap-2">
              <i aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[s.tone])} />
              {s.long}
            </p>
          )}
          <DialogDescription>
            {!enabled
              ? reason || '이 서버에서는 모델 연결이 꺼져 있어요.'
              : missing
                ? '이 컴퓨터에서 CLI를 찾지 못했어요. 터미널에서 설치한 뒤 다시 열어 주세요.'
                : line?.connected
                  ? '연결을 끊어도 CLI 로그인은 그대로 남아요.'
                  : waiting
                    ? '브라우저에서 로그인을 마쳐 주세요. 끝나면 여기서 바로 바뀌어요.'
                    : '이 컴퓨터의 CLI 로그인을 써요. 로그인이 없으면 브라우저가 열려요.'}
          </DialogDescription>
          {waiting && state?.url && (
            <a className="truncate text-xs underline underline-offset-2" href={state.url} target="_blank" rel="noreferrer">
              로그인 페이지 열기
            </a>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="max-md:h-11" onClick={onClose}>
            닫기
          </Button>
          {enabled && line && !missing && (
            line.connected ? (
              <Button variant="outline" size="sm" className="max-md:h-11" onClick={disconnect}>
                연결 끊기
              </Button>
            ) : waiting ? (
              <Button variant="outline" size="sm" className="max-md:h-11" onClick={cancel}>
                로그인 취소
              </Button>
            ) : (
              <Button size="sm" className="max-md:h-11" autoFocus onClick={connect}>
                연결하기
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
