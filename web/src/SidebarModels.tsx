// Sidebar model rows (design doc 6 §2.1, issue E51): one row per model (Claude 42% · Codex 81% · Gemini) with a
// status dot and its text, aligned with the nav rows. A row opens the settings dialog on 모델 연결 (E57), the one
// place that connects and disconnects models. Nothing here reads credentials or logs anything.
import { useCallback, useEffect, useState } from 'react';
import { api, type DispatchStatus, type ProviderLimits, type ProviderState } from './api';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from './components/ui/sidebar';
import { cn } from './lib/utils';
import { MODELS_CHANGED, useOpenSettings } from './settings/context';
import { modelStatus, percent, type ModelLine, type ModelTone } from './projectNav';

const PROVIDERS = [
  ['claude', 'Claude'],
  ['openai', 'Codex'],
  ['gemini', 'Gemini'],
] as const;

const DOT: Record<ModelTone, string> = { ok: 'bg-ok', warn: 'bg-warn', off: 'bg-muted-foreground' };

/** Connection and 5-hour usage per provider. Polls slowly; reloads when the settings dialog closes. */
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
    window.addEventListener(MODELS_CHANGED, reload);
    return () => {
      clearInterval(t);
      window.removeEventListener(MODELS_CHANGED, reload);
    };
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
  return { status, lines };
}

export function SidebarModels() {
  const { status, lines } = useModels();
  const openSettings = useOpenSettings();
  const { setOpenMobile } = useSidebar();
  if (!status) return null;
  const on = status.enabled;
  return (
    <SidebarMenu aria-label="모델 연결">
        {lines.map((m) => {
          const s = modelStatus(m, on);
          return (
            <SidebarMenuItem key={m.id}>
              <SidebarMenuButton aria-label={`${m.name} ${s.long}, 연결 설정 열기`} title={`${m.name}: ${s.long}`} onClick={() => {
                  setOpenMobile(false);
                  openSettings('models');
                }}>
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
  );
}
