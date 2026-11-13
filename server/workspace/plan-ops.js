// Step-level edits for PATCH /api/file/plan (docs/workspace-api.md "Pipeline `plan`").
// Ops only reshape the plan; the result is checked with the shared plan rules when the file is normalized.
import { ValidationError } from './model.js';

export const MAX_PLAN_OPS = 200;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const stepId = (s) => s.id ?? s.node;

function findStep(plan, id, at) {
  if (typeof id !== 'string') throw new ValidationError(`${at}.id must be a string`);
  const i = plan.steps.findIndex((s) => stepId(s) === id);
  if (i < 0) throw new ValidationError(`${at}: no step "${id.slice(0, 40)}"`);
  return i;
}

// Fields of `patch` replace the step's; a null value removes the field.
function merge(step, patch) {
  const out = { ...step };
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__') continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/**
 * Apply ops to `plan` (undefined when the file has none) and return the new plan. Throws ValidationError.
 * - `{op:'plan', block?, defaults?}`: set plan-level fields; starts a plan (needs `block`) when there is none. `defaults: null` removes them.
 * - `{op:'add', step, before?}`: insert a step before step id `before`, or at the end.
 * - `{op:'set', id, step}`: change fields of step `id` (null removes a field). A new `id` is renamed in every `after` too.
 * - `{op:'remove', id}`: remove step `id` and drop it from every `after`.
 */
export function applyPlanOps(plan, ops) {
  if (!Array.isArray(ops) || ops.length === 0) throw new ValidationError('ops must be a non-empty array');
  if (ops.length > MAX_PLAN_OPS) throw new ValidationError(`ops has more than ${MAX_PLAN_OPS} entries`);
  let p = plan ? { ...plan, steps: [...plan.steps] } : null;
  ops.forEach((o, i) => {
    const at = `ops[${i}]`;
    if (!isObj(o)) throw new ValidationError(`${at} must be an object`);
    if (o.op === 'plan') {
      if (!p) {
        if (o.block === undefined) throw new ValidationError(`${at}: the file has no plan yet, so block is required`);
        p = { v: 1, block: o.block, steps: [] };
      }
      if (o.block !== undefined) p.block = o.block;
      if (o.defaults === null) delete p.defaults;
      else if (o.defaults !== undefined) p.defaults = o.defaults;
      return;
    }
    if (!p) throw new ValidationError(`${at}: the file has no plan; start one with {"op":"plan","block":...}`);
    if (o.op === 'add') {
      if (!isObj(o.step)) throw new ValidationError(`${at}.step must be an object`);
      const where = o.before === undefined ? p.steps.length : findStep(p, o.before, `${at}.before`);
      p.steps.splice(where, 0, merge({}, o.step));
    } else if (o.op === 'set') {
      const idx = findStep(p, o.id, at);
      if (!isObj(o.step)) throw new ValidationError(`${at}.step must be an object`);
      const old = p.steps[idx];
      const next = merge(old, o.step);
      // Keep the link: a step whose id was its node keeps that node when only the id changes.
      if (o.step.id !== undefined && old.node === undefined && next.node === undefined) next.node = o.id;
      p.steps[idx] = next;
      const renamed = stepId(next);
      if (renamed !== o.id) p.steps = p.steps.map((s) => (Array.isArray(s.after) ? { ...s, after: s.after.map((a) => (a === o.id ? renamed : a)) } : s));
    } else if (o.op === 'remove') {
      const idx = findStep(p, o.id, at);
      p.steps.splice(idx, 1);
      p.steps = p.steps.map((s) => (Array.isArray(s.after) ? { ...s, after: s.after.filter((a) => a !== o.id) } : s));
    } else {
      throw new ValidationError(`${at}.op must be plan, add, set or remove`);
    }
  });
  return p;
}
