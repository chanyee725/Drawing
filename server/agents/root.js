// Find the Dispatch root for a project dir: the nearest ancestor (or itself) holding
// `.dispatch/wt` or `.dispatch/server.port`. Same walk-up rule as server/watch findDispatchRoot,
// so `npm start -- <repo>/docs/handover` still finds `<repo>/.dispatch`.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function findDispatchRoot(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, '.dispatch', 'wt')) || existsSync(join(d, '.dispatch', 'server.port'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}
