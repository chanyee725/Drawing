// Pure helpers for the agents feed (T5): normalise the server's `agents` payload,
// pick colours, decide which cursor shows where, and step the cursor spring.
// No DOM or React imports so `node --test` can load this file directly.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentChange {
  fileId: string | null;
  relPath: string | null;
  /** Source label (`main` or the worktree's session name). */
  source: string | null;
  page: { id: string; name: string } | null;
  kinds: string[];
  cellIds: string[];
  /** Diagram (model) coordinates of everything that changed, or null. */
  bbox: Rect | null;
  summary: string;
  /** Epoch ms. */
  at: number;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  roleName: string;
  status: string;
  activity: string;
  activityAt: number | null;
  lastChange: AgentChange | null;
}

export interface DispatchInfo {
  /** False when the server has no Dispatch to follow. */
  found: boolean;
  connected: boolean;
}

export interface AgentsSnapshot {
  dispatch: DispatchInfo;
  agents: Agent[];
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
};

function normalizeRect(v: unknown): Rect | null {
  const r = v as Raw | null;
  if (!r || typeof r !== 'object') return null;
  // The watch feed sends {x, y, w, h}; accept {width, height} too.
  const x = num(r.x), y = num(r.y), width = num(r.width ?? r.w), height = num(r.height ?? r.h);
  return x == null || y == null || width == null || height == null ? null : { x, y, width, height };
}

function normalizeChange(v: unknown): AgentChange | null {
  const r = v as Raw | null;
  if (!r || typeof r !== 'object') return null;
  const page = r.page as Raw | null;
  return {
    fileId: r.fileId == null ? null : str(r.fileId),
    relPath: r.relPath == null ? null : str(r.relPath),
    source: r.source == null ? null : str(r.source),
    page: page && page.id != null ? { id: str(page.id), name: str(page.name ?? page.id) } : null,
    kinds: Array.isArray(r.kinds) ? r.kinds.map(str) : [],
    cellIds: Array.isArray(r.cellIds) ? r.cellIds.map(str) : [],
    bbox: normalizeRect(r.bbox),
    summary: str(r.summary),
    at: num(r.at) ?? 0,
  };
}

/** Server `agents` event / GET /api/agents body → snapshot. Unknown fields are dropped. */
export function normalizeAgents(raw: unknown): AgentsSnapshot {
  const r = (raw ?? {}) as Raw;
  const d = (r.dispatch ?? {}) as Raw;
  const list = Array.isArray(r.agents) ? r.agents : [];
  return {
    dispatch: { found: Boolean(d.url), connected: Boolean(d.connected) },
    agents: list
      .filter((a) => a && typeof a === 'object' && (a as Raw).id != null)
      .map((a) => {
        const x = a as Raw;
        return {
          id: str(x.id),
          name: str(x.name),
          role: str(x.role),
          roleName: str(x.roleName || x.role),
          status: str(x.status),
          activity: str(x.activity),
          activityAt: num(x.activityAt),
          lastChange: normalizeChange(x.lastChange),
        };
      }),
  };
}

// --- colours ----------------------------------------------------------------

const ROLE_COLORS: Array<[RegExp, string]> = [
  [/lead|manag|관리/i, '#7c3aed'],
  [/impl|dev|구현/i, '#2563eb'],
  [/review|리뷰/i, '#d97706'],
  [/test|qa|테스/i, '#16a34a'],
  [/design|디자/i, '#db2777'],
  [/doc|문서/i, '#0d9488'],
];
const FALLBACK_COLORS = ['#4f46e5', '#0891b2', '#ca8a04', '#9333ea', '#e11d48', '#059669'];

/** Cursor colour for a role (Dispatch role key or Korean role name). */
export function roleColor(role: string, roleName = ''): string {
  for (const [re, c] of ROLE_COLORS) if (re.test(role) || re.test(roleName)) return c;
  const key = role || roleName;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

// --- status and time ----------------------------------------------------------

export type StatusTone = 'live' | 'wait' | 'off';

export function statusInfo(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'running':
      return { label: '일하는 중', tone: 'live' };
    case 'starting':
      return { label: '시작하는 중', tone: 'live' };
    case 'waiting':
      return { label: '답을 기다려요', tone: 'wait' };
    case 'idle':
      return { label: '쉬는 중', tone: 'off' };
    case 'done':
      return { label: '끝났어요', tone: 'off' };
    case 'error':
      return { label: '멈췄어요', tone: 'off' };
    default:
      return { label: status || '알 수 없어요', tone: 'off' };
  }
}

/** "방금", "12초 전", "3분 전", "2시간 전", "4일 전". */
export function timeAgo(at: number | null, now: number): string {
  if (!at) return '';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// --- where cursors go ---------------------------------------------------------

/** After this long without a change a cursor dims; after IDLE_HIDE_MS it fades out. */
export const IDLE_DIM_MS = 60_000;
export const IDLE_HIDE_MS = 5 * 60_000;

/** Target opacity of an agent's cursor: 1 active, 0.35 idle for a while, 0 long idle. */
export function cursorOpacity(agent: Agent, now: number): number {
  const at = agent.lastChange?.at ?? 0;
  if (!at) return 0;
  const age = now - at;
  if (age >= IDLE_HIDE_MS) return 0;
  if (age >= IDLE_DIM_MS || statusInfo(agent.status).tone === 'off') return 0.35;
  return 1;
}

/** Agents whose last change was on this file path and page (any source) and are not long idle. */
export function agentsOnPage(agents: Agent[], path: string | null, pageId: string | null, now: number): Agent[] {
  if (!path || !pageId) return [];
  return agents.filter((a) => a.lastChange?.relPath === path && a.lastChange.page?.id === pageId && cursorOpacity(a, now) > 0);
}

/** For page-tab chips: page id → agents working on another page of the same file. */
export function agentsByOtherPage(agents: Agent[], path: string | null, currentPageId: string | null, now: number): Map<string, Agent[]> {
  const out = new Map<string, Agent[]>();
  if (!path) return out;
  for (const a of agents) {
    const c = a.lastChange;
    if (!c?.page || c.relPath !== path || c.page.id === currentPageId || cursorOpacity(a, now) < 1) continue;
    const list = out.get(c.page.id) ?? [];
    list.push(a);
    out.set(c.page.id, list);
  }
  return out;
}

/** Point a cursor tip aims at: the centre of the changed area. */
export function cursorPoint(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

// --- spring -------------------------------------------------------------------

export interface Spring1 {
  x: number;
  v: number;
}

/**
 * Exact critically damped spring step toward `target` (no overshoot, stable for any dt).
 * `omega` sets speed: ~90% of the way in 4/omega seconds.
 */
export function springStep(s: Spring1, target: number, dt: number, omega: number): Spring1 {
  const d = s.x - target;
  const k = s.v + omega * d;
  const e = Math.exp(-omega * dt);
  return { x: target + (d + k * dt) * e, v: (s.v - omega * k * dt) * e };
}

/** True when a spring is close enough to rest to stop animating. */
export function springSettled(s: Spring1, target: number, eps = 0.05): boolean {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < eps;
}
