// Pure helpers for the history panel. No DOM, so `node --test` can import them.

export interface Who {
  kind: 'main' | 'worktree';
  label: string;
}

/** One recorded change (server: GET /api/versions). */
export interface Version {
  seq: number;
  at: number;
  source: Who;
  agent: { name: string; role: string } | null;
  page: { id: string; name: string };
  kinds: string[];
  summary: string;
  cellCount: number;
  /** False when the server dropped this version's content to save memory. */
  snapshot: boolean;
}

/** One commit that touched the file (server: GET /api/git-log). */
export interface Commit {
  sha: string;
  at: number;
  subject: string;
}

export interface HighlightCell {
  id: string;
  kinds: string[];
  /** Graph coords; for a removed cell, where it was. */
  box: { x: number; y: number; w: number; h: number } | null;
}

export type TimelineItem = { type: 'version'; at: number; version: Version } | { type: 'commit'; at: number; commit: Commit };

/** Recorded changes and commits merged, newest first (a version wins a tie). */
export function timeline(versions: Version[], commits: Commit[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...versions.map((v) => ({ type: 'version' as const, at: v.at, version: v })),
    ...commits.map((c) => ({ type: 'commit' as const, at: c.at, commit: c })),
  ];
  return items.sort((a, b) => {
    if (a.at !== b.at) return b.at - a.at;
    if (a.type !== b.type) return a.type === 'version' ? -1 : 1;
    return a.type === 'version' && b.type === 'version' ? b.version.seq - a.version.seq : 0;
  });
}

/** Versions the scrubber can play: oldest first, content still available. */
export function playable(versions: Version[]): Version[] {
  return versions.filter((v) => v.snapshot).sort((a, b) => a.seq - b.seq);
}

/**
 * Next scrubber position. `index` is the current position in `count` steps, or -1 for
 * "live" (not scrubbing). Stepping forward from live starts at the first step.
 */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count === 0) return -1;
  if (index < 0) return delta < 0 ? count - 1 : 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** Highlight colour group for a cell. */
export function highlightKind(kinds: string[]): 'added' | 'removed' | 'changed' {
  if (kinds.includes('added')) return 'added';
  if (kinds.includes('removed')) return 'removed';
  return 'changed';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `14:03:09` today, `11월 3일 14:03` on another day, with the year if not this year. */
export function formatTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === n.toDateString()) return `${hms}:${pad(d.getSeconds())}`;
  const day = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.getFullYear() === n.getFullYear() ? `${day} ${hms}` : `${d.getFullYear()}년 ${day} ${hms}`;
}

/** Who made a recorded change: the agent if known, else the source. */
export function whoLabel(v: Pick<Version, 'agent' | 'source'>): string {
  if (v.agent?.name) return v.agent.role ? `${v.agent.name} · ${v.agent.role}` : v.agent.name;
  return v.source.kind === 'main' ? '메인' : v.source.label;
}
