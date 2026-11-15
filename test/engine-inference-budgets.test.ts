import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { FakeToolCallingModel, createAgent, summarizationMiddleware } from "langchain";
import { ChatOpenAICompletions } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { AgentService, type GraphExecutor } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { InferenceBudgets } from "../packages/agent-service/src/inference-budgets";
import { executeGraph } from "../packages/agent-core/src/index";
import { InferenceBudgetCallback, type InferenceBudgetPort } from "../packages/agent-core/src/inference-budget";
import { OllamaDesktopRuntime } from "../packages/agent-core/src/desktop-runtime";
import { runSpec, type Registration, type Run, type Session } from "../packages/contracts/src/index";
import type { InferenceBudgetPolicy, InferenceBudgetSnapshot } from "../packages/contracts/src/inference-budget";
import type { GameProject } from "../packages/contracts/src/games";
import { fixtureGameDocument } from "./game-fixtures";

const reg: Registration = { id: "inference-fixture", product: "companion-vscode", profile: "test", workspace: "", providers: ["ollama"], hostTools: [] };
const policy = (calls = 10): InferenceBudgetPolicy => ({ namespace: { callsPerBlock: calls, tokensPerBlock: 1000, maxBlocks: 4 }, stage: { callsPerBlock: calls, tokensPerBlock: 1000, maxBlocks: 4 }, unknownTokensPerCall: 10 });
const spec = runSpec.parse({ runtime: "standard", mode: "plan", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } },
  messages: [{ role: "user", content: "Read the saved game only" }], systemPrompt: "Read-only simulated inference", tools: [] });
