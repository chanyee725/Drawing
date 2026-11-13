// Feature modules, set up in order. Each owns its own directory under server/
// (e.g. server/workspace/ for E1). A new feature adds one line here.
import * as workspace from './workspace/index.js';
import * as dispatch from './dispatch/index.js';

export const modules = [
  { name: 'workspace', setup: workspace.setup },
  // Agent sessions for the git project holding the workspace; off outside a git project.
  { name: 'dispatch', setup: dispatch.setup },
];
