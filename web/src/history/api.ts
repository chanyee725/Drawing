// History endpoints (server/history). Kept apart from data/ so the main data
// layer stays unchanged; the mock data source has no history.
import type { Commit, HighlightCell, Version } from './timeline';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`${url} → ${res.status}`), { status: res.status });
  return res.json();
}

type Raw = Record<string, unknown>;
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function normalizeVersion(raw: unknown): Version {
  const r = raw as Raw;
  const src = (r.source ?? {}) as Raw;
  const page = (r.page ?? {}) as Raw;
  const agent = r.agent as Raw | null;
  return {
    seq: num(r.seq),
    at: num(r.at),
    source: { kind: src.kind === 'worktree' ? 'worktree' : 'main', label: str(src.label, 'main') },
    agent: agent && typeof agent === 'object' ? { name: str(agent.name), role: str(agent.role) } : null,
    page: { id: str(page.id), name: str(page.name, str(page.id)) },
    kinds: Array.isArray(r.kinds) ? r.kinds.map(String) : [],
    summary: str(r.summary),
    cellCount: num(r.cellCount),
    snapshot: r.snapshot !== false,
  };
}

function normalizeCells(raw: unknown): HighlightCell[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: Raw) => ({
    id: str(c.id),
    kinds: Array.isArray(c.kinds) ? c.kinds.map(String) : [],
    box: c.box && typeof c.box === 'object' ? (c.box as HighlightCell['box']) : null,
  }));
}

export interface VersionView {
  page: { id: string; name: string } | null;
  /** Null when this version has no such page. */
  xml: string | null;
  cells: HighlightCell[];
  /** Pages in this version (git versions only). */
  pages?: { id: string; name: string }[];
}

const q = encodeURIComponent;

export const historyApi = {
  async versions(fileId: string): Promise<Version[]> {
    const r = (await getJson(`/api/versions?file=${q(fileId)}`)) as Raw;
    return Array.isArray(r.versions) ? r.versions.map(normalizeVersion) : [];
  },
  async version(fileId: string, seq: number): Promise<VersionView> {
    const r = (await getJson(`/api/versions/${seq}?file=${q(fileId)}`)) as Raw;
    const page = r.page as Raw;
    return { page: { id: str(page?.id), name: str(page?.name) }, xml: str(r.xml) || null, cells: normalizeCells(r.cells) };
  },
  async gitLog(fileId: string): Promise<{ available: boolean; commits: Commit[] }> {
    const r = (await getJson(`/api/git-log?file=${q(fileId)}`)) as Raw;
    const commits = Array.isArray(r.commits) ? r.commits.map((c: Raw) => ({ sha: str(c.sha), at: num(c.at), subject: str(c.subject) })) : [];
    return { available: r.available === true, commits };
  },
  async gitVersion(fileId: string, sha: string, pageId: string | null): Promise<VersionView> {
    const r = (await getJson(`/api/git-version?file=${q(fileId)}&commit=${q(sha)}${pageId ? `&page=${q(pageId)}` : ''}`)) as Raw;
    const page = r.page as Raw | null;
    return {
      page: page ? { id: str(page.id), name: str(page.name) } : null,
      xml: str(r.xml) || null,
      cells: normalizeCells(r.cells),
      pages: Array.isArray(r.pages) ? r.pages.map((p: Raw) => ({ id: str(p.id), name: str(p.name) })) : [],
    };
  },
  /** Calls `onChange(fileId)` for every live change. Returns an unsubscribe. */
  watch(onChange: (fileId: string) => void): () => void {
    const es = new EventSource('/api/events');
    es.addEventListener('change', (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        if (typeof d?.fileId === 'string') onChange(d.fileId);
      } catch {
        // ignore a malformed event
      }
    });
    return () => es.close();
  },
};
