import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FakeToolCallingModel } from "langchain";
import { AgentService, type GraphExecutor } from "../packages/agent-service/src/service";
import { executeGraph } from "../packages/agent-core/src/index";
import { Store } from "../packages/agent-service/src/store";
import { Transfers } from "../packages/agent-service/src/transfers";
import { LocalServer } from "../packages/agent-service/src/server";
import { ensureIdentity, createClientCredential, ipcPath } from "../packages/agent-service/src/security";
import { AgentClient } from "../packages/client-ts/src/index";
import { GameStudioController, type GameStudioHost } from "../packages/client-ts/src/game-studio";
import { exportGameDirectory } from "../packages/client-ts/src/game-export";
import { gameAgentDefinition } from "../packages/agent-service/src/game-agent-tools";
import { gameAgentSchemas, type GameCompletionEvidence } from "../packages/contracts/src/game-agent";
import { runSpec, type Registration, type Session, type Run } from "../packages/contracts/src/index";
import type { GameProject } from "../packages/contracts/src/games";
import { gameQualityCategories, type GameProductionJob, type GameArtifact } from "../packages/contracts/src/game-production";
import { gameStages, type GameWorkflow, type GameWorkflowSnapshot } from "../packages/contracts/src/game-workflow";
import { gameQualityChecks } from "../packages/game-design/src/quality";
import { GameProductionFailure, type GameProductionAdapter, type GameValidationCollector, type CollectedGameObservation } from "../packages/game-production/src/index";
import { fixtureGameDocument } from "./game-fixtures";

const reg: Registration = { id: "workflow-fixture", product: "companion-mac", profile: "default", workspace: "", providers: ["ollama"], hostTools: [] };
const toolchain = { id: "workflow-fixture", version: "1", sha256: "a".repeat(64) };
const adapter = (patch: Partial<GameProductionAdapter> = {}): GameProductionAdapter => ({ id: "workflow-fixture-build", engine: "phaser", authority: "workspace", products: ["companion-mac", "companion-vscode"], toolchain,
  probe: async () => ({ available: true }), build: async () => ({ entrypoint: "index.html", files: [{ path: "index.html", mime: "text/html", data: Buffer.from("<canvas></canvas>") }] }), ...patch });
// Synthetic authoritative observations exercise gates, not real quality/playtest acceptance.
const collector = (full = false): GameValidationCollector => ({ id: "workflow-fixture-collector", engines: ["phaser"], authority: "workspace", products: ["companion-mac", "companion-vscode"], toolchain,
  categories: full ? gameQualityCategories : ["runtime"], validate: async () => {
    if (!full) return [{ category: "runtime", environment: { platform: "fixture", device: "fixture", browser: "fixture", input: ["keyboard"], scope: "automated" }, checks: [{ id: "boots", status: "passed", detail: "Synthetic boot observation only" }], metrics: {} }];
    const reports: CollectedGameObservation[] = gameQualityCategories.map((category): CollectedGameObservation => ({ category,
      checks: gameQualityChecks[category].map((id) => ({ id, status: "passed", detail: "Synthetic policy fixture, not actual acceptance" })),
      environment: { platform: "fixture", device: "fixture", browser: "fixture", input: ["keyboard"], scope: category === "human" ? "human" : category === "license" ? "static" : "physical" },
      metrics: category === "human" ? { participants: 10, understoodWithin30Seconds: 8, ratedAtLeastFour: 7, consent: true } : category === "performance" ?
        { deviceClass: "desktop", sustainedFps: 60, playableSeconds: 9, networkMbps: 20, networkRttMs: 100, cacheCold: true } : {}, coverage: { contentIds: ["island"], scenarioIds: ["anchor"] },
    }));
    const mobile = structuredClone(reports.find((report) => report.category === "performance")!); mobile.environment.device = "mobile"; mobile.metrics.deviceClass = "mobile"; mobile.metrics.sustainedFps = 30; reports.push(mobile); return reports;
  } });
