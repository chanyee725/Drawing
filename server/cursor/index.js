// Live agent cursor (E56, issue #226): when an agent session changes a diagram, broadcast where on the canvas it
// is working as a `cursor` event on the shared /api/events hub. Memory only: nothing about cursors is written to
// disk, and the position comes only from the agent's own edits (no mouse data).
//
// Attribution: a session's recent tool calls (masked, clipped input text from the Dispatch hub) that mention the
// changed file's path. Read-only tools do not count. The newest such mention within ATTRIBUTE_MS wins.
import { AGENT_COLORS } from '../dispatch/colors.js';
import { changedCentre, changedKeys, mentionsFile, shapesOf } from './model.js';

const ATTRIBUTE_MS = 60_000;
const RECENT_PER_SESSION = 20;
const MAX_FILES = 50;
const END_GRACE_MS = 2000;
const LIVE = new Set(['running', 'starting', 'waiting']);
const DPX_RE = /[^\s"'`=?&<>|;(),]*\.dpx\.json/g;
const EMPTY = new Map();

export async function setup(ctx) {
  const ws = ctx.modules.workspace;
  const hub = ctx.modules.dispatch?.hub;
  if (!ws?.store || !ws.onChange || !hub) return {};
  const recent = new Map(); // session id -> [{ entry, at }]
  // Two kinds of "before" per file, kept apart so a slow tool-time read can never overwrite what a change reported:
  // `seen` is the version from the file's last reported change (watcher or API), the exact version the next change
  // starts from; `pre` is read when a tool call mentions a file with no reported change yet.
  const seen = new Map(); // rel -> shapesOf(file), insertion order = age
  const pre = new Map(); // rel -> shapesOf(file)
  const pending = new Map(); // rel -> tool-time read in flight
  const queue = new Map(); // rel -> tail of that file's change handling (one change at a time per file)
  const shown = new Set(); // session ids with a cursor on screen

  const remember = (map, rel, s) => {
    map.delete(rel);
    map.set(rel, s);
    if (map.size > MAX_FILES) map.delete(map.keys().next().value);
  };
  const read = async (rel) => shapesOf(await ws.store.readFile(rel));

  // Before an edit lands: read the file's current shapes so the change can be diffed. The tool line arrives
  // before the tool runs. Resolves true when `rel` exists (a missing file is about to be created).
  function readBefore(rel) {
    if (seen.has(rel) || pre.has(rel)) return Promise.resolve(true);
    let p = pending.get(rel);
    if (!p) {
      p = read(rel).then((s) => { remember(pre, rel, s); return true; }, () => false);
      pending.set(rel, p);
      p.then(() => { if (pending.get(rel) === p) pending.delete(rel); });
    }
    return p;
  }

  // The mention may be absolute or relative to another folder: try its tail segments.
  async function baseline(text) {
    for (const raw of new Set(text.match(DPX_RE) ?? [])) {
      let path;
      try { path = decodeURIComponent(raw); } catch { path = raw; }
      const parts = path.split('/').filter((s) => s && s !== '.');
      for (let i = Math.max(0, parts.length - 6); i < parts.length; i++) {
        if (await readBefore(parts.slice(i).join('/'))) break;
      }
    }
  }

  const onMessage = ({ id, entry }) => {
    if (entry?.kind !== 'tool' || typeof entry.text !== 'string') return;
    const list = recent.get(id) ?? [];
    list.push({ entry, at: Date.now() });
    if (list.length > RECENT_PER_SESSION) list.shift();
    recent.set(id, list);
    if (entry.text.includes('.dpx.json')) baseline(entry.text).catch(() => {});
  };

  // Every live session with a recent edit-tool mention of `rel` (its newest one). Several sessions can edit one
  // file at once (two agents, two blocks of one diagram): choosing among them waits for the diff, see `pick`.
  function whoEdited(rel, now) {
    const out = [];
    for (const [id, list] of recent) {
      const s = hub.get(id);
      if (!s) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const { entry, at } = list[i];
        if (now - at > ATTRIBUTE_MS) break;
        if (mentionsFile(entry, rel)) { out.push({ s, entry, at }); break; }
      }
    }
    return out;
  }

  const used = new WeakSet(); // tool entries already credited with a change
  // One change, several candidate sessions: the one whose tool call names a changed block or element wins; else the
  // oldest call that has not been credited yet (each agent's call precedes its own change); else the newest.
  function pick(cands, before, after) {
    if (cands.length < 2) return cands[0] ?? null;
    const ids = changedKeys(before, after).map((k) => k.slice(k.indexOf(':') + 1));
    const newest = (l) => l.reduce((a, c) => (c.at > a.at ? c : a));
    const named = cands.filter((c) => ids.some((id) => id && c.entry.text.includes(id)));
    if (named.length) return newest(named);
    const fresh = cands.filter((c) => !used.has(c.entry));
    if (fresh.length) return fresh.reduce((a, c) => (c.at < a.at ? c : a));
    return newest(cands);
  }

  async function place(rel, cands, wait) {
    await wait; // a tool-time read still in flight when the change came: let it land in `pre` first
    let after;
    try { after = await read(rel); } catch { return; }
    const before = seen.get(rel);
    const earlier = pre.get(rel);
    remember(seen, rel, after);
    pre.delete(rel);
    if (!cands.length) return;
    // From the reported version when there is one. Otherwise from the tool-time read, unless that shows no change
    // (it raced the edit and read the new version) or there is none (a new file): then from an empty canvas, so a
    // first edit or a new diagram still gets a place.
    const base = before ?? (earlier && changedCentre(earlier, after) ? earlier : EMPTY);
    const at = changedCentre(base, after);
    const chosen = pick(cands, base, after);
    used.add(chosen.entry);
    const s = chosen.s;
    shown.add(s.id);
    // Without a place (nothing with a place changed) the cursor stays where it was.
    const color = AGENT_COLORS.includes(s.color) ? { color: s.color } : {};
    ctx.hub.broadcast('cursor', { sid: s.id, name: s.name, role: s.role, ...color, file: rel, ...(at ?? {}), at: Date.now() });
  }

  // Changes of one file are handled in order: each diffs against the version the one before it left in `seen`.
  const onChange = (rel) => {
    const cands = whoEdited(rel, Date.now());
    const run = (queue.get(rel) ?? Promise.resolve()).then(() => place(rel, cands, pending.get(rel)));
    const tail = run.catch(() => {});
    queue.set(rel, tail);
    tail.then(() => { if (queue.get(rel) === tail) queue.delete(rel); });
    return run;
  };

  const gone = (id) => {
    if (!shown.delete(id)) return;
    ctx.hub.broadcast('cursor', { sid: id, gone: true });
  };
  // A turn that ended: its last edit can still be on its way through the file watcher, so forget the session a
  // moment later (unless it is busy again by then).
  const ending = new Map(); // session id -> timer
  const end = (id) => {
    ending.delete(id);
    recent.delete(id);
    gone(id);
  };
  const onSession = (ps) => {
    if (!ps?.id) return;
    if (LIVE.has(ps.status)) {
      clearTimeout(ending.get(ps.id));
      ending.delete(ps.id);
    } else if (!ending.has(ps.id) && (recent.has(ps.id) || shown.has(ps.id))) {
      ending.set(ps.id, setTimeout(end, END_GRACE_MS, ps.id));
    }
  };
  const onRemoved = ({ id }) => {
    clearTimeout(ending.get(id));
    end(id);
  };

  hub.on('message', onMessage);
  hub.on('session', onSession);
  hub.on('removed', onRemoved);
  const offChange = ws.onChange((rel) => { onChange(rel).catch(() => {}); });
  return {
    close() {
      for (const t of ending.values()) clearTimeout(t);
      hub.off('message', onMessage);
      hub.off('session', onSession);
      hub.off('removed', onRemoved);
      offChange();
    },
  };
}
