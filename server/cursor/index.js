// Live agent cursor (E56, issue #226): when an agent session changes a diagram, broadcast where on the canvas it
// is working as a `cursor` event on the shared /api/events hub. Memory only: nothing about cursors is written to
// disk, and the position comes only from the agent's own edits (no mouse data).
//
// Attribution: a session's recent tool calls (masked, clipped input text from the Dispatch hub) that mention the
// changed file's path. Read-only tools do not count. The newest such mention within ATTRIBUTE_MS wins.
import { changedCentre, mentionsFile, shapesOf } from './model.js';

const ATTRIBUTE_MS = 60_000;
const RECENT_PER_SESSION = 20;
const MAX_FILES = 50;
const END_GRACE_MS = 2000;
const LIVE = new Set(['running', 'starting', 'waiting']);
const DPX_RE = /[^\s"'`=?&<>|;(),]*\.dpx\.json/g;

export async function setup(ctx) {
  const ws = ctx.modules.workspace;
  const hub = ctx.modules.dispatch?.hub;
  if (!ws?.store || !ws.onChange || !hub) return {};
  const recent = new Map(); // session id -> [{ entry, at }]
  const shapes = new Map(); // rel -> shapesOf(file), insertion order = age
  const shown = new Set(); // session ids with a cursor on screen

  const remember = (rel, s) => {
    shapes.delete(rel);
    shapes.set(rel, s);
    if (shapes.size > MAX_FILES) shapes.delete(shapes.keys().next().value);
  };
  const read = async (rel) => shapesOf(await ws.store.readFile(rel));

  // Before an edit lands: keep the file's current shapes so the change can be diffed. The tool line arrives
  // before the tool runs. The mention may be absolute or relative to another folder: try its tail segments.
  async function baseline(text) {
    for (const raw of new Set(text.match(DPX_RE) ?? [])) {
      let p;
      try { p = decodeURIComponent(raw); } catch { p = raw; }
      const parts = p.split('/').filter((s) => s && s !== '.');
      for (let i = Math.max(0, parts.length - 6); i < parts.length; i++) {
        const rel = parts.slice(i).join('/');
        if (shapes.has(rel)) break;
        try { remember(rel, await read(rel)); break; } catch { /* not this suffix */ }
      }
    }
  }

  const onMessage = ({ id, entry }) => {
    if (entry?.kind !== 'tool' || typeof entry.text !== 'string') return;
    const list = recent.get(id) ?? [];
    list.push({ entry, at: Date.now() });
    if (list.length > RECENT_PER_SESSION) list.shift();
    recent.set(id, list);
    if (entry.text.includes('.dpx.json') || entry.text.includes('.dpx%2Ejson')) baseline(entry.text).catch(() => {});
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

  const onChange = async (rel) => {
    const s = whoEdited(rel, Date.now());
    let after;
    try { after = await read(rel); } catch { return; }
    const before = shapes.get(rel);
    remember(rel, after);
    if (!s) return;
    const at = before ? changedCentre(before, after) : null;
    shown.add(s.id);
    // Without a place (nothing with a place changed, or no earlier version known) the cursor stays where it was.
    ctx.hub.broadcast('cursor', { sid: s.id, name: s.name, role: s.role, file: rel, ...(at ?? {}), at: Date.now() });
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
