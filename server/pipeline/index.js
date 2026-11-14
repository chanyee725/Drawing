// Pipeline module (E20): the lead writes a plan into a workspace file (write_plan), the person checks it and
// presses 시작하기, and only then may the lead create teammates. See docs/design/dispatch-integration/3-ux-flow.md
// §2-3 and 4-operations-and-rules.md G2.
//
// Approval state lives in the Dispatch state file as metadata only:
//   store.data.pipelines[path] = { lead, state: 'plan' | 'running' | 'paused' | 'done', draftRevision,
//                                  approvedRevision, approvedAt, runId, steps, links, pause?, carry?, doneAt? }
// `steps` is the approved step ids and `links` maps a session id to its step. E27: `pause` is { by: 'limit' |
// 'stop', at, resetAt? } while paused; `carry` is { from: runId, steps: [ids], results? } after 계획 다시 열기, the steps the
// stopped run finished, so the next 시작하기 marks them done instead of running them again. The lead's draft plan (for the
// "바뀐 점" list) is kept in memory only, so after a restart the list is empty.
// E28: once the board closes every step the run ends `done`, the server writes the 완료 summary block into the
// document once, and the history labels the draft, approved and done versions. A done plan is a record: running it
// again means 복제해서 새 계획 (POST /api/pipeline/duplicate), a fresh draft without the summary.
import { StoreError } from '../workspace/store.js';
import { FILE_EXT } from '../workspace/model.js';
import { redact } from '../dispatch/redact.js';
import { mergeResult, pickResult } from '../runs/record.js';
import { effectiveRoles } from '../dispatch/settings.js';
import { buildPlanFile, planChanges, writePlanProblem, PLAN_BLOCK_ID } from '../../shared/dispatch/plan-write.ts';
import { resolvedStep } from '../../shared/dispatch/plan.ts';
import { planOrderIn } from '../../shared/dispatch/plan-diagram.ts';
import { nodeLabels, summaryNodes, withSummary, withoutSummary } from '../../shared/dispatch/run-summary.ts';

