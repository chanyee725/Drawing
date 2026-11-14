// Run record shape (docs/design/dispatch-integration/2-file-format-and-live-overlay.md §4).
// Metadata only: step states, times, model, token counts, cost, branch, commit, PR number.
// Never transcripts, prompts, a session's answers, questions, tool output, emails or keys.

export const RECORD_VERSION = 1;
export const RUN_ID = /^\d{13}-[0-9a-f]{6,16}$/;
export const TIMELINE_MAX = 500;
export const RUN_FILE_MAX = 256 * 1024;

export const SESSION_STATES = ['working', 'waiting', 'stuck', 'failed', 'resting', 'done'];
// Worst first: a step shows the worst state among its sessions.
const SEVERITY = ['failed', 'stuck', 'waiting', 'working', 'resting', 'done'];
export const STEP_STATES_WITHOUT_SESSIONS = ['pending', 'skipped', 'blocked'];
export const RUN_STATES = ['running', 'paused', 'done', 'failed', 'stopped'];
/** Why a run is paused (E27): the usage-limit guard, or the person pressed 멈추기. */
export const PAUSE_BY = ['limit', 'stop'];

const SHORT = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// Strings are kept only when they look like a short token and not like an email address (never stored, even in a branch name).
const short = (v) => (typeof v === 'string' && SHORT.test(v) && !EMAIL.test(v) ? v : undefined);

/**
 * Keep only whitelisted metadata from a session object (Dispatch session or a patch of one).
 * Unknown keys (a session's `last` answer, questions, prompts...) are dropped, and strings must be short
 * tokens (ids, model names, branch names), so free text can never slip in through a known key.
 * Returns only the keys present and valid in `s`.
 */
export function pickSession(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  for (const k of ['sid', 'name', 'provider', 'model', 'effort', 'branch']) {
    const v = short(s[k]);
    if (v !== undefined) out[k] = v;
  }
  if (typeof s.commit === 'string' && /^[0-9a-f]{4,40}$/.test(s.commit)) out.commit = s.commit;
  if (SESSION_STATES.includes(s.state)) out.state = s.state;
  for (const k of ['stateSince', 'cost', 'ctxPct']) {
    const v = num(s[k]);
    if (v !== undefined) out[k] = v;
  }
  if (s.tokens && typeof s.tokens === 'object') {
    const t = {};
    for (const k of TOKEN_KEYS) {
      const v = num(s.tokens[k]);
      if (v !== undefined) t[k] = v;
    }
    out.tokens = t;
  }
  if (s.pr === null) out.pr = null;
  else if (s.pr && Number.isInteger(s.pr.number) && s.pr.number > 0) {
    out.pr = { number: s.pr.number, state: typeof s.pr.state === 'string' && /^[a-z_]{1,16}$/i.test(s.pr.state) ? s.pr.state.toLowerCase() : null };
  }
  // A short kind tag ("question", "limit"), never the question itself.
  if (s.attention === null) out.attention = null;
  else if (typeof s.attention === 'string' && /^[a-z_-]{1,32}$/.test(s.attention)) out.attention = s.attention;
  return out;
}

/** How a step closed (E28): { commit, base? } when merged, { abandoned: true } when dropped; null when neither. */
export function pickResult(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.abandoned === true) return { abandoned: true };
  if (typeof r.commit !== 'string' || !/^[0-9a-f]{4,40}$/.test(r.commit)) return null;
  const base = short(r.base);
  return { commit: r.commit, ...(base && { base }) };
}

/** A later close of the same step: a merged commit stays when the step is closed again without one (그만둠). */
export function mergeResult(prev, next) {
  if (!next) return prev ?? null;
  if (next.abandoned && prev?.commit) return prev;
  return next;
}

export function stepStateOf(step) {
  // Finished in an earlier run (계획 다시 열기, E27): its sessions may still report (the session that did it goes idle,
  // or a later run's events relink it through its old task), but the step stays done.
  if (step.carried) return 'done';
  const states = step.sessions.map((s) => s.state).filter(Boolean);
  if (states.length === 0) return step.state;
  for (const st of SEVERITY) if (states.includes(st)) return st;
  return step.state;
}

export function totalsOf(record) {
  let cost = 0;
  let tokens = 0;
  for (const step of Object.values(record.steps)) {
    for (const s of step.sessions) {
      cost += s.cost ?? 0;
      for (const k of TOKEN_KEYS) tokens += s.tokens?.[k] ?? 0;
    }
  }
  return { cost: Math.round(cost * 100) / 100, mtok: Math.round(tokens / 1e5) / 10 };
}

/** Serialize, dropping the oldest timeline entries while the file is past the size cap. */
export function serializeRecord(record, max = RUN_FILE_MAX) {
  let text = JSON.stringify(record, null, 2) + '\n';
  while (Buffer.byteLength(text) > max && record.timeline.length > 0) {
    const over = Buffer.byteLength(text) - max;
    // Each entry is ~50 bytes pretty-printed; drop in chunks, at least one.
    record.timeline.splice(0, Math.max(1, Math.ceil(over / 50)));
    text = JSON.stringify(record, null, 2) + '\n';
  }
  return text;
}

export const summaryOf = (r) => ({ id: r.id, startedAt: r.startedAt, endedAt: r.endedAt, state: r.state, totals: r.totals, pause: r.pause ?? null });
