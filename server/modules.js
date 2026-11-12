// Feature modules, set up in order. Each owns its own directory under server/
// (e.g. server/workspace/ for E1). A new feature adds one line here.
import * as workspace from './workspace/index.js';

export const modules = [{ name: 'workspace', setup: workspace.setup }];
