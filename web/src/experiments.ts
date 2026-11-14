// Experiments that are off unless turned on by hand in the browser (`localStorage`, then reload).
// Nothing in the UI sets them; they exist so a prototype can be looked at in the real app.

function flag(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false; // storage blocked: every experiment stays off
  }
}

/** E65 (#276): wrap a flowchart's top-level groups into rows. `localStorage['drawing.experiment.groupWrap'] = '1'`. */
export const GROUP_WRAP = flag('drawing.experiment.groupWrap');
