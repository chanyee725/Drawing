// "Show activity line" setting. Off by default: the line comes from the agent's conversation.
// Stored only in this browser's localStorage; the server never sees or keeps it, it only gets
// `?activity=1` on the agents requests while the setting is on.
import type { Agent } from './model';

export const ACTIVITY_PREF_KEY = 'draw-pipelines:show-activity';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function readActivityPref(store: Store | null | undefined): boolean {
  try {
    return store?.getItem(ACTIVITY_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeActivityPref(store: Store | null | undefined, on: boolean): void {
  try {
    store?.setItem(ACTIVITY_PREF_KEY, on ? '1' : '0');
  } catch {
    // storage blocked: the setting lasts for this page only
  }
}

/** Query string for the agents requests. */
export const activityQuery = (on: boolean) => (on ? '?activity=1' : '');

/** Blank the activity line unless the setting is on (covers data that arrived before a switch). */
export function gateActivity(agents: Agent[], on: boolean): Agent[] {
  return on ? agents : agents.map((a) => (a.activity || a.activityAt != null ? { ...a, activity: '', activityAt: null } : a));
}
