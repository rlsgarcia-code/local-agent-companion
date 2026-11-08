import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { Goals } from "../packages/agent-service/src/goals";
import { evaluateGoalEvidence } from "../packages/agent-core/src/goal-evaluation";
import { createGoalDraft, type GoalRecord } from "../packages/contracts/src/goal-state";
import { contentHash } from "../packages/contracts/src/identity";
import { runSpec, type Registration, type Run } from "../packages/contracts/src/index";
const reg: Registration = { id: "goals", product: "companion-vscode", profile: "default", workspace: "", providers: ["ollama"], hostTools: [] };
const input = { runtime: "standard" as const, mode: "plan" as const, finalReview: "changes" as const, objective: "Read and verify the fixture" };
const spec = runSpec.parse({ runtime: "standard", mode: "plan", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } },
  messages: [{ role: "user", content: "Read the fixture" }], systemPrompt: "Test", tools: [] });

test("goal admission, iteration counting and completion share the run transaction", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-goals-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  let finish!: (value: unknown) => void;
  const service = new AgentService(store, directory, () => new Promise((resolve) => { finish = resolve; }));
  try {
    const session = store.createSession(reg, "Goal");
    const goal = await service.dispatch(reg, "goals.create", { ...input, key: "goal", sessionId: session.id }, "host") as GoalRecord;
    const request = { sessionId: session.id, key: "iteration-one", spec: { ...spec, goalId: goal.id } };
    await assert.rejects(service.dispatch(reg, "runs.start", request, "host"), /not active/);
    assert.equal(store.runs(reg, session.id).length, 0);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM receipts").get() && (store.db.prepare("SELECT count(*) AS count FROM receipts").get() as { count: number }).count, 0);
    await service.dispatch(reg, "goals.activate", { id: goal.id }, "host");
    const first = await service.dispatch(reg, "runs.start", request, "host") as Run;
    assert.equal((await service.dispatch(reg, "runs.start", request, "host") as Run).id, first.id);
    assert.equal((await service.dispatch(reg, "goals.get", { id: goal.id }, "host") as GoalRecord).iteration, 1);
    await assert.rejects(service.dispatch(reg, "goals.edit", { id: goal.id, revision: 1, changes: { title: "Changed while running" } }, "host"), /active goal iteration/);
    finish({ text: "Done", goalEvaluation: { decision: "completed", criteria: [{ id: goal.criteria[0]!.id, status: "verified", evidence: ["Fixture read"], evidenceRefs: [{ kind: "note", summary: "Fixture read", iteration: 1 }] }], completedMilestones: [goal.milestones[0]!.id], reason: "Verified" } });
    for (let i = 0; i < 100 && store.run(reg, first.id).state !== "completed"; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(store.run(reg, first.id).state, "completed");
    const completed = await service.dispatch(reg, "goals.get", { id: goal.id }, "host") as GoalRecord;
    assert.equal(completed.status, "completed");
    assert.equal(completed.iteration, 1);
    await assert.rejects(service.dispatch(reg, "goals.continue", { id: goal.id }, "host"), /cannot continue/);
  } finally { service.close(); await rm(directory, { recursive: true, force: true }); }
});

test("goals enforce product isolation, revisions and the existing 20-goal and iteration limits", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-goal-limits-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  const goals = new Goals(store);
  try {
    const session = store.createSession(reg, "Limits");
    for (let i = 0; i < 20; i++) goals.create(reg, { ...input, key: `goal-${i}`, sessionId: session.id });
    assert.throws(() => goals.create(reg, { ...input, key: "over-limit", sessionId: session.id }), /20-goal/);
    assert.throws(() => goals.get({ ...reg, product: "companion-mac" }, "goal-0"), /not found/);
    const goal = goals.get(reg, "goal-0");
    assert.equal(goals.create(reg, { ...input, key: goal.id, sessionId: session.id }).id, goal.id);
    assert.throws(() => goals.create(reg, { ...input, objective: "Different", key: goal.id, sessionId: session.id }), /different request/);
    const edited = goals.edit(reg, { id: goal.id, revision: 1, changes: { criteria: [{ id: "new-criterion", text: "New criterion" }] } });
    assert.ok(edited.milestones[0]!.criteriaIds.includes("new-criterion"));
    assert.throws(() => goals.edit(reg, { id: goal.id, revision: 1, changes: { title: "Stale" } }), /Refresh/);
    goals.save(reg, { ...edited, status: "paused", iteration: 20 });
    assert.throws(() => goals.transition(reg, goal.id, "continue"), /exhausted/);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("model claims cannot verify criteria using absent or altered operation receipts", async () => {
  const goal = createGoalDraft({ id: "goal", threadId: "session", objective: "Verify fixture", runtime: "standard", autonomyMode: "plan", finalReview: "changes" });
  const proof = { operationId: "run:tool", kind: "test" as const, status: "completed", result: { exitCode: 0, output: "fixture passed" } };
  const evaluate = async (digest: string) => {
    const model = { invoke: async () => ({ text: JSON.stringify({ decision: "completed", criteria: [{ id: goal.criteria[0]!.id, status: "verified", evidence: ["fixture passed"], evidenceRefs: [{ kind: "test", summary: "fixture passed", iteration: 1, operationId: proof.operationId, resultSha256: digest }] }], completedMilestones: [], reason: "Result" }) }) } as unknown as BaseChatModel;
    return evaluateGoalEvidence(model, goal, "Claimed done", [proof], new AbortController().signal);
  };
  assert.equal((await evaluate("0".repeat(64))).criteria[0]!.status, "pending");
  assert.equal((await evaluate(contentHash(proof.result))).criteria[0]!.status, "verified");
});
