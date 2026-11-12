// Feature modules, set up in order. Each owns its own directory:
//   watch  (T2): server/watch/  — file watcher, parse, diff, history, /api/files, /api/history
//   agents (T4): server/agents/ — Dispatch read-only feed, attribution, `agents` events
// A new feature adds one line here and keeps its code in its own directory.
import * as watch from './watch/index.js';
import * as agents from './agents/index.js';

export const modules = [
  { name: 'watch', setup: watch.setup },
  { name: 'agents', setup: agents.setup },
];
