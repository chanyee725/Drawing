import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP_VIEWS, carryBefore, edgeView, linkSteps, progress, progressLabel, relinkOffer, stepNode, stepView, waitingOnPerson } from "../../shared/dispatch/step-view.ts";

const ses = (...states) => states.map(state => ({ state }));

test("step node defaults to the step id", () => {
  assert.equal(stepNode({ id: "impl" }), "impl");
  assert.equal(stepNode({ id: "impl", node: "build" }), "build");
});

test("linkSteps: steps without a node are listed, not dropped", () => {
  const r = linkSteps([{ id: "plan" }, { id: "impl", node: "build" }, { id: "gone" }], ["plan", "build", "extra"]);
  assert.deepEqual([...r.linked], [["plan", "plan"], ["impl", "build"]]);
  assert.deepEqual(r.missing, ["gone"]);
});

test("relinkOffer: only one lost step and one new node", () => {
  const steps = [{ id: "plan" }, { id: "impl" }];
  assert.deepEqual(relinkOffer(steps, ["plan", "impl"], ["plan", "build"]), { step: "impl", node: "build" });
  assert.equal(relinkOffer(steps, ["plan", "impl"], ["plan", "build", "lint"]), null, "two new nodes");
  assert.equal(relinkOffer(steps, ["plan", "impl"], ["build"]), null, "two lost steps");
  assert.equal(relinkOffer(steps, ["plan", "impl"], ["plan", "impl", "build"]), null, "nothing lost");
  assert.equal(relinkOffer([{ id: "a" }, { id: "b", node: "x" }], ["a"], ["x"]), null, "new node already claimed");
});

test("stepView: five states from stage and sessions", () => {
  assert.equal(stepView({ sessions: [] }), "pending");
  assert.equal(stepView({ stage: "plan", sessions: ses("working") }), "pending");
  for (const stage of ["impl", "test", "merge"]) assert.equal(stepView({ stage, sessions: ses("working") }), "active");
  assert.equal(stepView({ stage: "review", sessions: ses("working") }), "review");
  assert.equal(stepView({ stage: "done", sessions: ses("done") }), "done");
  assert.equal(stepView({ stage: "blocked", sessions: [] }), "blocked");
  assert.equal(stepView({ stage: "impl", sessions: ses("working", "stuck") }), "blocked");
  assert.equal(stepView({ stage: "review", sessions: ses("failed") }), "blocked");
  assert.equal(stepView({ stage: "impl", sessions: ses("working"), paused: true }), "blocked");
  assert.equal(stepView({ stage: "done", sessions: ses("failed") }), "done", "a finished step stays done");
});

test("stepView without a board stage falls back to sessions", () => {
  assert.equal(stepView({ sessions: ses("working", "done") }), "active");
  assert.equal(stepView({ sessions: ses("done", "done") }), "done");
  assert.equal(stepView({ sessions: ses("resting") }), "active");
});

test("waiting on a person is a tag, not a state", () => {
  const s = { stage: "impl", sessions: ses("waiting") };
  assert.equal(stepView(s), "active");
  assert.equal(waitingOnPerson(s), true);
  assert.equal(waitingOnPerson({ stage: "plan", sessions: ses("waiting") }), false);
  assert.equal(waitingOnPerson({ stage: "review", sessions: ses("working") }), false);
});

test("every state has a glyph and a label", () => {
  assert.deepEqual(Object.keys(STEP_VIEWS), ["pending", "active", "review", "done", "blocked"]);
  for (const v of Object.values(STEP_VIEWS)) assert.ok(v.label && v.glyph);
});

test("edgeView", () => {
  assert.equal(edgeView("done", "active"), "flow");
  assert.equal(edgeView("done", "review"), "flow");
  assert.equal(edgeView("done", "done"), "done");
  assert.equal(edgeView("active", "pending"), "none");
  assert.equal(edgeView("done", "blocked"), "none");
});

test("carryBefore keeps the pre-block view across updates", () => {
  let before = carryBefore("review", undefined, "blocked");
  assert.equal(before, "review");
  before = carryBefore("blocked", before, "blocked");
  assert.equal(before, "review");
  assert.equal(carryBefore("blocked", before, "active"), undefined);
});

test("progress: weighted, rounded down, blocked keeps its weight, abandoned leave", () => {
  const p = progress([
    { view: "done" }, { view: "done" }, { view: "active" }, { view: "blocked", before: "review" }, { view: "pending" },
    { view: "pending", abandoned: true },
  ]);
  // (10 + 10 + 5 + 8 + 0) / 50 = 66%
  assert.deepEqual(p, { total: 5, done: 2, blocked: 1, remaining: 3, percent: 66 });
  assert.equal(progressLabel(p), "5단계 중 2 완료 · 66% · 남은 3 (막힘 1)");
  assert.equal(progress([{ view: "done" }, { view: "review" }, { view: "review" }]).percent, 86, "2.6/3 rounds down");
  assert.equal(progress([{ view: "done" }, { view: "done" }]).percent, 100);
  assert.equal(progress([{ view: "blocked" }]).percent, 0);
  assert.equal(progress([]).percent, 0);
  assert.equal(progressLabel(progress([{ view: "done" }, { view: "active" }])), "2단계 중 1 완료 · 75% · 남은 1");
});
