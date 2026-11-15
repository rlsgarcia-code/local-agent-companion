import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { FakeToolCallingModel } from "langchain";
import { executeGraph } from "../packages/agent-core/src/index";
import type { GameCompletionEvidence } from "../packages/contracts/src/game-agent";
import { gameAgentSchemas } from "../packages/contracts/src/game-agent";
import { runSpec, errors, type Registration, type Run } from "../packages/contracts/src/index";
import type { GameProject } from "../packages/contracts/src/games";
import type { GameProductionJob } from "../packages/contracts/src/game-production";
import type { GameProductionAdapter, GameValidationCollector } from "../packages/game-production/src/index";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { Transfers } from "../packages/agent-service/src/transfers";
import { GAME_AGENT_TOOLS } from "../packages/agent-service/src/game-agent-tools";
import { fixtureGameDocument } from "./game-fixtures";
import { checkGameBrowserRecipe } from "../packages/contracts/src/game-browser-tests";

const reg: Registration = { id: "job-discovery", product: "companion-vscode", profile: "fixture", workspace: "test", providers: ["ollama"], hostTools: [] };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
type Step = { name: string; args: Record<string, unknown>; id: string };
type Page = { projectId: string; revision: number; sourceHash: string; cursor: number; hasMore: boolean;
  jobs: { id: string; kind: string; revision: number; sourceHash: string; matchesSource: boolean; state: string }[] };

async function fixture(steps: Step[][], after?: (name: string, value: unknown) => void, browserRecipe = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-job-discovery-")), store = new Store(path.join(directory, "state.sqlite"));
  const toolchain = { id: "fixture", version: "1", sha256: "a".repeat(64) };
  const control = { hold: false, release: () => {}, available: true, probes: 0, collections: 0, reservations: 0 };
  const output = () => ({ entrypoint: "index.html", files: [{ path: "index.html", mime: "text/html", data: Buffer.from("<!doctype html><title>Only a fixture</title>") }] });
  const adapter: GameProductionAdapter = { id: "fixture", engine: "phaser", authority: "workspace", products: ["companion-vscode", "companion-mac"], toolchain,
    probe: async () => ({ available: true }), build: async access => {
      const result = output();
      for (const file of access.document.files) result.files.push({ path: file.path, mime: file.mime, data: Buffer.from(await access.readFile(file.path)) });
      if (!control.hold) return result;control.hold = false;
      return new Promise(resolve => { control.release = () => resolve(result); });
    } };
  const collector: GameValidationCollector = { id: "fixture-license", engines: ["phaser"], authority: "workspace", products: ["companion-vscode"], toolchain,
    ...(browserRecipe ? { testSuiteFormat: "browser-v1" as const, admission: { reserve: async () => { control.reservations++; }, cancel: async () => {} }, reconcile: async () => ({ state: "missing" as const, detail: "Fixture only" }) } : {}),
    categories: ["license"], probe: async () => { control.probes++;return { available: control.available, reason: "Fixture unavailable after consent" }; },
    validate: async () => { control.collections++;return [{ category: "license", environment: { platform: "test", device: "fixture", browser: "none", input: [], scope: "static" },
      checks: [{ id: "licenses", status: "unverified", detail: "Fixture only, no license or game quality verification" }], metrics: {} }]; } };
  const model = new FakeToolCallingModel({ toolCalls: steps }), observed: { name: string; value: unknown }[] = [];
  // Keep the official fake's calls but bound its reply text. Recursive prompt
  // echo would otherwise consume the scripted sequence during Deep compaction.
  const bind = model.bindTools.bind(model);
  model.bindTools = tools => {
    const bound = bind(tools);assert.ok(bound instanceof FakeToolCallingModel);
    const generate = bound._generate.bind(bound);
    bound._generate = async (...args) => {
      const result = await generate(...args);
      for (const generation of result.generations) { generation.text = "Fixture job request recorded.";generation.message.content = generation.text; }
      return result;
    };
    return bound;
  };
  let evidence: GameCompletionEvidence | undefined;
  const service = new AgentService(store, directory, async (request, context) => {
    const answer = await executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model },
      gameProduction: { ...context.gameProduction!, invoke: async (name, input, id) => {
        const value = await context.gameProduction!.invoke(name, input, id);observed.push({ name, value });after?.(name, value);return value;
      } } });
    evidence = context.gameProduction!.evidence();return answer;
  }, {}, { gameAdapters: [adapter], gameCollectors: [collector], gameResourceBudget: { memoryMiB: 1024, cpuSlots: 4, maxConcurrent: 4, maxQueued: 20 } });
  const session = store.createSession(reg, "Job recovery");
  const api = <T>(method: string, input: unknown, actor = reg) => service.dispatch(actor, method, input, "fixture-client") as Promise<T>;
  async function waitJob(id: string, actor = reg) {
    for (let i = 0; i < 800; i++) { const job = await api<GameProductionJob>("games.production.get", { id }, actor);if (["completed", "failed", "cancelled"].includes(job.state)) { assert.equal(job.state, "completed", job.error);return job; }await tick(); }
    throw new Error("Original fixture job did not settle");
  }
  async function project(key: string, actor = reg) { return api<GameProject>("games.projects.create", { requestId: key, document: fixtureGameDocument() }, actor); }
  async function build(key: string, project: GameProject, actor = reg) {
    const job = await api<GameProductionJob>("games.builds.start", { requestId: key, projectId: project.id, revision: project.revision }, actor);
    return job;
  }
  async function start(runtime: "standard" | "deep", mode: "plan" | "execute" = "execute") {
    return api<Run>("runs.start", { sessionId: session.id, key: runtime, spec: runSpec.parse({ runtime, mode,
      provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } },
      messages: [{ role: "user", content: "Recover actual saved job identities; no user content or real inference" }], systemPrompt: "Fixture only", tools: [] }) });
  }
  return { control, collector, store, service, session, api, waitJob, project, build, start, observed, evidence: () => evidence,
    async close() { control.hold = false;control.release();await service.close();await rm(directory, { recursive: true, force: true }); } };
}

