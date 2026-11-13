// What the lead's `write_plan` tool puts in a pipeline file (E20, docs/design/dispatch-integration/3-ux-flow.md §2),
// and the "바뀐 점" between two plans that the start confirm shows and the lead receives on approval.
// Pure: the server validates and writes, the web only reads `planChanges`.
import { MAX_PLAN_N, MAX_PLAN_STEPS, PLAN_PERMS, type Plan, type PlanStep } from './plan.ts';

/** Step ids are short and safe in DSL code and run records (server/runs/plan.js uses the same rule). */
export const PLAN_STEP_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_PLAN_TITLE = 120;
export const MAX_PLAN_LINE = 300;
export const MAX_PLAN_LIST = 20;
/** Id of the generated flowchart block. */
export const PLAN_BLOCK_ID = 'b_plan';

export interface WritePlanStep {
  id?: string;
  title: string;
  role: string;
  model?: string;
  effort?: string;
  perm?: string;
  n?: number;
  after?: string[];
  files?: string[];
  done?: string;
  task?: string;
}

export interface WritePlanInput {
  title?: string;
  goal: string;
  steps: WritePlanStep[];
  risks?: string[];
  asks?: string[];
}

type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[] };
type Block = { id: string; type: string; code: string; x: number; y: number; w: number; h: number; layout?: unknown; frameId?: string };