const call = <T>(service: AgentService, method: string, input: unknown = {}, r = reg, connection = "client") => service.dispatch(r, method, input, connection) as Promise<T>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(fn: () => boolean | Promise<boolean>) { for (let i = 0; i < 1000; i++) { if (await fn()) return; await tick(); } throw new Error("Inference fixture did not reach the expected state"); }
async function fixture(execute: GraphExecutor = (request, context) => executeGraph(request, { ...context, model: new FakeToolCallingModel() }), configured = policy()) {
  const directory = await mkdtemp(path.join(tmpdir(), "inference-budget-")), file = path.join(directory, "state.sqlite");
  const service = new AgentService(new Store(file), directory, execute, {}, { inferenceBudgetPolicy: configured });
  return { service, directory, file, execute, configured, async close() { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
async function session(service: AgentService, name: string) {
  const s = await call<Session>(service, "sessions.create", { title: name });
  const project = await call<GameProject>(service, "games.projects.create", { requestId: name, document: fixtureGameDocument() });
  await call(service, "games.projects.select", { sessionId: s.id, projectId: project.id }); return { session: s, project };
}
const budgets = (service: AgentService, sessionId: string) => call<InferenceBudgetSnapshot>(service, "inference.budgets.get", { sessionId });
async function completed(service: AgentService, run: Run) {
  await until(() => ["completed", "failed"].includes(service.store.run(reg, run.id).state));
  const current = service.store.run(reg, run.id); assert.equal(current.state, "completed", current.error);
}

test("admission reserves tokens atomically; reported, missing, failed and recovered usage cannot refund model calls", async () => {
  const store = new Store(":memory:"), session = store.createSession(reg, "Meter fixture"), run = store.start(reg, session.id, "run", spec).run;
  const meter = new InferenceBudgets(store, policy(2)), scopes = [{ kind: "namespace" as const }];
  try {
    assert.equal(meter.begin(reg, run.id, "one", scopes), null); assert.equal(meter.begin(reg, run.id, "one", scopes), null);
    assert.equal(meter.snapshot(reg, scopes).budgets[0]!.pendingCalls, 1);
    meter.finish(reg, run.id, "one", { input: 3, output: 2 }); meter.finish(reg, run.id, "one", { input: 3, output: 2 });
    assert.throws(() => meter.begin(reg, run.id, "one", scopes), /already settled/);
    assert.equal(meter.begin(reg, run.id, "two", scopes), null); meter.recover(); meter.recover();
    const current = meter.snapshot(reg, scopes).budgets[0]!;
    assert.equal(current.calls, 2); assert.equal(current.chargedTokens, 15); assert.equal(current.reportedInput, 3); assert.equal(current.reportedOutput, 2);
    assert.equal(current.unreportedCalls, 1); assert.equal(current.pendingCalls, 0); assert.equal(current.exhausted, true);
    assert.ok(meter.begin(reg, run.id, "blocked", scopes));
    assert.throws(() => meter.finish(reg, run.id, "one", { input: -1, output: 2 }), /nonnegative/);
    assert.equal((store.db.prepare("SELECT count(*) AS n FROM inference_calls").get() as { n: number }).n, 2);
  } finally { store.close(); }
});

test("token reservations stop the next call before the call-count cap, and provider overages never become free usage", () => {
  const store = new Store(":memory:"), session = store.createSession(reg, "Tokens"), run = store.start(reg, session.id, "tokens", spec).run;
  const meter = new InferenceBudgets(store, { ...policy(), namespace: { ...policy().namespace, tokensPerBlock: 20 } }), scopes = [{ kind: "namespace" as const }];
  try {
    meter.begin(reg, run.id, "first", scopes); meter.finish(reg, run.id, "first", { input: 14, output: 4 });
    const blocked = meter.begin(reg, run.id, "second", scopes)!; assert.ok(blocked); assert.equal(blocked.budgets[0]!.calls, 1); assert.equal(blocked.budgets[0]!.authorizedCalls, 10);
    meter.grant(reg, "tokens", blocked); assert.equal(meter.begin(reg, run.id, "second", scopes), null);
    meter.finish(reg, run.id, "second", { input: 20, output: 10 });
    const overdrawn = meter.snapshot(reg, scopes).budgets[0]!; assert.equal(overdrawn.chargedTokens, 48); assert.equal(overdrawn.authorizedTokens, 40);
    assert.ok(meter.begin(reg, run.id, "third", scopes)); assert.equal(meter.snapshot(reg, scopes).budgets[0]!.calls, 2);
  } finally { store.close(); }
});

test("concurrent model invocations cannot race admission or run the rejected provider call", async () => {
  const store = new Store(":memory:"), session = store.createSession(reg, "Concurrent"), run = store.start(reg, session.id, "concurrent", spec).run;
  const meter = new InferenceBudgets(store, policy(1)), scopes = [{ kind: "namespace" as const }];
  const model = new class extends FakeToolCallingModel {
    executions = 0;
    override async _generate(...args: Parameters<FakeToolCallingModel["_generate"]>) { this.executions++; return super._generate(...args); }
  }();
  const callback = new InferenceBudgetCallback({ begin: async (id) => { if (meter.begin(reg, run.id, id, scopes)) throw new Error("Synthetic quota rejection before provider call"); }, finish: (id, usage) => meter.finish(reg, run.id, id, usage) });
  try {
    const results = await Promise.allSettled([model.invoke("one", { callbacks: [callback] }), model.invoke("two", { callbacks: [callback] })]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(model.executions, 1);
    assert.equal(meter.snapshot(reg, scopes).budgets[0]!.calls, 1); assert.equal(meter.snapshot(reg, scopes).budgets[0]!.pendingCalls, 0);
  } finally { store.close(); }
});

test("failed admission leaves no partial scope debit; stale decisions and restart policy cannot expand allocations", () => {
  const store = new Store(":memory:"), session = store.createSession(reg, "Atomic fixture"), run = store.start(reg, session.id, "run", spec).run;
  const meter = new InferenceBudgets(store, policy(1)), scopes = [{ kind: "namespace" as const }];
  try {
    store.db.exec("CREATE TRIGGER reject_inference BEFORE INSERT ON inference_calls BEGIN SELECT RAISE(ABORT,'fixture rejected'); END");
    assert.throws(() => meter.begin(reg, run.id, "one", scopes), /fixture rejected/); assert.equal(meter.snapshot(reg, scopes).budgets[0]!.calls, 0);
    store.db.exec("DROP TRIGGER reject_inference"); meter.begin(reg, run.id, "one", scopes); meter.finish(reg, run.id, "one");
    const exhausted = meter.snapshot(reg, scopes); meter.grant(reg, "decision", exhausted); meter.grant(reg, "decision", exhausted); meter.grant(reg, "other-window", exhausted);
    assert.equal(meter.snapshot(reg, scopes).budgets[0]!.authorizedCalls, 2);
    assert.throws(() => meter.grant(reg, "decision", { budgets: exhausted.budgets.map((b) => ({ ...b, version: b.version + 1 })) }), /identity changed/);
    const lowered = new InferenceBudgets(store, { ...policy(1), namespace: { ...policy(1).namespace, maxBlocks: 1 } });
    assert.equal(lowered.snapshot(reg, scopes).budgets[0]!.authorizedCalls, 1); assert.equal(lowered.snapshot(reg, scopes).budgets[0]!.canContinue, false);
    const raised = new InferenceBudgets(store, policy(100)); assert.equal(raised.snapshot(reg, scopes).budgets[0]!.authorizedCalls, 2);
  } finally { store.close(); }
});

test("official Standard/Deep share planner, supervisor and game-specialist admission, pausing nested work before provider execution", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const model = new FakeToolCallingModel({ toolCalls: [[runtime === "deep" ? { name: "task", args: { subagent_type: "game-design-director", description: "Read the linked project without changes" }, id: "delegate" } : { name: "game_studio", args: {}, id: "read" }], []] });
    const planner = new FakeToolCallingModel({ toolCalls: [[], [{ name: "game_studio", args: {}, id: "specialist-read" }], []] });
    const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner, evaluator: model },
      inferenceBudget: { ...context.inferenceBudget!, begin: async (id) => { await Promise.all([context.inferenceBudget!.begin(id), context.inferenceBudget!.begin(id)]); } } }), policy(2));
    try {
      const s = await session(f.service, runtime), request = { ...spec, runtime, provider: { ...spec.provider, roles: { ...spec.provider.roles, ...(runtime === "deep" ? { planner: "planner" } : {}) } } };
      const run = await call<Run>(f.service, "runs.start", { sessionId: s.session.id, key: runtime, spec: request });
      let approvals = 0;
      await until(async () => {
        const pending = await call<{ id: string; payload: { tool: string; budget: InferenceBudgetSnapshot } }[]>(f.service, "host.poll");
        for (const entry of pending) {
          assert.equal(f.service.store.run(reg, run.id).state, "awaiting_approval"); assert.equal(entry.payload.tool, "inference_budget"); approvals++;
          const before = await budgets(f.service, s.session.id); assert.ok(before.budgets.some((b) => b.exhausted));
          await call(f.service, "approvals.respond", { id: entry.id, value: true }); await call(f.service, "approvals.respond", { id: entry.id, value: true });
        }
        return ["completed", "failed"].includes(f.service.store.run(reg, run.id).state);
      });
      await completed(f.service, run); const current = await budgets(f.service, s.session.id), expected = runtime === "deep" ? 5 : 2;
      for (const b of current.budgets) { assert.equal(b.calls, expected); assert.equal(b.unreportedCalls, expected); assert.equal(b.pendingCalls, 0); }
      assert.equal(approvals, runtime === "deep" ? 2 : 0);
      await call(f.service, "runs.start", { sessionId: s.session.id, key: runtime, spec: request }); assert.equal((await budgets(f.service, s.session.id)).budgets[0]!.calls, expected);
    } finally { await f.close(); }
  }
});