const call = <T>(s: AgentService, method: string, input: unknown = {}, r = reg) => s.dispatch(r, method, input, "fixture") as Promise<T>;
const snapshot = async (s: AgentService, projectId: string): Promise<GameWorkflowSnapshot> => {
  const transfer = await call<{ id: string }>(s, "games.workflows.get", { projectId }); return new Transfers(s.store).json(reg, transfer.id) as GameWorkflowSnapshot;
};
const project = (s: AgentService, requestId = "project", r = reg) => call<GameProject>(s, "games.projects.create", { requestId, document: fixtureGameDocument() }, r);
const build = (s: AgentService, p: GameProject, requestId: string) => call<GameProductionJob>(s, "games.builds.start", { requestId, projectId: p.id, revision: p.revision });
async function settled(s: AgentService, id: string, expected = "completed") {
  for (let i = 0; i < 1000; i++) { const job = await call<GameProductionJob>(s, "games.production.get", { id }); if (job.state === expected) return job; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error(`Workflow fixture did not settle as ${expected}`);
}
type Options = NonNullable<ConstructorParameters<typeof AgentService>[4]>;
async function fixture(options: Options = {}, execute?: GraphExecutor) {
  const directory = await mkdtemp(path.join(tmpdir(), "game-workflow-")), file = path.join(directory, "state.sqlite");
  const configured = { gameAdapters: [adapter()], gameCollectors: [collector()], gameWorkflowPolicy: { requestsPerBlock: 2, maxBlocksPerStage: 2 }, ...options };
  const service = new AgentService(new Store(file), directory, execute, {}, configured);
  return { directory, file, configured, service, async close() { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
async function runEvidence(s: AgentService, projectId: string, key: string, runtime?: "standard" | "deep") {
  const session = await call<Session>(s, "sessions.create", { title: "Read production evidence" });
  await call(s, "games.projects.select", { sessionId: session.id, projectId });
  const spec = runSpec.parse({ runtime: runtime ?? "standard", mode: runtime ? "execute" : "plan", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } },
    messages: [{ role: "user", content: "Inspect the saved production state" }], systemPrompt: "Read-only simulated executor; no inference", tools: [] });
  const run = await call<Run>(s, "runs.start", { sessionId: session.id, key, spec });
  for (let i = 0; i < 400; i++) {
    const current = s.store.run(reg, run.id);
    if (["completed", "failed", "awaiting_reconciliation"].includes(current.state)) { assert.equal(current.state, "completed", current.error); return; }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Read-only evidence fixture did not settle");
}

test("one persistent stage allocation spans builds/validation and idempotent retries do not consume twice", async () => {
  const f = await fixture(); try {
    const p = await project(f.service), initial = await snapshot(f.service, p.id); assert.equal(initial.workflow!.stage, "design"); assert.equal(initial.canAdvance, true);
    const first = await build(f.service, p, "first"); await settled(f.service, first.id);
    assert.equal((await build(f.service, p, "first")).id, first.id); assert.equal((await snapshot(f.service, p.id)).budget!.usedRequests, 1);
    const validation = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "v", buildId: first.id, collectorId: "workflow-fixture-collector" }); await settled(f.service, validation.id);
    const exhausted = await snapshot(f.service, p.id); assert.equal(exhausted.budget!.exhausted, true); assert.equal(exhausted.budget!.usedRequests, 2);
    await assert.rejects(build(f.service, p, "blocked"), /allocation.*exhausted/);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_production_jobs").get() as { n: number }).n, 2);
    const continuation = { requestId: "continue", projectId: p.id, expectedVersion: exhausted.workflow!.version, expectedRevision: 1 };
    await call(f.service, "games.workflows.continue", continuation); await call(f.service, "games.workflows.continue", continuation);
    const allocated = await snapshot(f.service, p.id); assert.equal(allocated.budget!.authorizedRequests, 4); assert.equal(allocated.workflow!.stages.design.blocks, 2);
    await assert.rejects(call(f.service, "games.workflows.continue", { ...continuation, expectedRevision: 2 }), /identity.*different/);
    const next = await build(f.service, p, "blocked"); await settled(f.service, next.id); assert.equal((await snapshot(f.service, p.id)).budget!.usedRequests, 3);
    await assert.rejects(call(f.service, "games.workflows.reopen", { requestId: "reset", projectId: p.id, expectedVersion: (await snapshot(f.service, p.id)).workflow!.version, expectedRevision: 1 }), /completed cycle/);
  } finally { await f.close(); }
});

test("admission rollback keeps the production job and its allocation transactional", async () => {
  let invoked = 0; const f = await fixture({ gameAdapters: [adapter({ build: async () => { invoked++; throw new GameProductionFailure("Fixture stopped"); } })] }); try {
    const p = await project(f.service), before = await snapshot(f.service, p.id);
    f.service.store.db.exec("CREATE TRIGGER reject_workflow_job BEFORE INSERT ON game_production_jobs BEGIN SELECT RAISE(ABORT,'fixture admission rejected'); END");
    await assert.rejects(build(f.service, p, "rejected"), /admission rejected/);
    assert.deepEqual((await snapshot(f.service, p.id)).workflow, before.workflow); assert.equal(invoked, 0);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_workflow_charges").get() as { n: number }).n, 0);
  } finally { await f.close(); }
});

test("failed media consumes the same stage request allocation; replay and reconciliation cannot refund it", async () => {
  let processed = 0;
  const f = await fixture({ gameWorkflowPolicy: { requestsPerBlock: 1, maxBlocksPerStage: 1 }, gameAssetProcessors: [{ id: "workflow-media", products: ["companion-mac"], authority: "workspace", toolchain,
    operations: ["audio.render"], probe: async () => ({ available: true }), process: async () => { processed++; throw new GameProductionFailure("Synthetic codec failure after processing started"); } }] });
  try {
    const p = await project(f.service), request = { requestId: "media", projectId: p.id, revision: 1, spec: { processorId: "workflow-media", target: { id: "tone", role: "Synthetic budget fixture" },
      operation: { type: "audio.render", output: "assets/tone.wav", durationMs: 100, notes: [{ waveform: "sine", frequency: 440, startMs: 0, durationMs: 100, gain: 0.2 }] } } };
    const job = await call<GameProductionJob>(f.service, "games.assets.process", request); await settled(f.service, job.id, "failed");
    assert.equal((await call<GameProductionJob>(f.service, "games.assets.process", request)).id, job.id);
    await call(f.service, "games.production.reconcile", { id: job.id });
    assert.equal(processed, 1); assert.equal((await snapshot(f.service, p.id)).budget!.usedRequests, 1);
    await assert.rejects(build(f.service, p, "blocked-after-media"), /allocation.*exhausted/);
  } finally { await f.close(); }
});

test("stage gates require current independent evidence and refuse fabricated readiness or old source", async () => {
  const f = await fixture({ gameWorkflowPolicy: { requestsPerBlock: 20, maxBlocksPerStage: 2 } }); try {
    const p = await project(f.service), first = await snapshot(f.service, p.id), request = { requestId: "design", projectId: p.id, expectedVersion: first.workflow!.version, expectedRevision: 1 };
    await assert.rejects(call(f.service, "games.workflows.advance", { ...request, ready: true }));
    await call(f.service, "games.workflows.advance", request); const core = await snapshot(f.service, p.id); assert.equal(core.workflow!.stage, "core"); assert.equal(core.canAdvance, false);
    const compiled = await build(f.service, p, "build"); await settled(f.service, compiled.id);
    const inspected = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "inspect", buildId: compiled.id, collectorId: "workflow-fixture-collector" }); await settled(f.service, inspected.id);
    const bootOnly = await snapshot(f.service, p.id); assert.ok(bootOnly.gates.find((gate) => gate.stage === "core")!.blockers.includes("missing-runtime-controls"));
    await assert.rejects(call(f.service, "games.workflows.advance", { requestId: "fake-complete", projectId: p.id, expectedVersion: bootOnly.workflow!.version, expectedRevision: 1 }), /independent evidence/);
    await call(f.service, "games.revisions.commit", { projectId: p.id, requestId: "edit", expectedRevision: 1, document: { ...fixtureGameDocument(), title: "New source" }, message: "Edit source" });
    await assert.rejects(call(f.service, "games.workflows.advance", { requestId: "old-source", projectId: p.id, expectedVersion: bootOnly.workflow!.version, expectedRevision: 1 }), /Refresh/);
    assert.ok((await snapshot(f.service, p.id)).gates.find((gate) => gate.stage === "core")!.blockers.includes("build-not-produced"));
    assert.equal(gameAgentDefinition("game_continue_production"), undefined); assert.equal(gameAgentDefinition("game_advance_stage")!.effect, "write");
    assert.throws(() => gameAgentSchemas.game_workflow.parse({ projectId: p.id, ready: true }));
  } finally { await f.close(); }
});