export interface WrittenPlan {
  title: string;
  document: { type: 'doc'; content: DocNode[] };
  block: Block;
  plan: Plan;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const line = (v: unknown, max = MAX_PLAN_LINE) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Why `input` is not a usable write_plan call, or null. Messages are for the lead (Korean, plain). */
export function writePlanProblem(input: unknown): string | null {
  if (!isObj(input)) return '입력이 객체가 아니에요';
  if (!line(input.goal)) return 'goal이 비어 있어요';
  if (!Array.isArray(input.steps) || input.steps.length === 0) return 'steps가 비어 있어요. 단계를 하나 이상 적어 주세요';
  if (input.steps.length > MAX_PLAN_STEPS) return `단계는 ${MAX_PLAN_STEPS}개까지예요`;
  for (const k of ['risks', 'asks'] as const) {
    const v = input[k];
    if (v !== undefined && (!Array.isArray(v) || v.length > MAX_PLAN_LIST || !v.every((x) => typeof x === 'string'))) return `${k}는 문자열 ${MAX_PLAN_LIST}개까지의 배열이에요`;
  }
  const ids = new Set<string>();
  for (let i = 0; i < input.steps.length; i++) {
    const s: unknown = input.steps[i];
    const at = `steps[${i}]`;
    if (!isObj(s)) return `${at}가 객체가 아니에요`;
    const id = s.id ?? `s${i + 1}`;
    if (typeof id !== 'string' || !PLAN_STEP_ID.test(id)) return `${at}.id는 영문·숫자·-·_ 1-64자예요`;
    if (ids.has(id)) return `단계 id "${id}"가 두 번 나와요`;
    ids.add(id);
    if (!line(s.title)) return `${at}.title이 비어 있어요`;
    if (!line(s.role, 200)) return `${at}.role이 비어 있어요`;
    for (const k of ['model', 'effort'] as const) if (s[k] !== undefined && !line(s[k], 200)) return `${at}.${k}가 비어 있어요`;
    if (s.perm !== undefined && !(PLAN_PERMS as readonly unknown[]).includes(s.perm)) return `${at}.perm은 ${PLAN_PERMS.join(', ')} 중 하나예요`;
    if (s.n !== undefined && (!Number.isInteger(s.n) || (s.n as number) < 1 || (s.n as number) > MAX_PLAN_N)) return `${at}.n은 1-${MAX_PLAN_N}이에요`;
    if (s.after !== undefined && (!Array.isArray(s.after) || !s.after.every((a) => typeof a === 'string'))) return `${at}.after는 단계 id 배열이에요`;
    if (s.files !== undefined && (!Array.isArray(s.files) || s.files.length > MAX_PLAN_LIST || !s.files.every((a) => typeof a === 'string'))) return `${at}.files는 문자열 ${MAX_PLAN_LIST}개까지의 배열이에요`;
    for (const k of ['done', 'task'] as const) if (s[k] !== undefined && typeof s[k] !== 'string') return `${at}.${k}는 문자열이에요`;
    if (typeof s.task === 'string' && s.task.length > 4000) return `${at}.task는 4000자까지예요`;
  }
  for (let i = 0; i < input.steps.length; i++) {
    const s = input.steps[i] as WritePlanStep;
    for (const a of s.after ?? []) if (!ids.has(a)) return `steps[${i}].after의 "${a.slice(0, 40)}"는 없는 단계예요`;
  }
  return null;
}

// A DSL string literal: quotes and backslashes would end it early, so they are swapped for safe look-alikes.
const dslText = (t: string) => t.replace(/\\/g, '/').replace(/"/g, "'");
const text = (t: string): DocNode[] => (t ? [{ type: 'text', text: t } as DocNode & { text: string }] : []);
const para = (t: string): DocNode => ({ type: 'paragraph', content: text(t) });
const heading = (t: string, level = 2): DocNode => ({ type: 'heading', attrs: { level }, content: text(t) });
const list = (type: 'bulletList' | 'orderedList', items: string[]): DocNode => ({ type, content: items.map((t) => ({ type: 'listItem', content: [para(t)] })) });

/** The step's instructions as one text: what the session gets as its task (title, done-when, files, details). */
function stepTask(s: WritePlanStep): string {
  const parts = [line(s.title)];
  if (line(s.done)) parts.push(`끝: ${line(s.done)}`);
  const files = (s.files ?? []).map((f) => line(f, 200)).filter(Boolean);
  if (files.length) parts.push(`파일: ${files.join(', ')}`);
  const task = typeof s.task === 'string' ? s.task.trim() : '';
  if (task) parts.push(task);
  return parts.join('\n');
}

/**
 * The file content for a checked write_plan input: document (goal, step list with the diagram, risks, asks),
 * the flowchart block whose nodes are the steps, and the plan drawn in it. `previous` keeps a placed block's
 * position, size, layout and frame, so a revised plan does not jump on the canvas.
 */
export function buildPlanFile(input: WritePlanInput, previous?: Block | null): WrittenPlan {
  const steps = input.steps.map((s, i) => ({ ...s, id: s.id ?? `s${i + 1}` }));
  const goal = line(input.goal);
  const title = line(input.title, MAX_PLAN_TITLE) || line(goal, 60);
  const code = [
    'direction right',
    '',
    ...steps.map((s) => `${s.id} [label: "${dslText(line(s.title, 80))}"]`),
    '',
    ...steps.flatMap((s) => (s.after ?? []).map((a) => `${a} > ${s.id}`)),
    '',
  ].join('\n');
  const block: Block = previous
    ? { ...previous, type: 'flowchart', code }
    : { id: PLAN_BLOCK_ID, type: 'flowchart', code, x: 0, y: 0, w: 0, h: 0 };
  const rows = steps.map((s) => {
    const who = [line(s.role, 40), s.model ? line(s.model, 60) : '', s.effort ? line(s.effort, 20) : ''].filter(Boolean).join(' · ');
    const done = line(s.done) ? ` — 끝: ${line(s.done)}` : '';
    return `${line(s.title)} (${s.id}) — ${who}${done}`;
  });
  const risks = (input.risks ?? []).map((r) => line(r)).filter(Boolean);
  const asks = (input.asks ?? []).map((r) => line(r)).filter(Boolean);
  const content: DocNode[] = [
    heading('목표'),
    para(goal),
    heading('단계'),
    { type: 'diagram', attrs: { blockId: block.id } },
    list('orderedList', rows),
    heading('위험'),
    risks.length ? list('bulletList', risks) : para('없어요.'),
    heading('사용자에게 물어볼 것'),
    asks.length ? list('bulletList', asks) : para('없어요.'),
  ];
  const plan: Plan = {
    v: 1,
    block: block.id,
    steps: steps.map((s) => {
      const step: PlanStep = { id: s.id, node: s.id, role: line(s.role, 200), task: stepTask(s) };
      if (s.model) step.model = line(s.model, 200);
      if (s.effort) step.effort = line(s.effort, 200);
      if (s.perm) step.perm = s.perm as PlanStep['perm'];
      if (s.n) step.n = s.n;
      step.after = [...new Set(s.after ?? [])];
      return step;
    }),
  };
  return { title, document: { type: 'doc', content }, block, plan };
}

const FIELD_NAMES: Record<string, string> = { role: '역할', model: '모델', effort: '강도', perm: '권한', n: '세션 수', provider: '제공자', gate: '확인' };

/**
 * Plain lines saying how `after` differs from `before` by step id: added, removed, and changed role / model /
 * effort / perm / n / gate / order / task. Empty when nothing a run depends on changed. Capped at `max` lines.
 */
export function planChanges(before: Plan | null | undefined, after: Plan | null | undefined, max = 20): string[] {
  if (!after) return before ? ['계획이 지워졌어요'] : [];
  if (!before) return [];
  const out: string[] = [];
  const old = new Map(before.steps.map((s) => [s.id, s]));
  const now = new Map(after.steps.map((s) => [s.id, s]));
  const fmt = (v: unknown) => (v === undefined || v === null || v === '' ? '없음' : String(v));
  for (const s of after.steps) {
    const o = old.get(s.id);
    if (!o) {
      out.push(`단계 ${s.id} 추가`);
      continue;
    }
    for (const k of Object.keys(FIELD_NAMES) as (keyof PlanStep)[]) {
      if (fmt(o[k]) !== fmt(s[k])) out.push(`단계 ${s.id} ${FIELD_NAMES[k]} ${fmt(o[k])} → ${fmt(s[k])}`);
    }
    if ((o.after ?? []).join(',') !== (s.after ?? []).join(',')) out.push(`단계 ${s.id} 순서 바뀜`);
    if ((o.task ?? '') !== (s.task ?? '')) out.push(`단계 ${s.id} 할 일 바뀜`);
  }
  for (const s of before.steps) if (!now.has(s.id)) out.push(`단계 ${s.id} 지움`);
  if (before.block !== after.block) out.push('다이어그램 블록 바뀜');
  if (JSON.stringify(before.defaults ?? {}) !== JSON.stringify(after.defaults ?? {})) out.push('기본값 바뀜');
  return out.length > max ? [...out.slice(0, max), `그 밖에 ${out.length - max}개`] : out;
}