test("new projects/sessions cannot reset the namespace allocation; approval survives host disconnection and engine restart", async () => {
  const f = await fixture(undefined, policy(1)); let resumed: AgentService | undefined;
  try {
    const first = await session(f.service, "first"), one = await call<Run>(f.service, "runs.start", { sessionId: first.session.id, key: "one", spec }); await completed(f.service, one);
    const second = await session(f.service, "second"), two = await call<Run>(f.service, "runs.start", { sessionId: second.session.id, key: "two", spec });
    await until(() => f.service.store.run(reg, two.id).state === "awaiting_approval");
    const pending = await call<{ id: string }[]>(f.service, "host.poll"), originalId = pending[0]!.id;
    assert.equal((await budgets(f.service, second.session.id)).budgets[0]!.calls, 1); assert.equal((await budgets(f.service, second.session.id)).budgets[1]!.calls, 0);
    f.service.disconnect("client"); assert.equal((await call<{ id: string }[]>(f.service, "host.poll", {}, reg, "reconnected"))[0]!.id, originalId);
    await f.service.close(); resumed = new AgentService(new Store(f.file), f.directory, f.execute, {}, { inferenceBudgetPolicy: f.configured });
    await call(resumed, "runs.resume", { id: two.id }); await until(async () => (await call<{ id: string }[]>(resumed!, "host.poll")).length > 0);
    const restarted = await call<{ id: string }[]>(resumed, "host.poll"); assert.equal(restarted[0]!.id, originalId);
    await call(resumed, "approvals.respond", { id: originalId, value: true }); await completed(resumed, two);
    const current = await budgets(resumed, second.session.id); assert.equal(current.budgets[0]!.calls, 2); assert.equal(current.budgets[0]!.blocks, 2); assert.equal(current.budgets[1]!.calls, 1);
  } finally { await resumed?.close(); await f.close(); }
});

