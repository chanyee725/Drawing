// Agents feed for the web (T5). Kept apart from data/ so the file feed stays untouched:
// the real feed reads GET /api/agents once, then follows `agents` events on /api/events.
// The mock feed moves two pretend agents over the mock diagram's cells.
import { normalizeAgents, type Agent, type AgentsSnapshot } from './model';

export type AgentsListener = (snap: AgentsSnapshot) => void;

export function subscribeApiAgents(onData: AgentsListener, base = ''): () => void {
  let closed = false;
  let gotEvent = false;
  fetch(`${base}/api/agents`, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!closed && d && !gotEvent) onData(normalizeAgents(d));
    })
    .catch(() => {});
  const es = new EventSource(`${base}/api/events`);
  es.addEventListener('agents', (e) => {
    try {
      const snap = normalizeAgents(JSON.parse((e as MessageEvent).data));
      gotEvent = true;
      if (!closed) onData(snap);
    } catch {
      // ignore a malformed event
    }
  });
  return () => {
    closed = true;
    es.close();
  };
}

/** Pretend agents for `?mock`: they "edit" cells of the mock pipeline file. */
export function subscribeMockAgents(onData: AgentsListener, { intervalMs = 2200 } = {}): () => void {
  const fileId = 'main:docs/pipeline.drawio';
  const relPath = 'docs/pipeline.drawio';
  const pages = { p1: '파이프라인', p2: '구성' } as const;
  const plan: Array<{ page: keyof typeof pages; cells: string[]; text: string }> = [
    { page: 'p1', cells: ['s0'], text: '수집 단계 이름을 고치고 있어요' },
    { page: 'p1', cells: ['s2'], text: '학습 단계를 옮기고 있어요' },
    { page: 'p1', cells: ['s4', 'e3'], text: '배포 화살표를 잇고 있어요' },
    { page: 'p2', cells: ['b'], text: 'server 상자를 다듬고 있어요' },
  ];
  const mk = (id: string, name: string, role: string, roleName: string): Agent => ({
    id,
    name,
    role,
    roleName,
    status: 'running',
    activity: '',
    activityAt: null,
    lastChange: null,
  });
  const agents = [mk('m1', 'impl-1', 'impl', '구현자'), mk('m2', 'review-1', 'review', '리뷰어')];
  let tick = 0;
  const step = () => {
    const a = agents[tick % 2];
    const p = plan[(tick * 3 + (tick % 2)) % plan.length];
    tick++;
    const now = Date.now();
    a.activity = p.text;
    a.activityAt = now;
    a.lastChange = {
      fileId,
      relPath,
      source: 'main',
      page: { id: p.page, name: pages[p.page] },
      kinds: ['text'],
      cellIds: p.cells,
      bbox: null,
      summary: '1개 글자 바뀜',
      at: now,
    };
    onData({ dispatch: { found: true, connected: true }, agents: agents.map((x) => ({ ...x })) });
  };
  step();
  step();
  const t = setInterval(step, intervalMs);
  return () => clearInterval(t);
}
