// What the progress board overlay draws, per diagram block, plus the overlay's own "motion paused" switch.
// In memory only: run views are computed from the run record (§5.1, `view` is never stored), and nothing here is
// written anywhere. The run screen (E22) fills it with `setRunSteps`; until then only the dev fixture hook does.
import { useSyncExternalStore } from 'react';
import type { RunStep } from './overlayModel.ts';

type State = { steps: ReadonlyMap<string, readonly RunStep[]>; still: boolean };
let state: State = { steps: new Map(), still: false };
const subs = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** Show `steps` over the diagram block `blockId`; `null` removes the overlay. */
export function setRunSteps(blockId: string, steps: readonly RunStep[] | null) {
  const m = new Map(state.steps);
  if (steps) m.set(blockId, steps);
  else m.delete(blockId);
  emit({ ...state, steps: m });
}

export function clearRuns() {
  if (state.steps.size) emit({ ...state, steps: new Map() });
}

/** Pause the pulse and flowing dashes (WCAG 2.2.2), for every overlay. */
export function setStill(still: boolean) {
  if (still !== state.still) emit({ ...state, still });
}

export const runStepsFor = (blockId: string): readonly RunStep[] | undefined => state.steps.get(blockId);

export function useRunSteps(blockId: string | undefined): readonly RunStep[] | undefined {
  return useSyncExternalStore(subscribe, () => (blockId ? state.steps.get(blockId) : undefined));
}

/** Every block with a run overlay. */
export function useRunBlocks(): ReadonlyMap<string, readonly RunStep[]> {
  return useSyncExternalStore(subscribe, () => state.steps);
}

export function useStill(): boolean {
  return useSyncExternalStore(subscribe, () => state.still);
}
