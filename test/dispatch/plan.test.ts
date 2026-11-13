import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlan, planOrder, planProblem, resolvedStep, MAX_PLAN_STEPS, MAX_PLAN_TASK, type Plan } from '../../shared/dispatch/plan.ts';
import { planDiagram, planOrderIn } from '../../shared/dispatch/plan-diagram.ts';

const base = (steps: unknown[], extra: Record<string, unknown> = {}) => ({ v: 1, block: 'b1', steps, ...extra });

test('planProblem accepts a full plan and the minimal shape', () => {
  assert.equal(planProblem(base([])), null);
  assert.equal(
    planProblem(
      base(
        [
          { id: 'plan', node: 'plan', role: 'lead', model: 'm', effort: 'high' },
          { node: 'impl', n: 2, task: 'do it', perm: 'acceptEdits', after: ['plan'] },
          { id: 'merge', gate: 'manual' },
        ],
        { defaults: { provider: 'claude', perm: 'plan' } },
      ),
    ),
    null,
  );
});

test('planProblem refuses bad shapes with a message naming the field', () => {
  const cases: [unknown, RegExp][] = [
    [null, /plan must be an object/],
    [{ v: 0, block: 'b', steps: [] }, /plan\.v/],
    [{ v: 1, steps: [] }, /plan\.block/],
    [{ v: 1, block: 'b' }, /plan\.steps must be an array/],
    [base([{}]), /needs an id or a node/],
    [base([{ id: 'a' }, { node: 'a' }]), /duplicate step id "a"/],
    [base([{ id: 'a', perm: 'bypassPermissions' }]), /perm must be one of/],
    [base([{ id: 'a', gate: 'later' }]), /gate must be one of/],
    [base([{ id: 'a', n: 5 }]), /n must be an integer 1-4/],
    [base([{ id: 'a', n: 1.5 }]), /n must be an integer/],
    [base([{ id: 'a', task: 'x'.repeat(MAX_PLAN_TASK + 1) }]), /task must be a string/],
    [base([{ id: 'x'.repeat(201) }]), /id must be a string of 1-200/],
    [base([{ id: 'a', model: '' }]), /model must be a string/],
    [base([{ id: 'a', after: 'b' }]), /after must be an array/],
    [base([{ id: 'a', after: [1] }]), /after entries/],
    [base([], { defaults: [] }), /defaults must be an object/],
    [base([], { defaults: { perm: 'yolo' } }), /plan\.defaults\.perm/],
    [base(Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => ({ id: `s${i}` }))), /more than 200/],
  ];
  for (const [p, re] of cases) assert.match(planProblem(p) ?? '', re, JSON.stringify(p).slice(0, 80));
});

test('a newer plan v is only checked for its v and kept verbatim', () => {
  const newer = { v: 2, whatever: { x: 1 } } as unknown as Plan;
  assert.equal(planProblem(newer), null);
  assert.equal(cleanPlan(newer), newer);
});

test('cleanPlan drops unknown fields and fills id / node from each other', () => {
  const p = cleanPlan(
    base([{ node: 'impl', extra: 1, after: ['a', 'a'] }, { id: 'merge', role: 'lead', secret: 'x' }], { defaults: { perm: 'plan', junk: 1 }, junk: true }) as unknown as Plan,
  );
  assert.deepEqual(p, {
    v: 1,
    block: 'b1',
    defaults: { perm: 'plan' },
    steps: [
      { id: 'impl', node: 'impl', after: ['a'] },
      { id: 'merge', node: 'merge', role: 'lead' },
    ],
  });
});

test('resolvedStep fills defaults only where the step has nothing', () => {
  const p = cleanPlan(base([{ id: 'a', perm: 'auto' }], { defaults: { perm: 'plan', role: 'impl' } }) as unknown as Plan);
  assert.deepEqual(resolvedStep(p, p.steps[0]!), { id: 'a', node: 'a', perm: 'auto', role: 'impl' });
});

const CODE = 'plan [label: "Plan"]\nimpl\nreview\ntest\nmerge\nnote\nplan > impl > review > merge\nimpl > test > merge\nnote > plan';
const blocks = [{ id: 'b1', type: 'flowchart', code: CODE }];
const plan = (steps: unknown[]) => cleanPlan(base(steps) as unknown as Plan);

test('planOrder takes the order from the diagram edges, ignoring non-step nodes', () => {
  const r = planOrderIn(plan([{ id: 'merge' }, { id: 'test' }, { id: 'review' }, { id: 'impl' }, { id: 'plan' }]), blocks);
  assert.ok(r.ok);
  assert.deepEqual(r.order, ['plan', 'impl', 'test', 'review', 'merge']);
  assert.deepEqual(r.after.merge?.sort(), ['review', 'test']);
  assert.deepEqual(r.after.plan, []); // `note` is not a step
  assert.deepEqual(r.missingNodes, []);
});

test('explicit after overrides the edges and a step without a node still runs', () => {
  const r = planOrderIn(plan([{ id: 'plan' }, { id: 'impl', after: [] }, { id: 'docs', node: 'nowhere', after: ['impl'] }]), blocks);
  assert.ok(r.ok);
  assert.deepEqual(r.after.impl, []);
  assert.deepEqual(r.order, ['plan', 'impl', 'docs']);
  assert.deepEqual(r.missingNodes, ['docs']);
});

test('planOrder names a cycle, an unknown after, a missing block and a newer v', () => {
  const cyc = planOrder(plan([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'x' }]), {
    nodes: ['a', 'b', 'c', 'x'],
    edges: [
      { from: 'x', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ],
  });
  assert.equal(cyc.ok, false);
  assert.ok(!cyc.ok);
  assert.deepEqual(cyc.cycle, ['a', 'b', 'c', 'a']);
  assert.match(cyc.problem, /cycle: a > b > c > a/);

  const unk = planOrderIn(plan([{ id: 'a', after: ['ghost'] }]), blocks);
  assert.ok(!unk.ok && /"ghost", which is not a step/.test(unk.problem));

  const gone = planOrderIn(plan([{ id: 'a' }]), []);
  assert.ok(!gone.ok && /not a diagram block/.test(gone.problem));

  const newer = planOrder({ v: 9, block: 'b1', steps: [] }, { nodes: [], edges: [] });
  assert.ok(!newer.ok && /newer/.test(newer.problem));
});

test('planDiagram reads nested nodes, and only from graph blocks', () => {
  const d = planDiagram({ block: 'g' }, [{ id: 'g', type: 'architecture', code: 'VPC {\n  API\n}\nUsers > API' }]);
  assert.deepEqual(d?.nodes.sort(), ['API', 'Users']);
  assert.deepEqual(d?.edges, [{ from: 'Users', to: 'API' }]);
  assert.equal(planDiagram({ block: 's' }, [{ id: 's', type: 'sequence', code: 'A > B: hi' }]), null);
});