test("completion pins the exact accepted revision/build; a new cycle preserves acceptance and cannot import it for changed source", async () => {
  let evidence: GameCompletionEvidence | undefined;
  const f = await fixture({ gameCollectors: [collector(true)], gameWorkflowPolicy: { requestsPerBlock: 20, maxBlocksPerStage: 2 } },
    async (_spec, context) => { evidence = context.gameProduction!.evidence(); return { text: "Production evidence inspected" }; }); try {
    const p = await project(f.service), compiled = await build(f.service, p, "build"); await settled(f.service, compiled.id);
    const validation = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "verify", buildId: compiled.id, collectorId: "workflow-fixture-collector" }); await settled(f.service, validation.id);
    assert.equal((await snapshot(f.service, p.id)).qualityReady, true);
    await runEvidence(f.service, p.id, "before-cycle-completed");
    assert.equal(evidence!.projects[0]!.ready, false); assert.ok(evidence!.projects[0]!.blockers.includes("production-cycle-incomplete"));
    for (const stage of gameStages) {
      const current = await snapshot(f.service, p.id); assert.equal(current.workflow!.stage, stage); assert.equal(current.canAdvance, true);
      const request = { requestId: `advance-${stage}`, projectId: p.id, expectedVersion: current.workflow!.version, expectedRevision: 1 };
      await call(f.service, "games.workflows.advance", request); await call(f.service, "games.workflows.advance", request);
    }
    const done = await snapshot(f.service, p.id); assert.equal(done.workflow!.state, "completed"); assert.equal(done.workflow!.lastAccepted!.buildId, compiled.id);
    await runEvidence(f.service, p.id, "after-cycle-completed");
    assert.equal(evidence!.projects[0]!.ready, true); assert.equal(evidence!.projects[0]!.blockers.length, 0);
    const artifact = new Transfers(f.service.store).json(reg, (await call<{ id: string }>(f.service, "games.builds.artifact", { id: compiled.id })).id) as GameArtifact;
    assert.throws(() => f.service.store.db.transaction(() => {
      f.service.store.db.prepare("DELETE FROM game_artifact_files WHERE artifact=?").run(artifact.id);
      f.service.store.db.prepare("DELETE FROM game_artifacts WHERE id=?").run(artifact.id);
    })(), /FOREIGN KEY/);
    assert.throws(() => f.service.store.db.prepare("DELETE FROM game_revisions WHERE project=? AND revision=1").run(p.id), /FOREIGN KEY/);
    await assert.rejects(build(f.service, p, "more"), /completed production cycle/);
    await assert.rejects(call(f.service, "games.workflows.reopen", { requestId: "same", projectId: p.id, expectedVersion: done.workflow!.version, expectedRevision: 1 }), /already accepted/);
    const changed = await call<GameProject>(f.service, "games.revisions.commit", { requestId: "changed", projectId: p.id, expectedRevision: 1, document: { ...fixtureGameDocument(), title: "Next revision" }, message: "Continue development" });
    await runEvidence(f.service, p.id, "changed-source"); assert.equal(evidence!.projects[0]!.ready, false);
    assert.ok(evidence!.projects[0]!.blockers.includes("production-cycle-incomplete"));
    const reopened = await call<GameWorkflow>(f.service, "games.workflows.reopen", { requestId: "reopen", projectId: p.id, expectedVersion: done.workflow!.version, expectedRevision: changed.revision });
    assert.notEqual(reopened.id, done.workflow!.id); assert.deepEqual(reopened.lastAccepted, done.workflow!.lastAccepted); assert.equal((await snapshot(f.service, p.id)).qualityReady, false);
    const second = await build(f.service, changed, "next-cycle"); await settled(f.service, second.id); assert.equal((await snapshot(f.service, p.id)).budget!.usedRequests, 1);
  } finally { await f.close(); }
});

