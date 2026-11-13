// The one place the recorder reads the plan format (E18). Everything else sees { revision, hash, snapshot }
// and a list of step ids, so a plan format change only touches this file.
import { createHash } from 'node:crypto';

const STEP_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `plan` is the file's plan as started (E18 shape: { v, block, steps: [{ id, ... }] }) and `revision` the
 * file revision it was read at. Returns what the run record keeps under `plan`, plus the step ids in order.
 */
export function planForRun(plan, revision = 0) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) throw new TypeError('plan.steps must be an array');
  const stepIds = [];
  for (const s of plan.steps) {
    const id = s?.id;
    if (typeof id !== 'string' || !STEP_ID.test(id)) throw new TypeError('every plan step needs a short id');
    if (stepIds.includes(id)) throw new TypeError(`duplicate step id: ${id}`);
    stepIds.push(id);
  }
  const snapshot = JSON.parse(JSON.stringify(plan));
  const hash = 'sha256:' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return { plan: { revision: Number.isInteger(revision) ? revision : 0, hash, snapshot }, stepIds };
}
