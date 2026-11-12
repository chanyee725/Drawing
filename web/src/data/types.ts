// Shapes shared by the real API adapter and the mock adapter.
// They mirror the server contract (T2): GET /api/files, GET /api/files/<id>, SSE /api/events.

export type SourceKind = 'main' | 'worktree';

export interface Source {
  kind: SourceKind;
  /** `main`, or the worktree's session name. */
  label: string;
}

export interface PageRef {
  id: string;
  name: string;
}

/** One file as seen from one source. A worktree copy of the same path is a separate entry. */
export interface FileSummary {
  id: string;
  /** Path relative to the project (or worktree) root. */
  path: string;
  source: Source;
  pages: PageRef[];
  /** Set on an SSE `file` event when the file was deleted. */
  deleted?: boolean;
}

export interface PageXml extends PageRef {
  /** Uncompressed `<mxGraphModel>…</mxGraphModel>` XML. */
  xml: string;
}

export interface FileDetail {
  id: string;
  path: string;
  source: Source;
  pages: PageXml[];
}

export interface Bbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChangeEvent {
  fileId: string;
  source: Source;
  page: PageRef;
  kinds: string[];
  cellIds: string[];
  bbox: Bbox | null;
  /** ISO time or epoch ms. */
  at: string | number;
  path?: string;
  relPath?: string;
  /** One-line summary, e.g. "3 cells added". */
  summary?: string;
}

export type ConnectionState = 'connecting' | 'open' | 'retrying';

export interface FeedHandlers {
  onFile?: (file: FileSummary) => void;
  onChange?: (change: ChangeEvent) => void;
  onState?: (state: ConnectionState) => void;
}

/** What the UI needs from the data layer. Swap implementations in data/index.ts. */
export interface DataSource {
  readonly name: 'api' | 'mock';
  listFiles(): Promise<FileSummary[]>;
  getFile(id: string): Promise<FileDetail>;
  /** Subscribe to live events. Returns an unsubscribe function. */
  subscribe(handlers: FeedHandlers): () => void;
}
