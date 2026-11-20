import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { runSpec, type Registration, type Run, type ToolSpec } from "../packages/contracts/src/index";
import type { InstalledAdapter, InstalledToolInvocation, InstalledToolReconciliation } from "../packages/agent-core/src/installed-adapter";

const definition: ToolSpec = { name: "kidos_game_bundle_play", description: "Fixture", schema: { type: "object" }, effect: "external", host: "kidos-core" };
const registration: Registration = { id: "kid", product: "kidos", profile: "child", workspace: "", providers: ["kidos-gateway"], hostTools: [definition.name], toolCatalog: [definition] };
const spec = runSpec.parse({ runtime: "standard", mode: "execute", provider: { kind: "kidos-gateway", endpoint: "http://127.0.0.1:8788", roles: { executor: "managed-by-guardian" } }, messages: [{ role: "user", content: "Fixture only" }], systemPrompt: "", tools: [definition] });
async function wait(service: AgentService, run: Run, state: string) {
  for (let i = 0; i < 200; i++) {
    const current = await service.dispatch(registration, "runs.get", { id: run.id }, "ui") as Run;
    if (current.state === state) return current;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Expected ${state}`);
}

test("service identity survives recovery and signed inspection overrides a forged UI result without another effect", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "installed-inspection-"));
  let effects = 0, inspections = 0;
  const invocations: InstalledToolInvocation[] = [];
  let answer: InstalledToolReconciliation = { state: "unknown" };
  const observed = { kind: "kidos-tool-result", tool: "game_bundle_play", ok: true, result: { state: "closed", historical: true } };
  const adapter: InstalledAdapter = { product: "kidos", validate() {}, prepareTool(_reg, _tool, input) { return input; },
    async invokeTool(_reg, _tool, _input, _signal, invocation) {
      assert.ok(invocation && Object.isFrozen(invocation));
      assert.match(invocation.id, /^engine-[a-f0-9]{64}$/); invocations.push(invocation);
      effects++; throw new Error("Response lost after possible effect");
    },
    async reconcileTool(_reg, tool, invocation) {
      assert.equal(tool.name, definition.name); assert.deepEqual(invocation, invocations[0]);
      inspections++; return answer;
    },
    async execute(_spec, context) {
      return { text: JSON.stringify(await context.invokeTool(definition, { game_id: "fixture" }, "same-call")) };
    },
  };
  let store = new Store(path.join(directory, "metadata.sqlite"));
  let service = new AgentService(store, directory, undefined, {}, { adapter });
  try {
    const session = store.createSession(registration, "Fixture");
    const run = await service.dispatch(registration, "runs.start", { sessionId: session.id, key: "one", spec }, "ui") as Run;
    await wait(service, run, "awaiting_reconciliation");
    assert.equal(effects, 1);
    await service.close();
    store = new Store(path.join(directory, "metadata.sqlite"));
    service = new AgentService(store, directory, undefined, {}, { adapter });
    await assert.rejects(service.dispatch(registration, "tools.inspect", { runId: run.id, callId: "same-call", result: { forged: true } }, "ui"));
    await assert.rejects(service.dispatch(registration, "tools.inspect", { runId: run.id, callId: "same-call" }, "ui"), /Core has not confirmed/);
    assert.equal(store.receipt(registration, `${run.id}:same-call`)?.status, "started");
    answer = { state: "unsupported" };
    await assert.rejects(service.dispatch(registration, "tools.inspect", { runId: run.id, callId: "same-call" }, "ui"), /does not support/);
    answer = { state: "known" } as InstalledToolReconciliation;
    await assert.rejects(service.dispatch(registration, "tools.inspect", { runId: run.id, callId: "same-call" }, "ui"));
    assert.equal(store.receipt(registration, `${run.id}:same-call`)?.status, "started");
    answer = { state: "known", result: observed };
    await service.dispatch(registration, "tools.reconcile", { runId: run.id, callId: "same-call", result: { forged: true } }, "ui");
    assert.deepEqual(store.receipt(registration, `${run.id}:same-call`)?.value, observed);
    await service.dispatch(registration, "runs.resume", { id: run.id }, "ui");
    await wait(service, run, "completed");
    assert.equal(effects, 1); assert.equal(inspections, 4);
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const closeBeforeInspectionStarts of [false, true]) test(`concurrent inspections and shutdown preserve unknown effects (close before start: ${closeBeforeInspectionStarts})`, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "installed-inspection-close-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let inspected = 0, aborted = false;
  const adapter: InstalledAdapter = { product: "kidos", validate() {}, prepareTool(_r, _t, input) { return input; },
    async invokeTool() { throw new Error("Unknown"); },
    async reconcileTool(_r, _t, _invocation, signal) {
      inspected++; entered();
      await new Promise<void>(resolve => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
      return { state: "unknown" };
    },
    async execute(_s, context) { return context.invokeTool(definition, { game_id: "fixture" }, "same-call"); },
  };
  const service = new AgentService(store, directory, undefined, {}, { adapter });
  try {
    const session = store.createSession(registration, "Fixture");
    const run = await service.dispatch(registration, "runs.start", { sessionId: session.id, key: "one", spec }, "ui") as Run;
    await wait(service, run, "awaiting_reconciliation");
    const request = { runId: run.id, callId: "same-call" };
    const pending = Promise.allSettled([service.dispatch(registration, "tools.inspect", request, "a"), service.dispatch(registration, "tools.inspect", request, "b")]);
    if (!closeBeforeInspectionStarts) await started;
    await service.close();
    assert.equal(inspected, closeBeforeInspectionStarts ? 0 : 1);
    assert.equal(aborted, !closeBeforeInspectionStarts);
    assert.ok((await pending).every(result => result.status === "rejected"));
    const reopened = new Store(path.join(directory, "metadata.sqlite"));
    try { assert.equal(reopened.receipt(registration, `${run.id}:same-call`)?.status, "started"); }
    finally { reopened.close(); }
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});
