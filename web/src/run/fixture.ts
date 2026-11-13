// A fixed run for checks while the run screen (E22) is not there yet: the five-step pipeline from the design doc
// (§3 example), one step in each display state. Used by tests and by the dev-only `?runFixture=<blockId>` hook.
import type { RunStep } from './overlayModel.ts';

export const FIXTURE_CODE = ['plan [label: "Plan"]', 'impl [label: "Implement"]', 'review [label: "Review"]', 'test [label: "Test"]', 'merge [label: "Merge"]', 'plan > impl > review > merge', 'impl > test > merge'].join('\n');

export const FIXTURE_STEPS: readonly RunStep[] = [
  { id: 'plan', title: 'Plan', view: 'done', agents: [{ name: 'Mira', role: 'lead' }] },
  { id: 'impl', title: 'Implement', view: 'done', agents: [{ name: 'Juno', role: 'impl' }, { name: 'Tali', role: 'impl' }] },
  { id: 'review', title: 'Review', view: 'review', waiting: true, agents: [{ name: 'Oren', role: 'review' }] },
  { id: 'test', title: 'Test', view: 'active', agents: [{ name: 'Pell', role: 'test' }] },
  { id: 'merge', title: 'Merge', view: 'pending' },
];

/** The same run with the test step blocked (a failed session): no animation on it, red ring and ⚠. */
export const FIXTURE_BLOCKED: readonly RunStep[] = FIXTURE_STEPS.map((s) => (s.id === 'test' ? { ...s, view: 'blocked' as const } : s));