test("earlier successful quality cannot advance a cycle while another production result is unknown", async () => {
  const c = collector(true); let calls = 0; let evidence: GameCompletionEvidence | undefined;
  const f = await fixture({ gameWorkflowPolicy: { requestsPerBlock: 20, maxBlocksPerStage: 2 }, gameCollectors: [{ ...c,
    validate: async (context) => { if (++calls > 1) throw new Error("Lost observation acknowledgment"); return c.validate(context); } }] },
    async (_spec, context) => { evidence = context.gameProduction!.evidence(); return { text: "Production evidence inspected" }; });
  try {
    const p = await project(f.service), compiled = await build(f.service, p, "build"); await settled(f.service, compiled.id);
    const first = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "first", buildId: compiled.id, collectorId: c.id }); await settled(f.service, first.id);
    assert.equal((await snapshot(f.service, p.id)).qualityReady, true);
    const second = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "unknown", buildId: compiled.id, collectorId: c.id }); await settled(f.service, second.id, "awaiting_reconciliation");
    const pending = await snapshot(f.service, p.id); assert.equal(pending.qualityReady, true); assert.equal(pending.canAdvance, false);
    assert.ok(pending.gates.find((gate) => gate.stage === pending.workflow!.stage)!.blockers.includes("production-work-pending"));
    await runEvidence(f.service, p.id, "unknown-work"); assert.equal(evidence!.projects[0]!.ready, false);
    assert.ok(evidence!.projects[0]!.blockers.includes("production-work-pending"));
    await assert.rejects(call(f.service, "games.workflows.advance", { requestId: "not-safe", projectId: p.id, expectedVersion: pending.workflow!.version, expectedRevision: 1 }), /independent evidence/);
    assert.equal((await snapshot(f.service, p.id)).workflow!.stage, "design");
  } finally { await f.close(); }
});