test("Standard/Deep discover actual paged job IDs in plan mode without leaking another project/namespace or exposing recipes", async () => {
  assert.equal(GAME_AGENT_TOOLS.find(tool => tool.name === "game_jobs")!.effect, "read");
  assert.equal(gameAgentSchemas.game_jobs.safeParse({ projectId: "fixture", currentSource: true }).success, false);
  for (const runtime of ["standard", "deep"] as const) {
    const steps: Step[][] = [[{ name: "game_jobs", args: { projectId: "pending", limit: 2 }, id: "page-one" }],
      [{ name: "game_jobs", args: { projectId: "pending", limit: 2, cursor: 0 }, id: "page-two" }],
      [{ name: "game_jobs", args: { projectId: "foreign" }, id: "foreign" }], []];
    let pages = 0;
    const f = await fixture(steps, (name, value) => { if (name === "game_jobs" && ++pages === 1) steps[1]![0]!.args.cursor = (value as Page).cursor; });
    try {
      let p = await f.project("first");const other = await f.project("other"), foreign = await f.project("foreign", { ...reg, product: "companion-mac" });
      const a = await f.build("oldest", p);await f.waitJob(a.id);const b = await f.build("older", p);await f.waitJob(b.id);
      const otherJob = await f.build("other-build", other);await f.waitJob(otherJob.id);
      p = await f.api<GameProject>("games.revisions.commit", { projectId: p.id, requestId: "changed", expectedRevision: 1, document: { ...fixtureGameDocument(), title: "Changed source" }, message: "Fixture source changed" });
      const current = await f.build("current", p);await f.waitJob(current.id);
      for (const step of steps) for (const call of step) call.args.projectId = call.id === "foreign" ? foreign.id : p.id;
      const run = await f.start(runtime, "plan");
      for (let i = 0; i < 800 && f.store.run(reg, run.id).state === "running"; i++) await tick();
      assert.equal(f.store.run(reg, run.id).state, "completed", f.store.run(reg, run.id).error);
      const first = f.observed[0]!.value as Page, second = f.observed[1]!.value as Page;
      assert.equal(first.projectId, p.id);assert.equal(first.revision, 2);assert.equal(first.sourceHash, p.contentHash);
      assert.deepEqual(first.jobs.map(job => job.id), [current.id, b.id]);assert.deepEqual(first.jobs.map(job => job.matchesSource), [true, false]);assert.equal(first.hasMore, true);
      assert.deepEqual(second.jobs.map(job => job.id), [a.id]);assert.equal(second.hasMore, false);
      assert.doesNotMatch(JSON.stringify([first, second]), new RegExp(otherJob.id));assert.ok(!("assetSpec" in first.jobs[0]!));
      assert.equal((f.observed[2]!.value as { error: { code: number } }).error.code, errors.missing);
      assert.deepEqual(await f.api("host.poll", {}), []);assert.equal(f.evidence()!.approvalWasDenied, false);
      assert.deepEqual(f.evidence()!.changes, []);
    } finally { await f.close(); }
  }
});