const MAX_BODY = 1024 * 1024;
export const PIPELINE_DIR = 'pipelines';
const PROVIDER_NAMES = { claude: 'Claude', openai: 'OpenAI Codex', gemini: 'Gemini' };

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new StoreError(413, 'body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') ?? {};
  } catch {
    throw new StoreError(400, 'invalid JSON');
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** A file name from a plan title: letters (any script), digits, `-` and `_`; spaces become `-`. */
export function planFileName(title) {
  const stem = String(title ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
  return stem || 'plan';
}

/** Session fields a run record keeps (record.js pickSession drops anything else). */
function sessionMeta(s) {
  const ctxPct = s.ctxWindow > 0 ? Math.round((100 * (s.ctx || 0)) / s.ctxWindow) : undefined;
  return {
    sid: s.id, name: s.name, provider: s.provider, model: s.model, effort: s.effort ?? undefined, branch: s.branch ?? undefined,
    state: s.state, stateSince: s.stateSince, cost: s.cost ?? undefined, ctxPct, tokens: s.usage,
    ...(s.pr !== undefined && { pr: s.pr }),
  };
}

export async function setup(ctx) {
  const ws = ctx.modules.workspace?.store;
  const recorder = ctx.modules.runs?.recorder;
  if (!ws || !recorder) return {};
  const dispatch = () => (ctx.modules.dispatch?.status?.().enabled ? ctx.modules.dispatch : null);
  const drafts = new Map(); // path -> the plan as the lead last wrote it (memory only)

  const entries = () => {
    const d = dispatch();
    if (!d) return null;
    return (d.store.data.pipelines ||= {});
  };
  const save = () => dispatch()?.store.save();
  const changed = (path) => {
    const e = entries()?.[path];
    ctx.hub.broadcast('pipeline', { path, state: e?.state ?? null });
  };
  const leadEntries = (lead, state) =>
    Object.entries(entries() ?? {})
      .filter(([, e]) => e.lead === lead && (!state || (Array.isArray(state) ? state.includes(e.state) : e.state === state)))
      .sort((a, b) => (b[1].approvedAt ?? 0) - (a[1].approvedAt ?? 0));

  // ---- hub hooks ----
  const d0 = dispatch();
  if (d0) {
    const hub = d0.hub;
    hub.createGate = (parent) => {
      if (leadEntries(parent, 'plan').length) return '계획 승인 전이에요. 사용자가 시작하기를 누르면 [계획 승인] 메시지가 와요';
      if (leadEntries(parent, 'paused').length && !leadEntries(parent, 'running').length) return '계획이 멈춰 있어요. 이어서 하기를 기다려 주세요';
      return null;
    };
    hub.holdTeam = (lead) => leadEntries(lead, 'paused').some(([, e]) => e.pause?.by === 'stop');
    hub.ticketNote = (lead) =>
      leadEntries(lead, 'paused')
        .filter(([, e]) => e.pause?.by === 'limit')
        .map(([path, e]) => `[계획 이어서 하기 · rev ${e.approvedRevision}] ${path}\n끝나지 않은 단계: ${openSteps(e).join(', ') || '(없음)'}`)
        .join('\n');
    hub.taskStepCheck = (lead, step) => {
      const running = leadEntries(lead, 'running');
      if (!running.length) return '실행 중인 계획이 없어요';
      if (!running.some(([, e]) => e.steps?.includes(step))) return `승인된 계획에 단계 "${step.slice(0, 40)}"가 없어요`;
      return null;
    };
    // Session metadata goes to the run record of its lead's running plan, under the step its task names.
    // `skip` holds plans whose run record could not be read (missing, corrupt, another runId) during this pass.
    // `unreadable` remembers, per plan and run, a read that failed, so later events do not read it again.
    const unreadable = new Set();
    const follow = (s, skip = new Set()) => {
      if (!s?.parent) return;
      for (const [path, e] of leadEntries(s.parent, ['running', 'paused'])) {
        if (skip.has(path)) continue;
        const links = (e.links ||= {});
        let step = links[s.id];
        if (!step) {
          // A paused run a server restart dropped from memory: which steps it carried over is on disk. Read that
          // first and look again, so a link is never saved to a carried step meanwhile. Stop here rather than try
          // the next plan, or the session could end up linked to both. Look again with the session as it is then,
          // so an event that came in meanwhile is not rolled back. A session deleted during the read is skipped. If
          // the read fails, its carried steps stay unknown: look again without that plan, so the session can still
          // be linked to the lead's other plans.
          if (e.runId && recorder.isCarried(e.runId, '') === null) {
            if (unreadable.has(`${path}\0${e.runId}`)) continue;
            const runId = e.runId;
            void recorder.readCarried(path, runId).then((ok) => {
              if (!ok) unreadable.add(`${path}\0${runId}`);
              const now = hub.get(s.id);
              if (now) follow(hub.publicSession(now), ok ? skip : new Set([...skip, path]));
            });
            return;
          }
          // Only tasks of this run: open ones, or ones closed after its 시작하기. A task an earlier run closed (a step
          // 계획 다시 열기 carried over) must not pull the session that did it into this run, or new work it gets
          // lands on the carried step. The same goes for that old task reopened (same id, same step): a carried step
          // stays done, so it never takes a session.
          const since = e.approvedAt ?? 0;
          const task = hub.tasks.find(
            (t) =>
              t.lead === s.parent &&
              t.step &&
              t.owner === s.name &&
              e.steps?.includes(t.step) &&
              (t.stage !== 'done' || (t.stageAt ?? 0) >= since) &&
              !recorder.isCarried(e.runId, t.step),
          );
          if (!task) continue;
          step = links[s.id] = task.step;
          save();
        }
        try {
          recorder.updateSession(e.runId, step, sessionMeta(s));
        } catch {
          /* the run ended or the step is gone: nothing to record */
        }
        return;
      }
    };
    hub.on('session', (s) => follow(s));
    // A task that names a step and an owner links that owner's session (set_task often comes after create_sessions).
    hub.on('tasks', () => {
      for (const s of hub.sessions) if (s.parent && leadEntries(s.parent, ['running', 'paused']).length) follow(hub.publicSession(s));
      void finishClosed();
    });
    // The usage-limit guard pauses running plans and resumes the ones it paused once the window clears (G1).
    hub.on('limits', () => syncLimit());
    hub.on('tickets', () => syncLimit());
  }

  // File moves carry the approval state along (a folder move moves every file under it).
  const unsubscribe = ws.runs.onChange((e) => {
    if (e.kind !== 'move') return;
    const all = entries();
    if (!all) return;
    let moved = false;
    for (const p of Object.keys(all)) {
      if (p !== e.from && !p.startsWith(e.from + '/')) continue;
      const to = e.to + p.slice(e.from.length);
      all[to] = all[p];
      delete all[p];
      if (drafts.has(p)) {
        drafts.set(to, drafts.get(p));
        drafts.delete(p);
      }
      moved = true;
    }
    if (moved) save();
  });

  const readOrNull = (path) =>
    ws.readFile(path).catch((err) => {
      if (err instanceof StoreError && err.status === 404) return null;
      if (err?.code === 'ENOENT') return null;
      throw err;
    });

  /** Why this file cannot start now (empty when it can), and what it would start. */
  function check(path, file, entry) {
    const blockers = [];
    const d = dispatch();
    const plan = file?.plan ?? null;
    const steps = plan?.steps ?? [];
    let sessions = 0;
    let usesClaude = false;
    if (!d) blockers.push('Dispatch가 꺼져 있어요');
    if (!plan || steps.length === 0) blockers.push('단계가 없어요');
    if (!entry) blockers.push('관리자가 쓴 계획이 아니에요');
    else if (d && !d.hub.get(entry.lead)) blockers.push('계획을 쓴 관리자 세션이 없어요');
    if (plan && steps.length) {
      const roles = d ? effectiveRoles(d.hub.roles, d.store) : [];
      const missing = new Set();
      for (const raw of steps) {
        const s = resolvedStep(plan, raw);
        sessions += s.n ?? 1;
        if (!s.role) {
          blockers.push(`단계 ${s.id}에 역할이 없어요`);
          continue;
        }
        if (!d) continue;
        const role = roles.find((r) => r.id === s.role);
        if (!role) {
          blockers.push(`단계 ${s.id}의 역할 "${s.role.slice(0, 40)}"을 몰라요`);
          continue;
        }
        const modelId = s.model || role.model;
        const model = d.models.find((m) => m.id === modelId);
        if (!model) blockers.push(`단계 ${s.id}의 모델 "${String(modelId).slice(0, 60)}"을 몰라요`);
        else if (!d.hub.isConnected(model.provider)) missing.add(model.provider);
        else if (model.provider === 'claude') usesClaude = true;
      }
      for (const p of missing) blockers.push(`${PROVIDER_NAMES[p] ?? p}가 연결되지 않았어요`);
      const order = planOrderIn(plan, file.blocks ?? []);
      if (!order.ok) blockers.push(order.cycle ? `단계가 서로를 기다려요: ${order.cycle.join(' > ')}` : '단계 순서를 알 수 없어요');
      const guard = d && usesClaude ? d.hub.guardCheck(sessions) : null;
      if (guard) blockers.push(guard);
    }
    return { blockers, sessions };
  }

  async function status(path) {
    path = ws.runs.fileRel(path);
    const file = await readOrNull(path);
    if (!file) throw new StoreError(404, 'not found');
    const entry = entries()?.[path] ?? null;
    const state = entry?.state ?? (file.plan ? 'plan' : null);
    const { blockers, sessions } =
      state === 'running' || state === 'done' ? { blockers: [], sessions: 0 } : state === 'paused' ? { blockers: resumeBlockers(entry), sessions: 0 } : check(path, file, entry);
    const l = dispatch()?.hub.currentLimits() ?? null;
    return {
      path,
      revision: file.revision,
      state,
      lead: entry?.lead ?? null,
      draftRevision: entry?.draftRevision ?? null,
      approvedRevision: entry?.approvedRevision ?? null,
      approvedAt: entry?.approvedAt ?? null,
      runId: entry?.runId ?? null,
      pause: state === 'paused' ? (entry.pause ?? null) : null,
      doneAt: state === 'done' ? (entry.doneAt ?? null) : null,
      blockers,
      changes: state === 'plan' && entry ? planChanges(drafts.get(path), file.plan) : [],
      sessions,
      limits: l ? { five: l.five ?? null, seven: l.seven ?? null, fiveReset: l.fiveReset ?? null, sevenReset: l.sevenReset ?? null } : null,
    };
  }

  // ---- write_plan ----
  async function freePath(title, dir = PIPELINE_DIR) {
    const stem = `${dir ? `${dir}/` : ''}${planFileName(title)}`;
    for (let i = 1; i < 100; i++) {
      const p = `${stem}${i === 1 ? '' : `-${i}`}${FILE_EXT}`;
      if (!(await readOrNull(p))) return p;
    }
    throw new StoreError(409, '같은 이름의 계획이 너무 많아요');
  }

  async function writePlan(body) {
    const d = dispatch();
    if (!d) throw new StoreError(409, 'Dispatch가 꺼져 있어요');
    const lead = typeof body.lead === 'string' ? d.hub.get(body.lead) : null;
    if (!lead || !lead.canSpawn) throw new StoreError(400, '관리자 세션만 계획을 쓸 수 있어요');
    const input = { title: body.title, goal: body.goal, steps: body.steps, risks: body.risks, asks: body.asks };
    const problem = writePlanProblem(input);
    if (problem) throw new StoreError(400, problem);
    const all = entries();
    let path;
    if (typeof body.path === 'string' && body.path.trim()) path = ws.runs.fileRel(body.path.trim().endsWith(FILE_EXT) ? body.path.trim() : body.path.trim() + FILE_EXT);
    else {
      // Without a path, a lead revises its own draft.
      const own = leadEntries(lead.id, 'plan')[0];
      path = own ? own[0] : null;
    }
    const existing = path ? all[path] : null;
    if (existing?.state === 'paused') throw new StoreError(409, '멈춘 계획이에요. 사용자가 계획 다시 열기를 누르면 고칠 수 있어요');
    if (existing?.state === 'running') throw new StoreError(409, '실행 중인 계획은 바꿀 수 없어요. 바뀐 점은 note_step으로 남겨 주세요');
    if (existing?.state === 'done') throw new StoreError(409, '완료된 계획이에요. 사용자가 복제해서 새 계획을 누르면 그 파일을 고칠 수 있어요');
    if (existing && existing.lead !== lead.id) throw new StoreError(409, '다른 관리자가 쓴 계획이에요');
    const current = path ? await readOrNull(path) : null;
    if (current && !existing && current.plan) throw new StoreError(409, '사람이 쓴 계획 파일이에요. path 없이 새로 써 주세요');
    let revision;
    let built;
    if (current) {
      const prevId = current.plan?.block ?? PLAN_BLOCK_ID;
      const prev = (current.blocks ?? []).find((b) => b.id === prevId) ?? null;
      built = buildPlanFile(input, prev);
      const blocks = prev ? current.blocks.map((b) => (b.id === prev.id ? built.block : b)) : [...(current.blocks ?? []), built.block];
      const r = await ws.writeFile(path, { revision: current.revision, title: built.title, document: built.document, canvas: current.canvas, blocks, plan: built.plan });
      revision = r.revision;
    } else {
      built = buildPlanFile(input, null);
      path ??= await freePath(built.title);
      const r = await ws.createFile(path, { title: built.title, document: built.document, blocks: [built.block], plan: built.plan });
      path = r.path;
      revision = r.revision;
    }
    all[path] = { lead: lead.id, state: 'plan', draftRevision: revision, approvedRevision: null, approvedAt: null, runId: null, steps: [], links: {}, ...(existing?.carry && { carry: existing.carry }) };
    drafts.set(path, built.plan);
    save();
    await ws.labelVersion(path, 'draft');
    ctx.hub.broadcast('workspace', { kind: 'change', path, revision });
    changed(path);
    const out = { path, revision, state: 'plan' };
    if (body.autostart === true && built.plan.steps.length === 1) {
      const started = await start({ path, revision }, { auto: true });
      return { ...out, state: 'running', runId: started.runId };
    }
    return out;
  }

  // ---- 시작하기 ----
  async function start(body, { auto = false } = {}) {
    const d = dispatch();
    if (!d) throw new StoreError(409, 'Dispatch가 꺼져 있어요');
    if (typeof body.path !== 'string') throw new StoreError(400, 'path is required');
    const path = ws.runs.fileRel(body.path);
    if (!Number.isInteger(body.revision)) throw new StoreError(400, 'revision is required');
    const entry = entries()[path];
    if (entry?.state === 'running') throw new StoreError(409, '이미 실행 중이에요');
    if (entry?.state === 'paused') throw new StoreError(409, '멈춘 계획이에요. 이어서 하기나 계획 다시 열기를 눌러 주세요');
    if (entry?.state === 'done') throw new StoreError(409, '완료된 계획이에요. 다시 돌리려면 복제해서 새 계획을 눌러 주세요');
    const file = await readOrNull(path);
    if (!file) throw new StoreError(404, 'not found');
    if (file.revision !== body.revision) throw new StoreError(409, '계획이 바뀌었어요. 다시 확인해 주세요', { revision: file.revision });
    const { blockers } = check(path, file, entry);
    if (blockers.length) throw new StoreError(409, blockers[0], { blockers });
    const changes = planChanges(drafts.get(path), file.plan);
    const carry = await carryOf(path, entry);
    const record = await recorder.startRun({ file: path, plan: file.plan, revision: file.revision, carry });
    const carried = Object.keys(record.steps).filter((id) => record.steps[id].carried);
    const prevCarry = entry.carry;
    delete entry.carry;
    Object.assign(entry, { state: 'running', approvedRevision: file.revision, approvedAt: Date.now(), runId: record.id, steps: Object.keys(record.steps), links: {} });
    save();
    const lines = [
      `[계획 승인 · rev ${file.revision}] ${path}`,
      auto ? '단계 하나짜리 계획이라 바로 시작했다.' : '사용자가 이 계획으로 시작하기를 눌렀다.',
      changes.length ? `바뀐 점(네 초안 이후 사용자가 고친 것):\n${changes.map((c) => `- ${c}`).join('\n')}` : '바뀐 점: 없음',
      ...(carried.length ? [`지난 실행에서 끝난 단계(다시 하지 마라): ${carried.join(', ')}`] : []),
      `승인된 리비전을 따른다. 단계마다 create_sessions로 팀원을 만들고, set_task에 step(${record && Object.keys(record.steps).join(', ')})과 owner(세션 이름)를 넣는다. 단계에 남길 한 줄은 note_step으로 남긴다.`,
    ];
    try {
      d.hub.send(entry.lead, lines.join('\n'));
    } catch (err) {
      // The lead never heard of it: the run did not really start.
      Object.assign(entry, { state: 'plan', approvedRevision: null, approvedAt: null, runId: null, steps: [], ...(prevCarry && { carry: prevCarry }) });
      save();
      await recorder.endRun(record.id, 'stopped').catch(() => {});
      throw new StoreError(409, err.message);
    }
    await ws.labelVersion(path, 'approved');
    changed(path);
    return { path, state: 'running', runId: record.id, revision: file.revision, changes };
  }

  // ---- 멈추기 · 이어서 하기 · 계획 다시 열기 (E27) ----

  /**
   * Board tasks this run closed: the lead's step tasks that went done after this run's 시작하기. A duplicated plan
   * keeps the lead and step ids, so tasks an earlier run closed must not count for it.
   */
  function closedTasks(e) {
    const since = e.approvedAt ?? 0;
    return (dispatch()?.hub.tasks ?? []).filter((t) => t.lead === e.lead && t.step && t.stage === 'done' && (t.stageAt ?? 0) >= since);
  }

  /** Steps of a running or paused plan the board has not closed yet, in plan order. */
  function openSteps(e) {
    const done = new Set(closedTasks(e).map((t) => t.step));
    return (e.steps ?? []).filter((id) => !done.has(id));
  }

  const clock = (t) => {
    const d = new Date(t);
    return `${d.getHours()}시 ${String(d.getMinutes()).padStart(2, '0')}분`;
  };

  /** Why a paused plan cannot continue now (empty when it can). */
  function resumeBlockers(e) {
    const d = dispatch();
    if (!d) return ['Dispatch가 꺼져 있어요'];
    if (!d.hub.get(e.lead) || d.hub.get(e.lead).status === 'done') return ['계획을 쓴 관리자 세션이 없어요'];
    const hit = d.hub.limitHit();
    if (hit) return [`한도에 걸려 있어요 (${hit.reason}).${hit.resetAt ? ` ${clock(hit.resetAt)}에 초기화돼요` : ''}`];
    return [];
  }

  const entryAt = (body) => {
    if (!dispatch()) throw new StoreError(409, 'Dispatch가 꺼져 있어요');
    if (typeof body?.path !== 'string') throw new StoreError(400, 'path is required');
    const path = ws.runs.fileRel(body.path);
    const e = entries()[path];
    if (!e) throw new StoreError(404, '관리자가 쓴 계획이 아니에요');
    return [path, e];
  };

  // The run record may be gone (deleted, or a restart lost a run that never wrote): the plan state still changes.
  const quietly = (p) => p.catch((err) => {
    if (!(err instanceof StoreError)) console.error('pipeline run record:', err?.code ?? err?.name);
    return null;
  });

  /** Running -> paused. `by`: 'stop' (멈추기) or 'limit' (usage-limit guard, which interrupts sessions itself). */
  async function pauseEntry(path, e, by, resetAt = null) {
    e.state = 'paused';
    e.pause = { by, at: Date.now(), ...(Number.isFinite(resetAt) && resetAt > 0 && { resetAt }) };
    save();
    changed(path);
    if (e.runId) await quietly(recorder.pauseRun(e.runId, { by, resetAt, file: path }));
  }

  /** The lead and its teammates that are mid-turn, interrupted through their CLI's own control (no shell). */
  function interruptTeam(lead) {
    const d = dispatch();
    if (!d) return;
    const team = d.hub.sessions.filter((s) => s.id === lead || s.parent === lead);
    for (const s of team) if (['running', 'starting', 'waiting'].includes(s.status)) d.hub.interrupt(s.id);
  }

  async function stop(body) {
    const [path, e] = entryAt(body);
    if (e.state !== 'running') throw new StoreError(409, e.state === 'paused' ? '이미 멈췄어요' : '실행 중인 계획이 아니에요');
    // Paused first, so the reports the interrupted teammates hand over are held until 이어서 하기.
    await pauseEntry(path, e, 'stop');
    interruptTeam(e.lead);
    return status(path);
  }

  /** Paused -> running, and tell the lead which steps are left. */
  async function resumeEntry(path, e, { auto = false } = {}) {
    const d = dispatch();
    const pause = e.pause ?? { by: 'stop', at: 0 };
    const mine = (t) => t.lead === e.lead;
    // A limit ticket of this lead already says what to do; its resume message carries this plan's steps through
    // hub.ticketNote, which reads paused entries, so it goes out before the state flips.
    const open = pause.by === 'limit' ? d.hub.tickets.find((t) => mine(t) && t.status === 'open') : null;
    const ticketTold = open ? d.hub.resumeTicket(open.id) : pause.by === 'limit' && d.hub.tickets.some((t) => mine(t) && t.status === 'resumed' && t.updatedAt >= pause.at);
    e.state = 'running';
    delete e.pause;
    save();
    if (e.runId) await quietly(recorder.resumeRun(path, e.runId));
    if (!ticketTold) {
      const why = pause.by === 'limit' ? '한도가 초기화돼서' : '사용자가 이어서 하기를 눌러서';
      const text = [
        `[계획 이어서 하기 · rev ${e.approvedRevision}] ${path}`,
        `${why} 멈췄던 계획을 이어서 진행한다. 브랜치·git log로 상태를 다시 확인하라.`,
        `끝나지 않은 단계: ${openSteps(e).join(', ') || '(없음)'}`,
        '멈춘 팀원 세션에는 지시를 보내면 이어진다. 팀원이 정리됐으면 필요한 만큼 다시 만들어라.',
      ].join('\n');
      try {
        d.hub.send(e.lead, text);
      } catch (err) {
        if (!auto) {
          await pauseEntry(path, e, pause.by, pause.resetAt);
          throw new StoreError(409, err.message);
        }
      }
    }
    // Reports held while stopped go out now (the watchdog would also deliver them).
    for (const s of d.hub.sessions) if (s.parent === e.lead) d.hub.deliverReport(s);
    changed(path);
  }

  async function resume(body) {
    const [path, e] = entryAt(body);
    if (e.state !== 'paused') throw new StoreError(409, '멈춘 계획이 아니에요');
    const blockers = resumeBlockers(e);
    if (blockers.length) throw new StoreError(409, blockers[0], { blockers });
    await resumeEntry(path, e);
    return status(path);
  }

  /** Paused -> plan: the run ends (stopped) and the steps the board closed carry over to the next 시작하기. */
  async function reopen(body) {
    const [path, e] = entryAt(body);
    if (e.state === 'running') throw new StoreError(409, '실행 중이에요. 먼저 멈추기를 눌러 주세요');
    if (e.state !== 'paused') throw new StoreError(409, '멈춘 계획이 아니에요');
    const file = await readOrNull(path);
    if (!file) throw new StoreError(404, 'not found');
    const d = dispatch();
    const runId = e.runId;
    // Steps this run carried over from an earlier stopped run stay done, with how they closed then.
    const record = runId
      ? await recorder.read(path, runId).catch((err) => {
          // Metadata only: without the record the steps it carried over count as open again.
          console.error('pipeline reopen record:', err?.code ?? err?.name);
          return null;
        })
      : null;
    const carried = Object.keys(record?.steps ?? {}).filter((id) => record.steps[id].carried && e.steps?.includes(id));
    const open = openSteps(e);
    const done = (e.steps ?? []).filter((id) => !open.includes(id) || carried.includes(id));
    // How the board closed them, kept now: the next run only counts tasks closed after its own 시작하기.
    const results = {};
    for (const id of carried) {
      const r = pickResult(record.steps[id].result);
      if (r) results[id] = r;
    }
    for (const [id, r] of Object.entries(resultsOf(e))) {
      const next = mergeResult(results[id], pickResult(r));
      if (next) results[id] = next;
    }
    if (runId) await quietly(recorder.endPaused(path, runId, 'stopped'));
    Object.assign(e, { state: 'plan', draftRevision: file.revision, approvedRevision: null, approvedAt: null, runId: null, steps: [], links: {} });
    delete e.pause;
    if (runId && done.length) e.carry = { from: runId, steps: done, results };
    else delete e.carry;
    drafts.set(path, file.plan);
    save();
    changed(path);
    const text = [
      `[계획 다시 열림] ${path}`,
      '사용자가 계획을 다시 열었다. 시작하기를 다시 누를 때까지 팀원을 새로 만들거나 새 일을 시키지 마라. 고칠 게 있으면 write_plan(path 그대로)으로 고친다.',
      `이미 끝난 단계: ${done.join(', ') || '(없음)'}`,
    ].join('\n');
    try {
      d.hub.send(e.lead, text);
    } catch {
      /* the lead hears it with the next [계획 승인] */
    }
    return status(path);
  }

  /** What the next run takes over from the run 계획 다시 열기 stopped. */
  async function carryOf(path, e) {
    if (!e?.carry?.from || !e.carry.steps?.length) return null;
    const old = await recorder.read(path, e.carry.from).catch(() => null);
    if (!old) return null;
    const steps = {};
    for (const id of e.carry.steps) {
      if (!old.steps?.[id]) continue;
      const result = e.carry.results?.[id];
      steps[id] = result ? { ...old.steps[id], result } : old.steps[id];
    }
    return { from: e.carry.from, steps };
  }

  /** The limit guard pauses running plans; once no window is over its threshold, the plans it paused go on. */
  let syncing = false;
  async function syncLimit() {
    const d = dispatch();
    if (!d || syncing) return;
    syncing = true;
    try {
      const hit = d.hub.limitHit();
      for (const [path, e] of Object.entries(entries() ?? {})) {
        if (hit && e.state === 'running') await pauseEntry(path, e, 'limit', hit.resetAt);
        else if (!hit && e.state === 'paused' && e.pause?.by === 'limit' && d.hub.get(e.lead) && d.hub.get(e.lead).status !== 'done') {
          await resumeEntry(path, e, { auto: true });
        }
      }
    } catch (err) {
      console.error('pipeline limit sync:', err?.message);
    } finally {
      syncing = false;
    }
  }
  // A window can reset without any new event (time passes): look again now and then.
  const limitTimer = setInterval(() => void syncLimit(), 30_000);
  limitTimer.unref?.();

  // ---- 완료 · 복제해서 새 계획 (E28) ----

  /** Steps the board has not closed and the run did not carry over from a stopped run. */
  async function unclosed(path, e) {
    const open = openSteps(e);
    if (!open.length) return open;
    const record = await recorder.read(path, e.runId).catch(() => null);
    return open.filter((id) => !record?.steps?.[id]?.carried);
  }

  /** How the board closed each step: merged at a checked commit, else abandoned (closed without a commit). */
  function resultsOf(e) {
    const out = {};
    for (const t of closedTasks(e)) {
      if (!e.steps?.includes(t.step)) continue;
      if (t.mergeCheck?.ok === true && t.mergeCheck.commit) out[t.step] = { commit: t.mergeCheck.commit, ...(t.mergeCheck.base && { base: t.mergeCheck.base }) };
      else if (!t.commit && !out[t.step]) out[t.step] = { abandoned: true };
    }
    return out;
  }

  /** Running -> done: the run record ends, the summary block goes into the document once, the version is labelled. */
  async function finish(path, e) {
    const d = dispatch();
    const results = resultsOf(e);
    Object.assign(e, { state: 'done', doneAt: Date.now() });
    save();
    const record = e.runId ? await quietly(recorder.endRun(e.runId, 'done', { results })) : null;
    if (record) {
      try {
        const file = await readOrNull(path);
        const roles = d ? effectiveRoles(d.hub.roles, d.store) : [];
        const code = file?.blocks?.find((b) => b.id === record.plan?.snapshot?.block)?.code;
        const nodes = summaryNodes(record, { labels: nodeLabels(code), roleName: (r) => roles.find((x) => x.id === r)?.name ?? r });
        const r = await ws.editDocument(path, (doc) => withSummary(doc, nodes));
        ctx.hub.broadcast('workspace', { kind: 'change', path, revision: r.revision });
        await ws.labelVersion(path, 'done');
      } catch (err) {
        // The file went away or cannot be written: the run record still says done.
        console.error('pipeline summary:', err?.code ?? err?.name);
      }
    }
    changed(path);
  }

  /** Running plans whose steps the board has all closed end as done. */
  const finishing = new Set();
  async function finishClosed() {
    for (const [path, e] of Object.entries(entries() ?? {})) {
      if (e.state !== 'running' || !e.steps?.length || finishing.has(path)) continue;
      finishing.add(path);
      try {
        if ((await unclosed(path, e)).length === 0 && e.state === 'running') await finish(path, e);
      } catch (err) {
        console.error('pipeline finish:', err?.message);
      } finally {
        finishing.delete(path);
      }
    }
  }

  /**
   * 복제해서 새 계획: a new draft next to `path` with the same plan, diagram and notes, without the summary block.
   * The lead that wrote the original owns the copy when it is still there and has no other plan going.
   */
  async function duplicate(body) {
    if (typeof body?.path !== 'string') throw new StoreError(400, 'path is required');
    const path = ws.runs.fileRel(body.path);
    const file = await readOrNull(path);
    if (!file) throw new StoreError(404, 'not found');
    if (!file.plan) throw new StoreError(400, '계획이 있는 파일이 아니에요');
    const title = `${file.title || '계획'} 복사`;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const to = await freePath(title, dir);
    const r = await ws.createFile(to, { title, document: withoutSummary(file.document), canvas: file.canvas, blocks: file.blocks, plan: file.plan });
    const all = entries();
    const lead = all?.[path]?.lead;
    const d = dispatch();
    const alive = lead && d?.hub.get(lead) && d.hub.get(lead).status !== 'done';
    if (all && alive && !leadEntries(lead, ['plan', 'running', 'paused']).length) {
      all[r.path] = { lead, state: 'plan', draftRevision: r.revision, approvedRevision: null, approvedAt: null, runId: null, steps: [], links: {} };
      drafts.set(r.path, file.plan);
      save();
    }
    await ws.labelVersion(r.path, 'draft');
    ctx.hub.broadcast('workspace', { kind: 'create', path: r.path, revision: r.revision });
    changed(r.path);
    return { path: r.path, revision: r.revision, lead: all?.[r.path]?.lead ?? null };
  }

  // ---- note_step ----
  function note(body) {
    if (!dispatch()) throw new StoreError(409, 'Dispatch가 꺼져 있어요');
    if (typeof body.lead !== 'string' || typeof body.step !== 'string') throw new StoreError(400, 'lead and step are required');
    const text = redact(String(body.text ?? '')).replace(/\s+/g, ' ').trim();
    if (!text) throw new StoreError(400, 'text가 비어 있어요');
    const running = leadEntries(body.lead, 'running').find(([, e]) => e.steps?.includes(body.step));
    if (!running) throw new StoreError(409, leadEntries(body.lead, 'running').length ? `승인된 계획에 단계 "${body.step.slice(0, 40)}"가 없어요` : '실행 중인 계획이 없어요');
    const [path, e] = running;
    return { path, step: body.step, note: recorder.noteStep(e.runId, body.step, text.slice(0, 200)) };
  }

  const route = (method, path, fn) => ({
    method,
    path,
    async handler(req, res, _ctx, _m, url) {
      try {
        const body = method === 'GET' ? null : await readJson(req);
        send(res, 200, await fn(body, url.searchParams));
      } catch (err) {
        if (!(err instanceof StoreError)) throw err;
        send(res, err.status, { error: err.message, ...(err.revision !== undefined && { revision: err.revision }), ...(err.blockers && { blockers: err.blockers }) });
      }
    },
  });

  return {
    status,
    writePlan,
    start,
    note,
    stop,
    resume,
    reopen,
    duplicate,
    finishClosed,
    syncLimit,
    close: () => {
      clearInterval(limitTimer);
      unsubscribe();
    },
    routes: [
      route('GET', '/api/pipeline', (_b, q) => {
        const p = q.get('path');
        if (typeof p !== 'string') throw new StoreError(400, 'path is required');
        return status(p);
      }),
      route('POST', '/api/pipeline/plan', (b) => writePlan(b)),
      route('POST', '/api/pipeline/start', (b) => start(b)),
      route('POST', '/api/pipeline/note', (b) => note(b)),
      route('POST', '/api/pipeline/stop', (b) => stop(b)),
      route('POST', '/api/pipeline/resume', (b) => resume(b)),
      route('POST', '/api/pipeline/reopen', (b) => reopen(b)),
      route('POST', '/api/pipeline/duplicate', (b) => duplicate(b)),
    ],
  };
}
