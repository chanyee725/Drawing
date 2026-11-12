// Pure helpers for the file list. No DOM, so `node --test` can import them.
import type { FileSummary } from './types';

function compare(a: FileSummary, b: FileSummary): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.source.kind !== b.source.kind) return a.source.kind === 'main' ? -1 : 1;
  return a.source.label.localeCompare(b.source.label);
}

export function sortFiles(list: FileSummary[]): FileSummary[] {
  return [...list].sort(compare);
}

/** Apply an SSE `file` event: upsert, or drop the entry when `deleted` is set. */
export function applyFileEvent(list: FileSummary[], file: FileSummary): FileSummary[] {
  const rest = list.filter((f) => f.id !== file.id);
  if (file.deleted) return rest;
  return sortFiles([...rest, file]);
}

/** Distinct paths in list order. */
export function paths(list: FileSummary[]): string[] {
  return [...new Set(list.map((f) => f.path))];
}

/** Every source that has a copy of `path`, main first. */
export function sourcesFor(list: FileSummary[], path: string): FileSummary[] {
  return list.filter((f) => f.path === path);
}

/**
 * Which file to show after the list changed: keep `currentId` if it still exists,
 * else another source of the same path, else the first file.
 */
export function pickFile(list: FileSummary[], currentId: string | null, currentPath: string | null): FileSummary | null {
  return (
    list.find((f) => f.id === currentId) ??
    (currentPath ? list.find((f) => f.path === currentPath) : undefined) ??
    list[0] ??
    null
  );
}
