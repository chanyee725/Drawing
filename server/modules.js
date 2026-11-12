// Feature modules, set up in order. Each owns its own directory:
//   watch  (T2): server/watch/  — file watcher, parse, diff, history, /api/files, /api/history
//   agents (T4): server/agents/ — Dispatch read-only feed, attribution, `agents` events
//   history (T6): server/history/ — recorded versions per change, git log of the main checkout
// A new feature adds one line here and keeps its code in its own directory.
import * as watch from './watch/index.js';
import * as agents from './agents/index.js';
import * as history from './history/index.js';

export const modules = [
  { name: 'watch', setup: watch.setup },
  { name: 'agents', setup: agents.setup },
  { name: 'history', setup: history.setup },
];
