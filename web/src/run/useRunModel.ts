// The run screen's computed rows for React: run data + live Dispatch sessions + a minute clock while running.
import { useEffect, useMemo, useState } from 'react';
import { useDispatch } from '../dispatch/store.ts';
import { useRunData } from './runData.ts';
import { nodeLabels, sessionRows, stepRows, stripModel, type LiveSession } from './runModel.ts';

/** Re-render every 30s while `on`, so "8분째" stays current. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** `code`: the plan block's diagram code, for step titles. */
export function useRunModel(code: string | undefined) {
  const data = useRunData();
  const record = data.record;
  const running = record?.state === 'running';
  const now = useNow(running);
  const sessions = useDispatch((s) => s.sessions);
  const five = useDispatch((s) => s.limits.five);
  const labels = useMemo(() => nodeLabels(code), [code]);
  const live = useMemo(() => new Map<string, LiveSession>(sessions.map((s) => [s.id, s])), [sessions]);
  return useMemo(() => {
    if (!record) return { data, record: null, running: false, rows: [], sessions: [], strip: null, labels, now };
    const rows = stepRows(record, live, now, labels);
    const srows = sessionRows(record, live, now);
    return { data, record, running, rows, sessions: srows, strip: stripModel(record, rows, srows, five, now), labels, now };
  }, [data, record, running, live, now, labels, five]);
}
