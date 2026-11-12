// React glue for the agents feed: current snapshot, a ticking clock, and a focus request
// (set when the user clicks an agent in the panel; LiveCursors consumes it).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { gateActivity, readActivityPref, writeActivityPref } from './activityPref';
import { subscribeApiAgents, subscribeMockAgents } from './feed';
import type { AgentsSnapshot } from './model';

export interface FocusRequest {
  agentId: string;
  nonce: number;
}

const EMPTY: AgentsSnapshot = { dispatch: { found: false, connected: false }, agents: [] };

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** "Show activity line" setting, kept in localStorage. Off by default. */
export function useActivityPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readActivityPref(storage()));
  const set = useCallback((v: boolean) => {
    writeActivityPref(storage(), v);
    setOn(v);
  }, []);
  return [on, set];
}

/** `mode` null while the data source is still being picked. `activity`: fetch and show the activity line. */
export function useLiveAgents(mode: 'api' | 'mock' | null, activity = false) {
  const [snap, setSnap] = useState<AgentsSnapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);

  useEffect(() => {
    if (!mode) return;
    const on = (s: AgentsSnapshot) => {
      setSnap(s);
      setLoaded(true);
    };
    return mode === 'mock' ? subscribeMockAgents(on, { activity }) : subscribeApiAgents(on, { activity });
  }, [mode, activity]);

  const requestFocus = useCallback((agentId: string) => setFocus((f) => ({ agentId, nonce: (f?.nonce ?? 0) + 1 })), []);

  const agents = useMemo(() => gateActivity(snap.agents, activity), [snap.agents, activity]);
  return { ...snap, agents, loaded, focus, requestFocus };
}

/** Current time, refreshed every `ms`. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