test("validation preflight refuses impossible targets before consent and revalidates availability after real approval in Standard/Deep", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const steps: Step[][] = ["missing", "foreign", "not-build", "pending", "collector", "valid", "changed-capability"].map(id => [{ name: "game_validate", args: { buildId: "pending", collectorId: "fixture-license" }, id }]);steps.push([]);
    let targets = 0, releasePending = () => {};
    const f = await fixture(steps, name => { if (name === "game_validate" && ++targets === 4) releasePending(); });
    releasePending = () => f.control.release();
    try {
      const p = await f.project("first"), valid = await f.build("valid", p);await f.waitJob(valid.id);
      const seeded = await f.api<GameProductionJob>("games.validation.start", { requestId: "seed-validation", buildId: valid.id, collectorId: "fixture-license" });await f.waitJob(seeded.id);
      const foreignReg = { ...reg, product: "companion-mac" as const }, foreign = await f.project("foreign", foreignReg), foreignBuild = await f.build("foreign-build", foreign, foreignReg);
      await f.waitJob(foreignBuild.id, foreignReg);
      const pendingProject = await f.project("pending-project");
      f.control.hold = true;const pending = await f.build("pending", pendingProject);
      const baselineProbes = f.control.probes, baselineCollections = f.control.collections;
      const ids = ["nonexistent-build", foreignBuild.id, seeded.id, pending.id, valid.id, valid.id, valid.id];
      steps.forEach((step, i) => { if (step[0]) step[0].args.buildId = ids[i]; });steps[4]![0]!.args.collectorId = "not-installed";
      const run = await f.start(runtime);let approvals = 0;
      for (let i = 0; i < 1200; i++) {
        for (const request of await f.api<{ id: string; payload: { tool: string; input: { buildId: string } } }[]>("host.poll", {})) {
          assert.equal(request.payload.tool, "game_validate");assert.equal(request.payload.input.buildId, valid.id);approvals++;
          if (approvals === 2) f.control.available = false;
          await f.api("approvals.respond", { id: request.id, value: true });
        }
        if (["completed", "failed", "awaiting_reconciliation"].includes(f.store.run(reg, run.id).state)) break;await tick();
      }
      assert.equal(f.store.run(reg, run.id).state, "completed", f.store.run(reg, run.id).error);assert.equal(approvals, 2);
      for (const row of f.observed.slice(0, 5)) {
        const rejected = row.value as { ok: boolean; rejectedBeforeExternalDispatch: boolean; error: { code: number } };
        assert.equal(rejected.ok, false);assert.equal(rejected.rejectedBeforeExternalDispatch, true);
      }
      assert.equal((f.observed[0]!.value as { error: { code: number } }).error.code, errors.missing);
      assert.deepEqual(f.observed[0]!.value, f.observed[1]!.value, "foreign target must not disclose its identity");
      const launched = f.observed[5]!.value as GameProductionJob;assert.equal(launched.kind, "validate", JSON.stringify(f.observed.slice(5)));await f.waitJob(launched.id);
      const changed = f.observed[6]!.value as { ok: boolean; error: { code: number }; rejectedBeforeExternalDispatch?: boolean };
      assert.equal(changed.ok, false);assert.equal(changed.error.code, errors.unavailable);assert.equal(changed.rejectedBeforeExternalDispatch, undefined);
      assert.equal(f.control.probes - baselineProbes, 2, "preflight must not invoke collector probes");
      assert.equal(f.control.collections - baselineCollections, 1);assert.equal(f.evidence()!.approvalWasDenied, false);
      f.control.release();await f.waitJob(pending.id);
    } finally { await f.close(); }
  }
});