test("parallel child models share an outstanding decision without losing a waiter or multiplying the grant", async () => {
  let parallel = false;
  const f = await fixture(async (request, context) => {
    if (!parallel) return executeGraph(request, { ...context, model: new FakeToolCallingModel() });
    const callbacks = [new InferenceBudgetCallback(context.inferenceBudget!)];
    await Promise.all([new FakeToolCallingModel().invoke("Child one", { callbacks }), new FakeToolCallingModel().invoke("Child two", { callbacks })]);
    return { text: "Both read-only simulated child calls completed" };
  }, policy(1));
  try {
    const first = await session(f.service, "first"), one = await call<Run>(f.service, "runs.start", { sessionId: first.session.id, key: "seed", spec }); await completed(f.service, one);
    parallel = true;
    const second = await session(f.service, "parallel"), two = await call<Run>(f.service, "runs.start", { sessionId: second.session.id, key: "parallel", spec });
    let approvals = 0;
    await until(async () => {
      const pending = await call<{ id: string }[]>(f.service, "host.poll"); assert.ok(pending.length <= 1);
      for (const entry of pending) { approvals++; await call(f.service, "approvals.respond", { id: entry.id, value: true }); }
      return ["completed", "failed"].includes(f.service.store.run(reg, two.id).state);
    });
    await completed(f.service, two); const current = await budgets(f.service, second.session.id);
    assert.equal(approvals, 2); assert.equal(current.budgets[0]!.calls, 3); assert.equal(current.budgets[0]!.blocks, 3); assert.equal(current.budgets[1]!.calls, 2);
  } finally { await f.close(); }
});

test("declining continuation never calls the next model and cannot be forged as a policy update or another product", async () => {
  const f = await fixture(undefined, policy(1));
  try {
    const first = await session(f.service, "one"), one = await call<Run>(f.service, "runs.start", { sessionId: first.session.id, key: "one", spec }); await completed(f.service, one);
    const second = await session(f.service, "two"), two = await call<Run>(f.service, "runs.start", { sessionId: second.session.id, key: "two", spec });
    await until(() => f.service.store.run(reg, two.id).state === "awaiting_approval");
    const pending = await call<{ id: string }[]>(f.service, "host.poll");
    await assert.rejects(call(f.service, "approvals.respond", { id: pending[0]!.id, value: true }, { ...reg, product: "companion-mac" }), /belong/);
    await call(f.service, "approvals.respond", { id: pending[0]!.id, value: false }); await until(() => f.service.store.run(reg, two.id).state === "failed");
    assert.equal((await budgets(f.service, second.session.id)).budgets[0]!.calls, 1);
    await assert.rejects(call(f.service, "inference.budgets.get", { sessionId: second.session.id, callsPerBlock: 999 }));
    await assert.rejects(call(f.service, "inference.budgets.grant", { sessionId: second.session.id }), /Unknown|unknown|not found/);
    await assert.rejects(call(f.service, "inference.budgets.get", { sessionId: second.session.id }, { ...reg, product: "companion-mac" }), /not found/);
    await assert.rejects(call(f.service, "inference.budgets.get", { sessionId: second.session.id }, { ...reg, product: "kidos" }), /protected adapter/);
  } finally { await f.close(); }
});