test("Standard and Deep advance all eight stages through the official graph and persistent note receipts", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    let model: FakeToolCallingModel | undefined, evidence: GameCompletionEvidence | undefined;
    const f = await fixture({ gameCollectors: [collector(true)], gameWorkflowPolicy: { requestsPerBlock: 20, maxBlocksPerStage: 2 } }, async (request, context) => {
      assert.ok(model);
      const result = await executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model } });
      evidence = context.gameProduction!.evidence(); return result;
    });
    try {
      const p = await project(f.service), compiled = await build(f.service, p, "build"); await settled(f.service, compiled.id);
      const validated = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "verify", buildId: compiled.id, collectorId: "workflow-fixture-collector" });
      await settled(f.service, validated.id);
      const initial = await snapshot(f.service, p.id);
      model = new FakeToolCallingModel({ toolCalls: [...gameStages.map((stage, i) => [{ name: "game_advance_stage", id: `advance-${stage}`,
        args: { projectId: p.id, expectedVersion: initial.workflow!.version + i, expectedRevision: 1 } }]), []] });
      // This fixture tests stage effects/receipts, not recursive prompt echo.
      // The official fake normally copies its entire context into each reply,
      // doubling history until Deep summarization consumes its scripted calls.
      // Keep every original tool call and graph limit, with bounded reply text.
      const bindModel = model.bindTools.bind(model);
      model.bindTools = tools => {
        const bound = bindModel(tools); assert.ok(bound instanceof FakeToolCallingModel);
        const generate = bound._generate.bind(bound);
        bound._generate = async (...args) => {
          const result = await generate(...args);
          for (const generation of result.generations) {
            generation.text = "Synthetic workflow step recorded.";
            generation.message.content = generation.text;
          }
          return result;
        };
        return bound;
      };
      await runEvidence(f.service, p.id, `official-${runtime}`, runtime);
      const completed = await snapshot(f.service, p.id);
      assert.equal(completed.workflow!.state, "completed"); assert.equal(completed.workflow!.lastAccepted!.buildId, compiled.id);
      assert.equal(evidence!.projects[0]!.ready, true);
      const receipts = f.service.store.db.prepare("SELECT i.kind,r.status FROM receipts r JOIN operation_identities i ON i.id=r.id WHERE i.tool='game_advance_stage'").all() as { kind: string; status: string }[];
      assert.equal(receipts.length, gameStages.length); assert.ok(receipts.every((receipt) => receipt.kind === "note" && receipt.status === "completed"));
      assert.deepEqual(await call(f.service, "host.poll"), []);
    } finally { await f.close(); }
  }
});

