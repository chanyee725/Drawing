import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Persists session metadata and usage totals to <project>/.dispatch/state.json. Transcripts are
// never written: the Hub keeps them in memory only. `last` (a clip of the latest reply) is
// transcript text too, so it is kept in memory and left out of the file.
const MEMORY_ONLY = ["last"];

export function diskView(data) {
  const sessions = {};
  for (const [id, s] of Object.entries(data.sessions || {})) {
    const out = { ...s };
    for (const k of MEMORY_ONLY) delete out[k];
    sessions[id] = out;
  }
  // Limit tickets carry clips of the lead's and teammates' last replies; those stay in memory too.
  const tickets = {};
  for (const [id, t] of Object.entries(data.tickets || {})) {
    const { leadLast, ...out } = t;
    if (Array.isArray(t.team)) out.team = t.team.map(({ last, ...m }) => m);
    tickets[id] = out;
  }
  return data.tickets ? { ...data, sessions, tickets } : { ...data, sessions };
}

export class Store {
  constructor(root) {
    this.file = path.join(root, ".dispatch", "state.json");
    this.data = { seq: 0, sessions: {}, daily: {}, settings: { guard: { enabled: true, five: 0.9, seven: 0.85 }, enabled: { claude: false, openai: false } } };
    this.timer = null;
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      for (const x of Object.values(saved.sessions || {})) x.last ??= "";
      this.data = { ...this.data, ...saved, settings: { ...this.data.settings, ...saved.settings } };
    } catch { /* first run */ }
    return this.data;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  async flush() {
    clearTimeout(this.timer);
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    await writeFile(tmp, JSON.stringify(diskView(this.data), null, 2));
    await rename(tmp, this.file);
  }

  // Adds a usage delta to today's bucket.
  addDaily(model, role, delta) {
    const day = new Date().toLocaleDateString("sv-SE");
    const d = (this.data.daily[day] ||= { cost: 0, models: {}, roles: {} });
    d.cost += delta.cost || 0;
    const m = (d.models[model] ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
    for (const k of ["input", "output", "cacheRead", "cacheWrite", "cost"]) m[k] += delta[k] || 0;
    d.roles[role] = (d.roles[role] || 0) + (delta.cost || 0);
    this.save();
  }
}