test("Standard/Deep reject saved invalid build recipes before consent or admission and use the pinned build rather than current source", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const steps: Step[][] = [], f = await fixture(steps, undefined, true);
    try {
      const marker = "PRIVATE_RECIPE_PROPERTY_MUST_NOT_BE_ECHOED";
      const valid = { schemaVersion: 1, scenarios: [{ id: "input", designScenarioId: "anchor", steps: [{ action: "wait", ms: 1 }] }] };
      const data = [JSON.stringify({ ...valid, scenarios: [{ ...valid.scenarios[0], steps: [{ action: "wait", ms: 3000 }] }] }),
        JSON.stringify({ ...valid, scenarios: [{ ...valid.scenarios[0], designScenarioId: "not-in-design" }] }),
        JSON.stringify({ ...valid, [marker]: marker }), "{" + marker, JSON.stringify(valid)];
      const transfers = new Transfers(f.store), doc = fixtureGameDocument();
      for (const [index, text] of data.entries()) {
        const bytes = Buffer.from(text), sha256 = createHash("sha256").update(bytes).digest("hex");
        const transfer = transfers.begin(reg, { key: `suite-${index}`, size: bytes.length, sha256, mime: "application/json" });
        transfers.append(reg, transfer.id, 0, bytes);transfers.commit(reg, transfer.id);
        doc.files.push({ path: index === 0 ? "data/playtests.json" : `data/playtests/suite-${index}.json`, size: bytes.length, sha256, mime: "application/json", transferId: transfer.id });
      }
      const p = await f.api<GameProject>("games.projects.create", { requestId: "recipes", document: doc });
      const built = await f.build("recipes", p);await f.waitJob(built.id);
      // Latest source removes the old files and design reference. The exact old
      // build's valid suite must still work, while its invalid default stays invalid.
      const current = fixtureGameDocument();current.design!.playtests[0]!.id = "current-only";
      await f.api("games.revisions.commit", { projectId: p.id, requestId: "new-source", expectedRevision: 1, document: current, message: "Change source after build" });
      const paths = [undefined, ...doc.files.slice(1, 4).map(file => file.path), "data/playtests/missing.json"];
      for (const [index, testSuite] of paths.entries()) {
        steps.push([{ name: "game_validate", args: { buildId: built.id, collectorId: "fixture-license", ...(testSuite ? { testSuite } : {}) }, id: `invalid-${index}` }]);
        await assert.rejects(f.api("games.validation.start", { requestId: `direct-invalid-${index}`, buildId: built.id, collectorId: "fixture-license", ...(testSuite ? { testSuite } : {}) }),
          (error: unknown) => error instanceof Error && !error.message.includes(marker) && /test suite/i.test(error.message));
      }
      assert.equal(f.control.probes, 0);assert.equal(f.control.reservations, 0);assert.equal(f.control.collections, 0);
      steps.push([{ name: "game_validate", args: { buildId: built.id, collectorId: "fixture-license", testSuite: doc.files[4]!.path }, id: "valid-pinned" }], []);
      const run = await f.start(runtime);let approvals = 0;
      for (let i = 0; i < 1200; i++) {
        for (const request of await f.api<{ id: string; payload: { input: { testSuite: string } } }[]>("host.poll", {})) {
          approvals++;assert.equal(request.payload.input.testSuite, doc.files[4]!.path);
          await f.api("approvals.respond", { id: request.id, value: true });
        }
        if (["completed", "failed", "awaiting_reconciliation"].includes(f.store.run(reg, run.id).state)) break;await tick();
      }
      assert.equal(f.store.run(reg, run.id).state, "completed", f.store.run(reg, run.id).error);assert.equal(approvals, 1);
      for (const row of f.observed.slice(0, paths.length)) {
        assert.equal((row.value as { rejectedBeforeExternalDispatch: boolean }).rejectedBeforeExternalDispatch, true);
        assert.equal((row.value as { denied?: boolean }).denied, undefined);
      }
      assert.match(JSON.stringify(f.observed[0]!.value), /scenarios.0.steps.0.ms.*2000/);
      assert.equal(JSON.stringify(f.observed).includes(marker), false);
      const launched = f.observed.at(-1)!.value as GameProductionJob;await f.waitJob(launched.id);
      assert.equal(launched.revision, 1);assert.equal(launched.sourceHash, p.contentHash);
      assert.equal(f.control.probes, 1);assert.equal(f.control.reservations, 1);assert.equal(f.control.collections, 1);
      const jobs = await f.api<{ jobs: GameProductionJob[] }>("games.production.list", { projectId: p.id });
      assert.equal(jobs.jobs.length, 2, "invalid recipes must not create jobs or consume stage requests");
      assert.equal(f.evidence()!.approvalWasDenied, false);
      assert.deepEqual(await f.api("host.poll", {}), []);
    } finally { await f.close(); }
  }
});