test("restart preserves charges and a stricter installed policy; unknown operations are not refunded or repeated", async () => {
  let calls = 0;
  const a = adapter({ build: async () => { calls++; throw new Error("Unknown outcome"); }, reconcile: async () => ({ state: "missing", detail: "Fixture confirmed absence; new execution must be explicit" }) });
  const f = await fixture({ gameAdapters: [a] }); let reopened: AgentService | undefined; try {
    const p = await project(f.service), job = await build(f.service, p, "unknown"); await settled(f.service, job.id, "awaiting_reconciliation");
    await f.service.close(); reopened = new AgentService(new Store(f.file), f.directory, undefined, {}, { ...f.configured, gameWorkflowPolicy: { requestsPerBlock: 1, maxBlocksPerStage: 1 } });
    const persisted = await snapshot(reopened, p.id); assert.equal(persisted.budget!.usedRequests, 1); assert.equal(persisted.budget!.exhausted, true);
    await call(reopened, "games.production.reconcile", { id: job.id });
    await assert.rejects(build(reopened, p, "next"), /allocation.*exhausted/); assert.equal(calls, 1);
    await assert.rejects(call(reopened, "games.workflows.continue", { requestId: "over-policy", projectId: p.id, expectedVersion: persisted.workflow!.version, expectedRevision: 1 }), /installed production policy/);
  } finally { await reopened?.close(); await f.close(); }
});

test("workflow data are namespace isolated, cursor bounded and unavailable as generic KidOS authority", async () => {
  const f = await fixture(); try {
    const p = await project(f.service), first = await snapshot(f.service, p.id), compiled = await build(f.service, p, "build"); await settled(f.service, compiled.id);
    const transfer = await call<{ id: string }>(f.service, "games.workflows.events", { projectId: p.id, until: first.eventCursor, limit: 1 });
    const page = new Transfers(f.service.store).json(reg, transfer.id) as { events: { sequence: number }[]; hasMore: boolean };
    assert.equal(page.events.length, 1); assert.equal(page.hasMore, false); assert.ok(page.events.every((event) => event.sequence <= first.eventCursor));
    await assert.rejects(call(f.service, "games.workflows.get", { projectId: p.id }, { ...reg, product: "companion-vscode" }), /not found/);
    const child = { ...reg, product: "kidos" as const, profile: "child" }, childProject = await project(f.service, "child", child);
    await assert.rejects(call(f.service, "games.workflows.get", { projectId: childProject.id }, child), /protected Core/);
    await assert.rejects(call(f.service, "games.workflows.continue", { projectId: p.id, requestId: "forge", expectedVersion: 1, expectedRevision: 1, maxRequests: 100000 }));
  } finally { await f.close(); }
});

