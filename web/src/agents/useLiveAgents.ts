// React glue for the agents feed: current snapshot, a ticking clock, and a focus request
// (set when the user clicks an agent in the panel; LiveCursors consumes it).
import { useCallback, useEffect, useState } from 'react';
import { subscribeApiAgents, subscribeMockAgents } from './feed';
import type { AgentsSnapshot } from './model';

export interface FocusRequest {
  agentId: string;
  nonce: number;
}

const EMPTY: AgentsSnapshot = { dispatch: { found: false, connected: false }, agents: [] };

/** `mode` null while the data source is still being picked. */
export function useLiveAgents(mode: 'api' | 'mock' | null) {
  const [snap, setSnap] = useState<AgentsSnapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);

  useEffect(() => {
    if (!mode) return;
    const on = (s: AgentsSnapshot) => {
      setSnap(s);
      setLoaded(true);
    };
    return mode === 'mock' ? subscribeMockAgents(on) : subscribeApiAgents(on);
  }, [mode]);

  const requestFocus = useCallback((agentId: string) => setFocus((f) => ({ agentId, nonce: (f?.nonce ?? 0) + 1 })), []);

  return { ...snap, loaded, focus, requestFocus };
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
