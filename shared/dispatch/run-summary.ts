// The 완료 summary block (E28, docs/design/dispatch-integration/3-ux-flow.md §5): what the server writes once into a
// pipeline file's document when its run is done, and how 복제해서 새 계획 takes it out again. Pure: the input is a run
// record (metadata only: steps, sessions, times, cost, tokens, commits, PR numbers, the lead's notes), so nothing
// from a transcript can reach the document.

/** Id of the summary's heading; the block runs from that heading to the first horizontal rule after it. */
export const SUMMARY_HEADING_ID = 'run-summary';

type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string };
export type DocJSON = { type: 'doc'; content?: DocNode[] };

export interface SummarySession {
  sid: string;
  model?: string;
  cost?: number;
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  pr?: { number: number; state: string | null } | null;
}

export interface SummaryStep {
  state: string;
  startedAt: number | null;
  endedAt: number | null;
  sessions: SummarySession[];
  note?: string;
  /** How the board closed the step: merged at `commit` (on `base`), or abandoned (그만둠). */
  result?: { commit?: string; base?: string; abandoned?: boolean };
}

export interface SummaryRecord {
  startedAt: number;
  endedAt: number | null;
  plan: { snapshot: { steps: { id: string; role?: string; model?: string; task?: string }[]; defaults?: { role?: string; model?: string } } };
  steps: Record<string, SummaryStep>;
  totals: { cost: number; mtok: number };
}

export interface SummaryOptions {
  /** Step title shown in the table (defaults to the first line of the step's task, else its id). */
  title?: (id: string) => string;
  /** Role id → its name ("impl" → "구현자"). */
  roleName?: (role: string) => string;
}

const two = (n: number) => String(n).padStart(2, '0');
const clock = (t: number) => {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};
const day = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/** "40초" → "1분", "12분", "1시간 7분". */
export function durationText(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60e3));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const firstLine = (t: string | undefined) => (t ?? '').split('\n')[0]!.trim();
const text = (t: string): DocNode[] => (t ? [{ type: 'text', text: t }] : []);
const para = (t: string): DocNode => ({ type: 'paragraph', content: text(t) });
const cell = (type: 'tableHeader' | 'tableCell', t: string): DocNode => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(t)] });
const row = (type: 'tableHeader' | 'tableCell', cells: string[]): DocNode => ({ type: 'tableRow', content: cells.map((c) => cell(type, c)) });

const prsOf = (step: SummaryStep) => [...new Set(step.sessions.map((s) => s.pr?.number).filter((n): n is number => Number.isInteger(n)))];

/** The result column: "develop 3f2a1c0", "PR #92", "그만둠" or "—". */
function resultText(step: SummaryStep): string {
  const r = step.result;
  if (r?.abandoned || step.state === 'skipped') return '그만둠';
  const prs = prsOf(step).map((n) => `PR #${n}`);
  if (r?.commit) return [[r.base, r.commit.slice(0, 7)].filter(Boolean).join(' '), ...prs].join(' · ');
  return prs.join(' ') || '—';
}

/** The summary as document nodes: heading, totals line, step table, plan differences, closing rule. */
export function summaryNodes(record: SummaryRecord, opts: SummaryOptions = {}): DocNode[] {
  const plan = record.plan.snapshot;
  const roleName = opts.roleName ?? ((r: string) => r);
  const end = record.endedAt ?? record.startedAt;
  const span = `${day(record.startedAt)} ${clock(record.startedAt)}–${clock(end)}`;
  let sessions = 0;
  let merged = 0;
  const prs = new Set<number>();
  const diffs: string[] = [];
  const rows = plan.steps.map((ps, i) => {
    const step = record.steps[ps.id] ?? { state: 'pending', startedAt: null, endedAt: null, sessions: [] };
    sessions += step.sessions.length;
    for (const n of prsOf(step)) prs.add(n);
    if (step.result?.commit) merged++;
    const title = opts.title?.(ps.id) || firstLine(ps.task) || ps.id;
    const abandoned = !!step.result?.abandoned || step.state === 'skipped';
    if (abandoned) diffs.push(`단계 ${i + 1} 그만둠${step.note ? ` ("${step.note}")` : ''}`);
    const models = [...new Set(step.sessions.map((s) => s.model).filter((m): m is string => !!m))];
    const cost = step.sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);
    const took = step.startedAt !== null && !abandoned ? durationText((step.endedAt ?? end) - step.startedAt) : '—';
    return [
      `${i + 1} ${title}`,
      roleName(ps.role ?? plan.defaults?.role ?? '') || '—',
      models.join(', ') || ps.model || plan.defaults?.model || '—',
      took,
      step.sessions.some((s) => s.cost !== undefined) ? money(cost) : '—',
      resultText(step),
    ];
  });
  const totals = [`단계 ${plan.steps.length}개`, `세션 ${sessions}개`, money(record.totals.cost), `${record.totals.mtok}M 토큰`];
  if (merged || prs.size) totals.push(`병합 ${merged}건${prs.size ? ` (${[...prs].sort((a, b) => a - b).map((n) => `PR #${n}`).join(' ')})` : ''}`);
  return [
    { type: 'heading', attrs: { level: 2, id: SUMMARY_HEADING_ID }, content: text(`✓ 완료 · ${span} (${durationText(end - record.startedAt)})`) },
    para(totals.join(' · ')),
    { type: 'table', content: [row('tableHeader', ['단계', '역할', '모델', '걸린 시간', '비용', '결과']), ...rows.map((r) => row('tableCell', r))] },
    para(`계획과 달라진 점: ${diffs.length ? diffs.join(', ') : '없어요'}`),
    { type: 'horizontalRule' },
  ];
}

/** Where the summary block sits in `content`: [start, end) or null. */
function summaryRange(content: readonly DocNode[]): [number, number] | null {
  const start = content.findIndex((n) => n?.type === 'heading' && n.attrs?.id === SUMMARY_HEADING_ID);
  if (start < 0) return null;
  let end = start + 1;
  while (end < content.length && content[end]!.type !== 'horizontalRule' && content[end]!.type !== 'heading') end++;
  if (end < content.length && content[end]!.type === 'horizontalRule') end++;
  return [start, end];
}

/** The document with `nodes` as its summary block: an older summary is replaced, else the block goes first. */
export function withSummary(document: DocJSON | null | undefined, nodes: DocNode[]): DocJSON {
  const content = [...(document?.content ?? [])];
  const at = summaryRange(content);
  if (at) content.splice(at[0], at[1] - at[0], ...nodes);
  else content.unshift(...nodes);
  return { ...(document ?? {}), type: 'doc', content };
}

/** The document without its summary block (복제해서 새 계획 starts from the plan, not from the last result). */
export function withoutSummary(document: DocJSON | null | undefined): DocJSON {
  const content = [...(document?.content ?? [])];
  const at = summaryRange(content);
  if (at) content.splice(at[0], at[1] - at[0]);
  return { ...(document ?? {}), type: 'doc', content };
}
