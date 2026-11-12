// Real adapter: talks to the local Draw-Pipelines server.
// If the server's JSON shape changes, adjust the normalize* functions only.
import type { ChangeEvent, DataSource, FeedHandlers, FileDetail, FileSummary, PageRef, PageXml, Source } from './types';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

type Raw = Record<string, unknown>;

function normalizeSource(raw: unknown): Source {
  const r = (raw ?? {}) as Raw;
  const kind = r.kind === 'worktree' ? 'worktree' : 'main';
  return { kind, label: typeof r.label === 'string' && r.label ? r.label : kind };
}

function normalizePageRef(raw: unknown): PageRef {
  const r = raw as Raw;
  return { id: String(r.id), name: String(r.name ?? r.id) };
}

export function normalizeFileSummary(raw: unknown): FileSummary {
  const r = raw as Raw;
  return {
    id: String(r.id),
    path: String(r.path ?? r.id),
    source: normalizeSource(r.source),
    pages: Array.isArray(r.pages) ? r.pages.map(normalizePageRef) : [],
    ...(r.deleted ? { deleted: true } : {}),
  };
}

export function normalizeFileDetail(raw: unknown): FileDetail {
  const r = raw as Raw;
  const pages: PageXml[] = Array.isArray(r.pages)
    ? r.pages.map((p) => ({ ...normalizePageRef(p), xml: String((p as Raw).xml ?? '') }))
    : [];
  return { id: String(r.id), path: String(r.path ?? r.id), source: normalizeSource(r.source), pages };
}

export function normalizeChange(raw: unknown): ChangeEvent {
  const r = raw as Raw;
  return {
    fileId: String(r.fileId),
    source: normalizeSource(r.source),
    page: normalizePageRef(r.page ?? { id: '', name: '' }),
    kinds: Array.isArray(r.kinds) ? r.kinds.map(String) : [],
    cellIds: Array.isArray(r.cellIds) ? r.cellIds.map(String) : [],
    bbox: (r.bbox as ChangeEvent['bbox']) ?? null,
    at: (r.at as ChangeEvent['at']) ?? Date.now(),
    ...(typeof r.path === 'string' ? { path: r.path } : {}),
    ...(typeof r.relPath === 'string' ? { relPath: r.relPath } : {}),
    ...(typeof r.summary === 'string' ? { summary: r.summary } : {}),
  };
}

export function createApiSource(base = ''): DataSource {
  return {
    name: 'api',
    async listFiles() {
      const raw = await getJson(`${base}/api/files`);
      const list = Array.isArray(raw) ? raw : ((raw as Raw).files as unknown[]) ?? [];
      return list.map(normalizeFileSummary);
    },
    async getFile(id) {
      return normalizeFileDetail(await getJson(`${base}/api/files/${encodeURIComponent(id)}`));
    },
    subscribe(h: FeedHandlers) {
      // EventSource reconnects by itself; we only report the state.
      const es = new EventSource(`${base}/api/events`);
      h.onState?.('connecting');
      es.onopen = () => h.onState?.('open');
      es.onerror = () => h.onState?.('retrying');
      const parse = (e: MessageEvent) => {
        try {
          return JSON.parse(e.data);
        } catch {
          return null;
        }
      };
      es.addEventListener('file', (e) => {
        const d = parse(e as MessageEvent);
        if (d) h.onFile?.(normalizeFileSummary(d));
      });
      es.addEventListener('change', (e) => {
        const d = parse(e as MessageEvent);
        if (d) h.onChange?.(normalizeChange(d));
      });
      return () => es.close();
    },
  };
}
