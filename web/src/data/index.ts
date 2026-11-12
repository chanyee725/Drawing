// Picks the data source. `?mock` forces the mock; otherwise use the server API and
// fall back to the mock only when the server has no /api/files route yet.
import { createApiSource } from './api';
import { createMockSource } from './mock';
import type { DataSource } from './types';

export * from './types';

export async function pickDataSource(search = window.location.search): Promise<DataSource> {
  if (new URLSearchParams(search).has('mock')) return createMockSource();
  try {
    const res = await fetch('/api/files', { method: 'GET', headers: { accept: 'application/json' } });
    if (res.status === 404) return createMockSource();
  } catch {
    // Server unreachable: the API source will show its own error.
  }
  return createApiSource();
}
