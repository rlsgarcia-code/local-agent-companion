import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_GOAL_ITERATIONS,
  MAX_GOAL_STAGNATION,
  applyGoalEvaluation,
  createGoalDraft,
  startGoalIteration
} from "../src/goal-state";

const draft = () => createGoalDraft({
  id: "goal-test",
  objective: "Deliver a verified feature",
  threadId: "thread-test",
  runtime: "standard",
  autonomyMode: "review",
  finalReview: "changes",
  now: 1
});

test("creates a durable draft without chat or secrets", () => {
  const goal = draft();
  assert.equal(goal.status, "awaiting-criteria");
  assert.equal(goal.iteration, 0);
  assert.equal(JSON.stringify(goal).includes("messages"), false);
  assert.equal(JSON.stringify(goal).includes("apiKey"), false);
});

test("requires evidence before completion", () => {
  const goal = startGoalIteration({ ...draft(), status: "active" }, "run-1", 2);
  const pending = applyGoalEvaluation(goal, {
    decision: "completed",
    criteria: [{ id: goal.criteria[0]!.id, status: "verified", evidence: [] }],
    completedMilestones: [],
    reason: "claimed"
  }, 3);
  assert.notEqual(pending.status, "completed");
  const complete = applyGoalEvaluation(goal, {
    decision: "completed",
    criteria: [{ id: goal.criteria[0]!.id, status: "verified", evidence: ["test passed"] }],
    completedMilestones: [goal.milestones[0]!.id],
    reason: "verified"
  }, 4);
  assert.equal(complete.status, "completed");
});

test("pauses after repeated stagnation and iteration cap", () => {
  let goal = startGoalIteration({ ...draft(), status: "active" }, "run-1", 2);
  const evaluation = { decision: "continue" as const, criteria: [], completedMilestones: [], reason: "no evidence" };
  goal = applyGoalEvaluation(goal, evaluation, 3);
  goal = applyGoalEvaluation(goal, evaluation, 4);
  goal = applyGoalEvaluation(goal, evaluation, 5);
  assert.equal(goal.status, "paused");
  assert.equal(MAX_GOAL_STAGNATION, 2);
  assert.equal(MAX_GOAL_ITERATIONS, 20);
});