test("real SDKs and Studio require native budget consent, preserve concurrent changes and export production history", async () => {
  const f = await fixture({ gameWorkflowPolicy: { requestsPerBlock: 1, maxBlocksPerStage: 3 } });
  const credential = await createClientCredential(f.directory, reg); f.service.store.register(credential);
  const identity = await ensureIdentity(f.directory), server = new LocalServer(f.service, f.directory); let client: AgentClient | undefined;
  try {
    await server.listen(); client = new AgentClient({ address: ipcPath(f.directory), certificate: identity.cert, credential }); await client.connect();
    const session = await client.call<Session>("sessions.create", { title: "Production" }), p = await client.createGameProject("sdk", fixtureGameDocument()); await client.selectGameProject(session.id, p.id);
    const host: GameStudioHost = { canWrite: () => true, approve: async () => false, preview: async () => {}, exportSource: async () => false, exportBuild: async () => false, exportAsset: async () => false }, controller = new GameStudioController(client, session.id, host);
    const job = await client.startGameBuild("build", p.id, 1); await settled(f.service, job.id); let current = await client.getGameWorkflow(p.id);
    const command = { action: "continue-production", projectId: p.id, requestId: "denied", expectedVersion: current.workflow!.version, expectedRevision: 1 };
    assert.deepEqual(await controller.dispatch(command), { cancelled: true }); assert.equal((await client.getGameWorkflow(p.id)).budget!.authorizedRequests, 1);
    host.approve = async () => { host.canWrite = () => false; return true; };
    await assert.rejects(controller.dispatch({ ...command, requestId: "mode-changed" }), /modo de edição/); host.canWrite = () => true;
    host.approve = async () => true; await controller.dispatch({ ...command, requestId: "accepted" }); current = await client.getGameWorkflow(p.id); assert.equal(current.budget!.authorizedRequests, 2);
    await assert.rejects(controller.dispatch({ ...command, requestId: "stale" }), /mudou/);
    const parent = path.join(f.directory, "exports"); await mkdir(parent);
    const exported = await exportGameDirectory({ client, parent, source: { projectId: p.id, revision: 1 } }), historical = JSON.parse(await readFile(path.join(exported, "production.json"), "utf8"));
    assert.equal(historical.snapshot.workflow.id, current.workflow!.id); assert.ok(historical.events.some((event: { action: string }) => event.action === "budget-continued"));
    if (process.platform !== "win32") {
      const certificate = path.join(f.directory, "cert.pem"), auth = path.join(f.directory, "auth.json"); await writeFile(certificate, identity.cert); await writeFile(auth, JSON.stringify(credential), { mode: 0o600 });
      const code = `import sys\nsys.path.insert(0,sys.argv[1])\nfrom pathlib import Path\nfrom companion_client import AgentClient\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]));c.connect()\ns=c.get_game_workflow(sys.argv[5])\nassert s['budget']['authorizedRequests']==2\ne=c.read_game_workflow_events(sys.argv[5],until=s['eventCursor'])\nassert any(x['action']=='budget-continued' for x in e['events'])\nb=c.get_inference_budgets(sys.argv[6])\nassert b['budgets'][0]['scope']['kind']=='namespace' and b['budgets'][0]['calls']==0\nc.close()\nprint('PYTHON_WORKFLOW_OK')`;
      const output = await promisify(execFile)("python3", ["-I", "-c", code, path.resolve("packages/client-python"), ipcPath(f.directory), certificate, auth, p.id, session.id], { timeout: 30000 }); assert.match(output.stdout, /PYTHON_WORKFLOW_OK/);
    }
  } finally { client?.close(); await server.close(); await f.close(); }
});
