// Pipeline plan (`plan` in `.dpx.json`, format v4; docs/design/dispatch-integration/2-file-format-and-live-overlay.md §3).
// Shared like `layoutProblem` / `cleanLayout` (shared/render/block-layout.ts): the server checks saves and plan patches
// with `planProblem` / `cleanPlan`, and both sides compute the run order with `planOrder`.
// Storage rules only check the shape. Whether a plan can run (its block exists, `after` names real steps, no cycle)
// is `planOrder`'s job, so a person deleting the diagram block never makes their file unsaveable.

/** Sub-format version this code understands. A plan with a higher `v` is kept verbatim, shown and not runnable. */
export const PLAN_VERSION = 1;
export const MAX_PLAN_STEPS = 200;
/** Longest `task` (instructions for the step, never a transcript). */
export const MAX_PLAN_TASK = 20_000;
/** Longest id, node, block, role, model, effort and provider name. */
export const MAX_PLAN_NAME = 200;
/** Highest `n` (sessions per step); same cap as Dispatch's create_sessions `count`. */
export const MAX_PLAN_N = 4;
/** Permission modes a step may ask for. There is no looser mode on purpose. */
export const PLAN_PERMS = ['manual', 'acceptEdits', 'auto', 'plan'] as const;
export const PLAN_GATES = ['auto', 'manual'] as const;

export type PlanPerm = (typeof PLAN_PERMS)[number];
export type PlanGate = (typeof PLAN_GATES)[number];

/** Fields a step shares with `plan.defaults`. */
export interface PlanStepFields {
  provider?: string;
  role?: string;
  model?: string;
  effort?: string;
  perm?: PlanPerm;
  /** Sessions for this step (1-4). */
  n?: number;
  task?: string;
  gate?: PlanGate;
}

export interface PlanStep extends PlanStepFields {
  /** Unique, stable key runs use. Defaults to `node`. */
  id: string;
  /** DSL node id in `plan.block`. Defaults to `id`. */
  node: string;
  /** Explicit dependencies (step ids). Absent: taken from the diagram edges. */
  after?: string[];
}

