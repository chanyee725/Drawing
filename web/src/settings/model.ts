// Settings dialog model (E57): sections, provider rows and the run-guard fields, kept free of React so
// node --test can check them. Status and percentages only: no account, email or token ever reaches here.
import { percent } from '../projectNav.ts';
import type { ThemePref } from '../theme';

export const SECTIONS = [
  { id: 'general', label: '일반' },
  { id: 'models', label: '모델 연결' },
  { id: 'run', label: '실행' },
] as const;
export type SettingsSection = (typeof SECTIONS)[number]['id'];

export const isSection = (v: unknown): v is SettingsSection => SECTIONS.some((s) => s.id === v);

export const THEME_CHOICES: { id: ThemePref; label: string }[] = [
  { id: 'system', label: '시스템' },
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
];

export const PROVIDER_IDS = ['claude', 'openai', 'gemini'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
const NAMES: Record<ProviderId, string> = { claude: 'Claude', openai: 'Codex', gemini: 'Gemini' };

/** What /api/state reports per provider; only the fields this dialog reads. */
export type { ProviderInfo } from '../api';
import type { ProviderInfo } from '../api';
export type LimitsView = {
  claude?: { windows: { label: string; used: number | null }[] } | null;
  openai?: { windows: { label: string; used: number | null }[] } | null;
  gemini?: { reached: boolean } | null;
};

export type ProviderAction = 'connect' | 'disconnect' | 'cancel' | null;
export type ProviderRow = {
  id: ProviderId;
  name: string;
  /** Dot colour: ok, warn (near or at a limit), idle (not connected). */
  tone: 'ok' | 'warn' | 'idle';
  status: string;
  action: ProviderAction;
  /** Usage windows, e.g. 5시간 42%; empty when not connected or unknown. */
  windows: { label: string; pct: number }[];
  error: string | null;
  /** The CLI's own sign-in page while a login runs (https only). */
  loginUrl: string | null;
};

export const WARN_AT = 75;

export function providerRows(providers: Partial<Record<string, ProviderInfo>>, limits: LimitsView): ProviderRow[] {
  return PROVIDER_IDS.map((id) => {
    const p = providers[id] ?? {};
    const connected = !!p.connected;
    const busy = !!p.busy;
    const missing = p.installed === false;
    const raw = id === 'gemini' ? [] : (limits[id]?.windows ?? []);
    const windows = connected ? raw.flatMap((w) => (percent(w.used) == null ? [] : [{ label: w.label, pct: percent(w.used)! }])) : [];
    const reached = connected && ((id === 'gemini' && !!limits.gemini?.reached) || windows.some((w) => w.pct >= 100));
    const status = busy ? '연결하는 중이에요' : missing ? 'CLI가 설치되지 않았어요' : !connected ? '연결 안 됨' : reached ? '한도에 닿았어요' : '연결됨';
    const tone = !connected ? 'idle' : reached || windows.some((w) => w.pct > WARN_AT) ? 'warn' : 'ok';
    const action: ProviderAction = busy ? 'cancel' : connected ? 'disconnect' : missing ? null : 'connect';
    const loginUrl = busy && typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null;
    return { id, name: NAMES[id], tone, status, action, windows, error: p.error ?? null, loginUrl };
  });
}

/** Any provider still mid-login: the dialog keeps polling while this is true. */
export const anyBusy = (providers: Partial<Record<string, ProviderInfo>>) => PROVIDER_IDS.some((id) => !!providers[id]?.busy);

/** A percent field (1..100) as the 0..1 fraction the guard stores; null when out of range or not a number. */
export function fractionFrom(input: string): number | null {
  const n = Number(input.trim());
  if (!input.trim() || !Number.isFinite(n) || n < 1 || n > 100) return null;
  return Math.round(n) / 100;
}

/** A whole number in [min, max]; null otherwise (0 means off where the server allows it). */
export function wholeFrom(input: string, min: number, max: number): number | null {
  const n = Number(input.trim());
  if (!input.trim() || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
