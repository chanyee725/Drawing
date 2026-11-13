// Run recorder: keeps each running pipeline run in memory, sends `run` SSE patches and writes the record to
// `.drawing/runs/<file path>/<runId>.json` (debounced, atomic). Run control (plan, approval, sessions) is not here:
// E20 calls startRun / updateSession / setStepState / endRun.
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { StoreError } from '../workspace/store.js';
import { planForRun } from './plan.js';
import {
  RECORD_VERSION,
  RUN_ID,
  RUN_STATES,
  STEP_STATES_WITHOUT_SESSIONS,
  TIMELINE_MAX,
  pickResult,
  pickSession,
  serializeRecord,
  stepStateOf,
  summaryOf,
  totalsOf,
} from './record.js';

export const RUNS_KEEP = 50;
export const RUNS_KEEP_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
export const NOTE_MAX = 200;

/**
 * runs: the store's `runs` sidecar API (serial, fileRel, dirOf, trashDirOf, onChange).
 * hub: SSE hub (broadcast). writeDelayMs: debounce for disk writes. eventGapMs: min gap between `run` events per session.
 */
export function createRecorder({ runs, hub, now = Date.now, writeDelayMs = 1000, eventGapMs = 500, keep = RUNS_KEEP, keepDays = RUNS_KEEP_DAYS } = {}) {
  const active = new Map(); // runId -> { record, loc: { path, trashId? }, writeTimer, dirty }
  const pending = new Map(); // `${runId}\0${sid}` -> { last, timer, patch, step }

  const unsubscribe = runs.onChange((e) => {
    for (const run of active.values()) {
      const p = run.loc.path;
      if (e.kind === 'move' && !run.loc.trashId && (p === e.from || p.startsWith(e.from + '/'))) {
        run.loc = { path: e.to + p.slice(e.from.length) };
      } else if (e.kind === 'trash' && !run.loc.trashId && p === e.path) {
        run.loc = { path: p, trashId: e.trashId };
      } else if (e.kind === 'restore' && run.loc.trashId === e.trashId) {
        run.loc = { path: e.path };
      } else continue;
      run.record.file = run.loc.path;
      scheduleWrite(run);
    }
  });

  const get = (runId) => {
    const run = active.get(runId);
    if (!run) throw new StoreError(404, 'run not running');
    return run;
  };

  const dirFor = (loc) => (loc.trashId ? runs.trashDirOf(loc.trashId) : runs.dirOf(loc.path));

  async function writeNow(run) {
    if (run.writeTimer) clearTimeout(run.writeTimer);
    run.writeTimer = null;
    run.dirty = false;
    const text = serializeRecord(run.record);
    await runs.serial(async () => {
      const dir = await dirFor(run.loc);
      await mkdir(dir, { recursive: true });
      const abs = join(dir, `${run.record.id}.json`);
      const tmp = join(dir, `.${basename(abs)}.${randomBytes(6).toString('hex')}.tmp`);
      await writeFile(tmp, text, { mode: 0o644 });
      try {
        await rename(tmp, abs);
      } catch (err) {
        await unlink(tmp).catch(() => {});
        throw err;
      }
    });
  }
  const writeQuietly = (run) => writeNow(run).catch((err) => console.error('run record write failed:', err?.code ?? err?.name));

  function scheduleWrite(run) {
    run.dirty = true;
    if (run.writeTimer) return;
    run.writeTimer = setTimeout(() => {
      run.writeTimer = null;
      if (run.dirty) writeQuietly(run);
    }, writeDelayMs);
    run.writeTimer.unref?.();
  }

  // Keep the newest `keep` runs and every run younger than `keepDays`; a run still in memory is never dropped.
  async function prune(rel) {
    await runs.serial(async () => {
      const dir = await runs.dirOf(rel);
      const ids = (await readdir(dir).catch(() => []))
        .filter((n) => n.endsWith('.json') && RUN_ID.test(n.slice(0, -5)))
        .map((n) => n.slice(0, -5))
        .sort()
        .reverse();
      const cutoff = now() - keepDays * DAY;
      for (const id of ids.slice(keep)) {
        if (active.has(id) || Number(id.slice(0, 13)) >= cutoff) continue;
        await unlink(join(dir, `${id}.json`)).catch(() => {});
      }
    });
  }

  function newRunId() {
    let id;
    do id = `${String(now()).padStart(13, '0')}-${randomBytes(4).toString('hex')}`;
    while (active.has(id));
    return id;
  }

  /** Start recording a run of `plan` (the file's plan as started, read at `revision`). Returns the new record. */
  async function startRun({ file, plan, revision }) {
    const rel = runs.fileRel(file);
    let planned;
    try {
      planned = planForRun(plan, revision);
    } catch (err) {
      throw new StoreError(400, err.message);
    }
    const t = now();
    const record = {
      v: RECORD_VERSION,
      id: newRunId(),
      file: rel,
      plan: planned.plan,
      startedAt: t,
      endedAt: null,
      state: 'running',
      steps: Object.fromEntries(planned.stepIds.map((id) => [id, { state: 'pending', startedAt: null, endedAt: null, sessions: [] }])),
      totals: { cost: 0, mtok: 0 },
      timeline: [],
    };
    const run = { record, loc: { path: rel }, writeTimer: null, dirty: false };
    active.set(record.id, run);
    await writeNow(run);
    await prune(rel).catch(() => {}); // after the write, so the new run counts toward the newest `keep`
    hub?.broadcast('run', { file: rel, runId: record.id, run: summaryOf(record) });
    return structuredClone(record);
  }

  const stepOf = (run, stepId) => {
    const step = run.record.steps[stepId];
    if (!step) throw new StoreError(404, 'step not in this run');
    return step;
  };

  function noteStepState(run, stepId, step) {
    const before = step.state;
    const after = stepStateOf(step);
    if (after === before) return null;
    const t = now();
    step.state = after;
    if (step.startedAt === null && after !== 'pending' && after !== 'skipped') step.startedAt = t;
    step.endedAt = after === 'done' || after === 'skipped' ? t : null;
    run.record.timeline.push([t, stepId, after]);
    if (run.record.timeline.length > TIMELINE_MAX) run.record.timeline.splice(0, run.record.timeline.length - TIMELINE_MAX);
    return after;
  }

  // At most one `run` event per session per eventGapMs; patches in between are merged.
  function emitSession(run, stepId, sid, patch, stepState) {
    const key = `${run.record.id}\0${sid}`;
    let p = pending.get(key);
    if (!p) pending.set(key, (p = { last: 0, timer: null, patch: {}, step: stepId, stepState: undefined }));
    Object.assign(p.patch, patch);
    p.step = stepId;
    if (stepState !== undefined) p.stepState = stepState;
    const send = () => {
      p.timer = null;
      p.last = now();
      const data = { file: run.record.file, runId: run.record.id, step: p.step, session: { sid, ...p.patch } };
      if (p.stepState !== undefined) data.state = p.stepState;
      p.patch = {};
      p.stepState = undefined;
      hub?.broadcast('run', data);
    };
    if (p.timer) return;
    const wait = p.last + eventGapMs - now();
    if (wait <= 0) send();
    else {
      p.timer = setTimeout(send, wait);
      p.timer.unref?.();
    }
  }
  function flushEvents(runId) {
    for (const [key, p] of pending) {
      if (!key.startsWith(runId + '\0')) continue;
      if (p.timer) {
        clearTimeout(p.timer);
        p.timer = null;
        const sid = key.slice(runId.length + 1);
        const run = active.get(runId);
        if (run) {
          const data = { file: run.record.file, runId, step: p.step, session: { sid, ...p.patch } };
          if (p.stepState !== undefined) data.state = p.stepState;
          hub?.broadcast('run', data);
        }
      }
      pending.delete(key);
    }
  }

  /**
   * Record a session's metadata under a step: a whole Dispatch session object or a patch with `sid`.
   * Only whitelisted fields are kept (see record.js pickSession). Returns the step's state.
   */
  function updateSession(runId, stepId, session) {
    const run = get(runId);
    const step = stepOf(run, stepId);
    const patch = pickSession(session);
    if (!patch.sid) throw new StoreError(400, 'session sid is required');
    let cur = step.sessions.find((s) => s.sid === patch.sid);
    if (!cur) step.sessions.push((cur = { sid: patch.sid }));
    const changed = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'sid') continue;
      if (JSON.stringify(cur[k]) !== JSON.stringify(v)) changed[k] = v;
      cur[k] = v;
    }
    const stepState = noteStepState(run, stepId, step);
    if (Object.keys(changed).length === 0 && stepState === null) return step.state;
    run.record.totals = totalsOf(run.record);
    scheduleWrite(run);
    emitSession(run, stepId, patch.sid, changed, stepState ?? undefined);
    return step.state;
  }

  /** Set a step that has no sessions to pending / skipped / blocked. */
  function setStepState(runId, stepId, state) {
    const run = get(runId);
    const step = stepOf(run, stepId);
    if (!STEP_STATES_WITHOUT_SESSIONS.includes(state)) throw new StoreError(400, 'invalid step state');
    if (step.sessions.length > 0) throw new StoreError(409, 'step has sessions; its state follows them');
    if (step.state === state) return;
    const t = now();
    step.state = state;
    if (state === 'blocked' && step.startedAt === null) step.startedAt = t;
    step.endedAt = state === 'skipped' ? t : null;
    run.record.timeline.push([t, stepId, state]);
    if (run.record.timeline.length > TIMELINE_MAX) run.record.timeline.splice(0, run.record.timeline.length - TIMELINE_MAX);
    scheduleWrite(run);
    hub?.broadcast('run', { file: run.record.file, runId, step: stepId, state });
  }

  /**
   * The lead's one plain line about a step (note_step): kept on the step as `note`, at most NOTE_MAX characters
   * on one line. The caller masks keys and emails first; this only trims and caps.
   */
  function noteStep(runId, stepId, text) {
    const run = get(runId);
    const step = stepOf(run, stepId);
    const note = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '';
    if (!note) throw new StoreError(400, 'note text is required');
    step.note = note;
    step.noteAt = now();
    scheduleWrite(run);
    hub?.broadcast('run', { file: run.record.file, runId, step: stepId, note });
    return note;
  }

  /** Step ids of a running run, in plan order (null when the run is not running here). */
  const stepsOf = (runId) => {
    const run = active.get(runId);
    return run ? Object.keys(run.record.steps) : null;
  };

  /**
   * Finish a run (done / failed / stopped): written at once and dropped from memory. `results` ({ [stepId]:
   * { commit?, base?, abandoned? } }) says how the board closed each step (E28): merged at a commit, or abandoned
   * (그만둠). An abandoned step without sessions becomes `skipped`.
   */
  async function endRun(runId, state = 'done', { results = null } = {}) {
    const run = get(runId);
    if (!RUN_STATES.includes(state) || state === 'running') throw new StoreError(400, 'invalid run state');
    flushEvents(runId);
    for (const [id, r] of Object.entries(results ?? {})) {
      const step = run.record.steps[id];
      const result = pickResult(r);
      if (!step || !result) continue;
      step.result = result;
      if (result.abandoned && step.sessions.length === 0 && step.state !== 'skipped') {
        step.state = 'skipped';
        step.endedAt = now();
        run.record.timeline.push([step.endedAt, id, 'skipped']);
      }
    }
    run.record.state = state;
    run.record.endedAt = now();
    run.record.totals = totalsOf(run.record);
    // Stay in `active` until the last write is done (or failed), so a move meanwhile still updates run.loc.
    try {
      await writeNow(run);
      while (run.dirty) await writeNow(run); // a move landed after the write: record the new location too
    } finally {
      active.delete(runId);
    }
    hub?.broadcast('run', { file: run.record.file, runId, run: summaryOf(run.record) });
    return structuredClone(run.record);
  }

  // ---- reading (web API) ----

  /** A run counts as running while it is in memory, not in the trash, and its record still says `running`. */
  const isRunning = (run) => !run.loc.trashId && run.record.state === 'running';
  async function readRecord(abs) {
    const st = await lstat(abs).catch(() => null);
    if (!st?.isFile()) return null;
    try {
      const r = JSON.parse(await readFile(abs, 'utf8'));
      return r && r.v === RECORD_VERSION && typeof r.id === 'string' ? r : null;
    } catch {
      return null;
    }
  }

  async function list(path) {
    const rel = runs.fileRel(path);
    const dir = await runs.dirOf(rel);
    const out = [];
    for (const n of (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json') && RUN_ID.test(n.slice(0, -5)))) {
      const id = n.slice(0, -5);
      const live = active.get(id);
      const r = live && !live.loc.trashId && live.loc.path === rel ? live.record : await readRecord(join(dir, n));
      if (r) out.push(summaryOf(r));
    }
    out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return { runs: out };
  }

  async function read(path, id) {
    const rel = runs.fileRel(path);
    if (typeof id !== 'string' || !RUN_ID.test(id)) throw new StoreError(400, 'invalid run id');
    const live = active.get(id);
    if (live && !live.loc.trashId && live.loc.path === rel) return structuredClone(live.record);
    const r = await readRecord(join(await runs.dirOf(rel), `${id}.json`));
    if (!r) throw new StoreError(404, 'run not found');
    return r;
  }

  /**
   * The tree mark of a pipeline file from its runs: running while a run is in memory, else from the newest record
   * (done -> done; failed, stopped or a run left `running` by a server stop -> paused). Null when it has no runs.
   */
  async function markOf(rel) {
    // Same rule as runningFiles(), so the tree mark and /api/runs/active never disagree.
    for (const run of active.values()) if (isRunning(run) && run.loc.path === rel) return { state: 'running' };
    const dir = await runs.dirOf(rel);
    const ids = (await readdir(dir).catch(() => []))
      .filter((n) => n.endsWith('.json') && RUN_ID.test(n.slice(0, -5)))
      .sort()
      .reverse();
    for (const n of ids) {
      const r = await readRecord(join(dir, n));
      if (r) return { state: r.state === 'done' ? 'done' : 'paused' };
    }
    return null;
  }

  /** Write every dirty run now (server shutdown). Running runs stay `running` on disk. */
  async function close() {
    unsubscribe();
    for (const p of pending.values()) if (p.timer) clearTimeout(p.timer);
    pending.clear();
    for (const run of active.values()) if (run.dirty || run.writeTimer) await writeQuietly(run);
  }

  /** Workspace-relative paths of files with a run going now (not in the trash), sorted, no repeats. */
  function runningFiles() {
    const out = new Set();
    for (const run of active.values()) if (isRunning(run)) out.add(run.loc.path);
    return [...out].sort();
  }

  return { startRun, updateSession, setStepState, noteStep, stepsOf, endRun, list, read, markOf, runningFiles, close, get active() { return [...active.keys()]; } };
}