export interface Plan {
  v: number;
  /** Id of the diagram block the steps are drawn in. */
  block: string;
  defaults?: PlanStepFields;
  steps: PlanStep[];
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isName = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= MAX_PLAN_NAME;
const NAME_FIELDS = ['provider', 'role', 'model', 'effort'] as const;

function fieldsProblem(f: Record<string, unknown>, at: string): string | null {
  for (const k of NAME_FIELDS) {
    if (f[k] !== undefined && !isName(f[k])) return `${at}.${k} must be a string of 1-${MAX_PLAN_NAME} characters`;
  }
  if (f.perm !== undefined && !(PLAN_PERMS as readonly unknown[]).includes(f.perm)) return `${at}.perm must be one of ${PLAN_PERMS.join(', ')}`;
  if (f.gate !== undefined && !(PLAN_GATES as readonly unknown[]).includes(f.gate)) return `${at}.gate must be one of ${PLAN_GATES.join(', ')}`;
  if (f.n !== undefined && (!Number.isInteger(f.n) || (f.n as number) < 1 || (f.n as number) > MAX_PLAN_N)) return `${at}.n must be an integer 1-${MAX_PLAN_N}`;
  if (f.task !== undefined && (typeof f.task !== 'string' || f.task.length > MAX_PLAN_TASK)) return `${at}.task must be a string of at most ${MAX_PLAN_TASK} characters`;
  return null;
}

/**
 * Why `p` is not a storable plan, or null when it is. `at` names it in the message.
 * A `v` above {@link PLAN_VERSION} is only checked for being an object with an integer `v` (a newer client wrote it).
 */
export function planProblem(p: unknown, at = 'plan'): string | null {
  if (!isObj(p)) return `${at} must be an object`;
  if (!Number.isInteger(p.v) || (p.v as number) < 1) return `${at}.v must be an integer >= 1`;
  if ((p.v as number) > PLAN_VERSION) return null;
  if (!isName(p.block)) return `${at}.block must be a string of 1-${MAX_PLAN_NAME} characters`;
  if (p.defaults !== undefined) {
    if (!isObj(p.defaults)) return `${at}.defaults must be an object`;
    const bad = fieldsProblem(p.defaults, `${at}.defaults`);
    if (bad) return bad;
  }
  if (!Array.isArray(p.steps)) return `${at}.steps must be an array`;
  if (p.steps.length > MAX_PLAN_STEPS) return `${at}.steps has more than ${MAX_PLAN_STEPS} entries`;
  const ids = new Set<string>();
  for (let i = 0; i < p.steps.length; i++) {
    const s: unknown = p.steps[i];
    const sat = `${at}.steps[${i}]`;
    if (!isObj(s)) return `${sat} must be an object`;
    if (s.id !== undefined && !isName(s.id)) return `${sat}.id must be a string of 1-${MAX_PLAN_NAME} characters`;
    if (s.node !== undefined && !isName(s.node)) return `${sat}.node must be a string of 1-${MAX_PLAN_NAME} characters`;
    const id = (s.id ?? s.node) as string | undefined;
    if (id === undefined) return `${sat} needs an id or a node`;
    if (ids.has(id)) return `duplicate step id "${id.slice(0, 40)}"`;
    ids.add(id);
    const bad = fieldsProblem(s, sat);
    if (bad) return bad;
    if (s.after !== undefined) {
      if (!Array.isArray(s.after) || s.after.length > MAX_PLAN_STEPS) return `${sat}.after must be an array of at most ${MAX_PLAN_STEPS} step ids`;
      if (!s.after.every(isName)) return `${sat}.after entries must be strings of 1-${MAX_PLAN_NAME} characters`;
    }
  }
  return null;
}

function cleanFields(f: PlanStepFields): PlanStepFields {
  const out: PlanStepFields = {};
  for (const k of NAME_FIELDS) if (f[k] !== undefined) out[k] = f[k];
  if (f.perm !== undefined) out.perm = f.perm;
  if (f.n !== undefined) out.n = f.n;
  if (f.task !== undefined) out.task = f.task;
  if (f.gate !== undefined) out.gate = f.gate;
  return out;
}

/**
 * Copy of a plan that passed {@link planProblem}: unknown fields dropped, `id` / `node` filled in from each other,
 * duplicate `after` entries removed. A newer `v` comes back as is.
 */
export function cleanPlan(p: Plan): Plan {
  if (p.v > PLAN_VERSION) return p;
  const out: Plan = { v: p.v, block: p.block, steps: [] };
  if (p.defaults !== undefined) out.defaults = cleanFields(p.defaults);
  out.steps = p.steps.map((s) => {
    const id = s.id ?? s.node;
    const step: PlanStep = { id, node: s.node ?? id, ...cleanFields(s) };
    if (s.after !== undefined) step.after = [...new Set(s.after)];
    return step;
  });
  return out;
}

/** A step with `plan.defaults` filled in for the fields it omits. */
export function resolvedStep(plan: Plan, step: PlanStep): PlanStep {
  return { ...cleanFields(plan.defaults ?? {}), ...step };
}

export interface PlanEdge {
  from: string;
  to: string;
}

export type PlanOrder =
  | {
      ok: true;
      /** Step ids, each after everything it depends on; ties keep the plan's step order. */
      order: string[];
      /** Dependencies per step id (explicit `after`, or taken from the diagram edges). */
      after: Record<string, string[]>;
      /** Steps whose node is not in the diagram. They still run; the plan panel lists them. */
      missingNodes: string[];
    }
  | { ok: false; problem: string; cycle?: string[] };

/**
 * Run order of a clean plan. `diagram` is the parsed `plan.block` (its node ids and edges, chains already expanded),
 * or null when that block does not exist. Edges to nodes that are not steps are ignored; a step with `after` uses
 * only `after`. Fails on a newer plan version, a missing block, an `after` naming no step, or a cycle (named).
 */
export function planOrder(plan: Plan, diagram: { nodes: readonly string[]; edges: readonly PlanEdge[] } | null): PlanOrder {
  if (plan.v > PLAN_VERSION) return { ok: false, problem: `plan.v ${plan.v} is newer than this app (${PLAN_VERSION})` };
  if (!diagram) return { ok: false, problem: `plan.block "${plan.block.slice(0, 40)}" is not a diagram block in this file` };
  const ids = new Set(plan.steps.map((s) => s.id));
  const byNode = new Map<string, string[]>();
  for (const s of plan.steps) byNode.set(s.node, [...(byNode.get(s.node) ?? []), s.id]);
  const fromEdges = new Map<string, Set<string>>();
  for (const e of diagram.edges) {
    for (const to of byNode.get(e.to) ?? []) {
      for (const from of byNode.get(e.from) ?? []) {
        if (from === to) continue;
        const set = fromEdges.get(to) ?? new Set<string>();
        set.add(from);
        fromEdges.set(to, set);
      }
    }
  }
  const after: Record<string, string[]> = Object.create(null);
  for (const s of plan.steps) {
    if (s.after) {
      const unknown = s.after.find((a) => !ids.has(a));
      if (unknown !== undefined) return { ok: false, problem: `step "${s.id.slice(0, 40)}" waits for "${unknown.slice(0, 40)}", which is not a step` };
      after[s.id] = [...s.after];
    } else {
      after[s.id] = [...(fromEdges.get(s.id) ?? [])];
    }
  }
  // Kahn's algorithm; picking the earliest ready step in plan order keeps the result stable.
  const indeg = new Map(plan.steps.map((s) => [s.id, after[s.id]!.length]));
  const next = new Map<string, string[]>();
  for (const s of plan.steps) for (const a of after[s.id]!) next.set(a, [...(next.get(a) ?? []), s.id]);
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < plan.steps.length) {
    const ready = plan.steps.find((s) => !done.has(s.id) && indeg.get(s.id) === 0);
    if (!ready) break;
    order.push(ready.id);
    done.add(ready.id);
    for (const n of next.get(ready.id) ?? []) indeg.set(n, indeg.get(n)! - 1);
  }
  if (order.length < plan.steps.length) {
    const cycle = findCycle(plan.steps.map((s) => s.id).filter((id) => !done.has(id)), after);
    return { ok: false, problem: `steps wait for each other in a cycle: ${cycle.join(' > ')}`, cycle };
  }
  const nodes = new Set(diagram.nodes);
  return { ok: true, order, after, missingNodes: plan.steps.filter((s) => !nodes.has(s.node)).map((s) => s.id) };
}

// Walk dependencies from a step left in the cycle until a step repeats; the repeated stretch is a cycle.
function findCycle(left: string[], after: Record<string, string[]>): string[] {
  const inLeft = new Set(left);
  const path: string[] = [];
  const seen = new Map<string, number>();
  let cur = left[0]!;
  while (!seen.has(cur)) {
    seen.set(cur, path.length);
    path.push(cur);
    cur = after[cur]!.find((a) => inLeft.has(a))!;
  }
  // `after` points backwards (to what runs first), so reverse to read in run order and close the loop.
  const loop = path.slice(seen.get(cur)).reverse();
  // Start at the step that comes first in the plan, so the message does not depend on the walk.
  const first = loop.indexOf(left.find((id) => loop.includes(id))!);
  const named = [...loop.slice(first), ...loop.slice(0, first)];
  return [...named, named[0]!];
}
