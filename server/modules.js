// Feature modules, set up in order. Each owns its own directory under server/
// (e.g. server/workspace/ for E1). A new feature adds one line here.
import * as workspace from './workspace/index.js';
import * as runs from './runs/index.js';
import * as dispatch from './dispatch/index.js';
import * as pipeline from './pipeline/index.js';
import * as cursor from './cursor/index.js';

export const modules = [
  { name: 'workspace', setup: workspace.setup },
  // Pipeline run records beside each file (.drawing/runs/); the recorder E20 drives.
  { name: 'runs', setup: runs.setup },
  // Agent sessions for the git project holding the workspace; off outside a git project.
  { name: 'dispatch', setup: dispatch.setup },
  // Plans and approval (E20): write_plan, 시작하기, note_step; gates the lead's create_sessions.
  { name: 'pipeline', setup: pipeline.setup },
  // Live agent cursor (E56): where an agent session is editing a diagram, as `cursor` SSE events (memory only).
  { name: 'cursor', setup: cursor.setup },
];
