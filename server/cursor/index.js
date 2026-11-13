// Live agent cursor (E56, issue #226): when an agent session changes a diagram, broadcast where on the canvas it
// is working as a `cursor` event on the shared /api/events hub. Memory only: nothing about cursors is written to
// disk, and the position comes only from the agent's own edits (no mouse data).
//
// Attribution: a session's recent tool calls (masked, clipped input text from the Dispatch hub) that mention the
// changed file's path. Read-only tools do not count. The newest such mention within ATTRIBUTE_MS wins.
import { AGENT_COLORS } from '../dispatch/colors.js';
import { changedCentre, mentionsFile, shapesOf } from './model.js';

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

  function whoEdited(rel, now) {
    let best = null;
    for (const [id, list] of recent) {
      const s = hub.get(id);
      if (!s) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const { entry, at } = list[i];
        if (now - at > ATTRIBUTE_MS) break;
        if (mentionsFile(entry, rel)) {
          if (!best || at > best.at) best = { s, at };
          break;
        }
      }
    }
    return best?.s ?? null;
  }

  async function place(rel, s, wait) {
    await wait; // a tool-time read still in flight when the change came: let it land in `pre` first
    let after;
    try { after = await read(rel); } catch { return; }
    const before = seen.get(rel);
    const earlier = pre.get(rel);
    remember(seen, rel, after);
    pre.delete(rel);
    if (!s) return;
    // From the reported version when there is one. Otherwise from the tool-time read, unless that shows no change
    // (it raced the edit and read the new version) or there is none (a new file): then from an empty canvas, so a
    // first edit or a new diagram still gets a place.
    const at = before ? changedCentre(before, after) : (earlier && changedCentre(earlier, after)) ?? changedCentre(EMPTY, after);
    shown.add(s.id);
    // Without a place (nothing with a place changed) the cursor stays where it was.
    const color = AGENT_COLORS.includes(s.color) ? { color: s.color } : {};
    ctx.hub.broadcast('cursor', { sid: s.id, name: s.name, role: s.role, ...color, file: rel, ...(at ?? {}), at: Date.now() });
  }

  // Changes of one file are handled in order: each diffs against the version the one before it left in `seen`.
  const onChange = (rel) => {
    const s = whoEdited(rel, Date.now());
    const run = (queue.get(rel) ?? Promise.resolve()).then(() => place(rel, s, pending.get(rel)));
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