test("official summarization and the following agent model inherit the same budget callback", async () => {
  const began = new Set<string>(), ended = new Set<string>();
  const callback = new InferenceBudgetCallback({ begin: async (id) => { began.add(id); }, finish: (id) => { ended.add(id); } });
  const graph = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [summarizationMiddleware({ model: new FakeToolCallingModel(), trigger: { messages: 3 }, keep: { messages: 1 } })] });
  await graph.invoke({ messages: [{ role: "user", content: "First" }, { role: "assistant", content: "First response" }, { role: "user", content: "Continue" }, { role: "assistant", content: "Another response" }, { role: "user", content: "Current request" }] }, { callbacks: [callback] });
  assert.equal(began.size, 2); assert.deepEqual(ended, began);
});

test("Mac Standard/Deep meter structured task interpretation, planner, streamed executor and completion review with real LangChain models", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const requests: string[] = [], began = new Set<string>(), measured = new Map<string, { input: number; output: number } | undefined>();
    const selectedProject = { projectId: "saved-game", engine: "phaser" as const, revision: 23, sourceHash: "c".repeat(64), fileCount: 14, assetCount: 0, hasDesign: true };
    const port: InferenceBudgetPort = { begin: async (id) => { began.add(id); }, finish: (id, usage) => { measured.set(id, usage); } };
    class FixtureRuntime extends OllamaDesktopRuntime {
      protected override createModel(modelName: string, streaming: boolean): ChatOpenAICompletions {
        return new ChatOpenAICompletions({ model: modelName, apiKey: "synthetic-fixture-only", streaming, disableStreaming: !streaming, streamUsage: true, maxRetries: 0,
          configuration: { baseURL: "http://127.0.0.1:11434/v1", fetch: async (_url, init) => {
            const body = JSON.parse(init!.body as string); requests.push(modelName);
            const schema = body.response_format?.json_schema?.name;
            if (schema === "task_contract") assert.ok(JSON.stringify(body.messages).includes(JSON.stringify({ linkedGameProject: selectedProject }).replaceAll('"', '\\"')), "Mac classifier receives the private saved-project snapshot");
            const text = schema === "task_contract" ? JSON.stringify({ outcome: "execution", objective: "Inspect the saved project", reason: "Read-only verification", requiredEvidence: "command_success", acceptanceCriteria: ["A real check must be observed"] }) :
              schema === "completion_verdict" ? JSON.stringify({ verdict: "blocked", reason: "No actual command evidence was produced by this simulated fixture" }) : "Read-only synthetic game explanation.";
            const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 };
            if (!body.stream) return new Response(JSON.stringify({ id: "fixture", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage }), { headers: { "content-type": "application/json" } });
            return new Response([
              { id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
              { id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
            ].map((row) => `data: ${JSON.stringify(row)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
          } } });
      }
    }
    const directory = await mkdtemp(path.join(tmpdir(), "desktop-inference-")), saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite")), desktop = new FixtureRuntime(saver);
    try {
      await writeFile(path.join(directory, "README.md"), "Temporary fixture; no personal files or inference endpoints are used.");
      const result = await desktop.run({ thread: { id: "fixture", title: "Read game", messages: [], createdAt: Date.now(), updatedAt: Date.now() }, request: "Explain this saved game without changing it", workspacePath: directory,
        modelRoles: { executor: "executor", evaluator: "evaluator", ...(runtime === "deep" ? { planner: "planner" } : {}) }, dockerSandboxEnabled: false,
        mode: "execute", agentRuntime: runtime, assistantMessageId: "answer", contextPages: [], openPreview: async () => {}, inferenceBudget: port,
        gameProduction: { catalog: [], invoke: async () => assert.fail("Read-only fixture cannot invoke game operations"), evidence: () => ({ changes: [], projects: [] }), currentProject: () => selectedProject },
        callbacks: { approval: async () => false, activity: () => {}, delta: () => {}, step: () => {}, reset: () => {} } });
      assert.match(result.message.text, /A tarefa não foi concluída nem verificada/); assert.deepEqual(result.changes, []); assert.equal(result.message.status, "failed");
      assert.equal(requests.length, runtime === "deep" ? 4 : 3); assert.equal(began.size, requests.length); assert.equal(measured.size, began.size);
      for (const value of measured.values()) assert.deepEqual(value, { input: 7, output: 3 });
      assert.ok(requests.includes("evaluator")); if (runtime === "deep") assert.ok(requests.includes("planner"));
      assert.match(await readFile(path.join(directory, "README.md"), "utf8"), /Temporary fixture/);
    } finally { await desktop.shutdown(); saver.db.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