test("recipe admission preserves existing job replay and does not impose browser format on unrelated collectors", async () => {
  const f = await fixture([]);
  try {
    const text = Buffer.from('{"schemaVersion":1,"scenarios":[{"id":"invalid","steps":[{"action":"wait","ms":3000}]}]}');
    const transfers = new Transfers(f.store), transfer = transfers.begin(reg, { key: "old-suite", size: text.length, sha256: createHash("sha256").update(text).digest("hex"), mime: "application/json" });
    transfers.append(reg, transfer.id, 0, text);transfers.commit(reg, transfer.id);
    const doc = fixtureGameDocument();doc.files.push({ path: "data/playtests.json", size: text.length, sha256: transfer.sha256, mime: "application/json", transferId: transfer.id });
    const p = await f.api<GameProject>("games.projects.create", { requestId: "old-project", document: doc });
    const built = await f.build("old-build", p);await f.waitJob(built.id);
    const request = { requestId: "old-license", buildId: built.id, collectorId: "fixture-license" };
    const original = await f.api<GameProductionJob>("games.validation.start", request);await f.waitJob(original.id);
    f.collector.testSuiteFormat = "browser-v1";f.control.available = false;
    const replay = await f.api<GameProductionJob>("games.validation.start", request);
    assert.equal(replay.id, original.id);assert.equal(replay.state, "completed");
    assert.equal(f.control.probes, 1);assert.equal(f.control.collections, 1);
    await assert.rejects(f.api("games.validation.start", { ...request, requestId: "new-invalid" }), /2000/);
    // Missing implicit default remains a boot-only collection; explicit missing is refused.
    const blank = await f.project("blank"), blankBuild = await f.build("blank", blank);await f.waitJob(blankBuild.id);f.control.available = true;
    const boot = await f.api<GameProductionJob>("games.validation.start", { ...request, requestId: "boot-only", buildId: blankBuild.id });await f.waitJob(boot.id);
    assert.equal(f.control.collections, 2);
    // The decoder also preserves UTF-8 and bounded diagnostics before any browser launch.
    assert.equal(checkGameBrowserRecipe(new Uint8Array([0xff]), []).valid, false);
  } finally { await f.close(); }
});
