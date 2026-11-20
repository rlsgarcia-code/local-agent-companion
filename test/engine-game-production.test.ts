import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { ensureIdentity, createClientCredential, ipcPath } from "../packages/agent-service/src/security";
import { AgentClient } from "../packages/client-ts/src/index";
import type { Registration } from "../packages/contracts/src/index";
import type { GameProject } from "../packages/contracts/src/games";
import type { GameProductionJob, GameArtifact, GameValidationReport, GameQualityAssessment, GameProductionCapabilities } from "../packages/contracts/src/game-production";
import type { Transfer } from "../packages/contracts/src/transfers";
import { GameProductionFailure, GameProductionUncertain, type GameProductionAdapter, type GameValidationCollector, type ProducedGameArtifact } from "../packages/game-production/src/index";
import { fixtureGameDocument } from "./game-fixtures";
import { gameBrowserTestGuide, gameBrowserTestStep, gameBrowserTestSuite } from "../packages/contracts/src/game-browser-tests";

const reg: Registration = { id: "production-test", product: "companion-mac", profile: "default", workspace: "", providers: ["ollama"], hostTools: [] };
const toolchain = { id: "fixture-toolchain", version: "1", sha256: "a".repeat(64) };
const output = (): ProducedGameArtifact => ({ entrypoint: "index.html", files: [{ path: "index.html", mime: "text/html", data: Buffer.from("<!doctype html><title>Synthetic fixture</title>") }] });
const adapter = (patch: Partial<GameProductionAdapter> = {}): GameProductionAdapter => ({ id: "fixture-build", engine: "phaser", products: ["companion-mac", "companion-vscode"], authority: "workspace", toolchain,
  probe: async () => ({ available: true }), build: async () => output(), ...patch });
const collector = (patch: Partial<GameValidationCollector> = {}): GameValidationCollector => ({ id: "fixture-license", engines: ["phaser"], products: ["companion-mac"], authority: "workspace", toolchain, categories: ["license"],
  validate: async (context) => {
    assert.match(Buffer.from(await context.readFile("index.html")).toString(), /Synthetic fixture/);
    return [{ category: "license", environment: { platform: "test", device: "fixture", browser: "none", input: [], scope: "static" },
      checks: [{ id: "licenses", status: "unverified", detail: "Fixture does not perform real license verification" }], metrics: {} }];
  }, ...patch });
const call = <T>(s: AgentService, method: string, args: unknown = {}, r = reg) => s.dispatch(r, method, args, "fixture") as Promise<T>;
async function json<T>(s: AgentService, method: string, args: unknown): Promise<T> {
  const transfer = await call<Transfer>(s, method, args);
  let data = "";
  for (let offset = 0;;) {
    const chunk = await call<{ data: string; nextOffset: number; done: boolean }>(s, "transfers.read", { id: transfer.id, offset });
    data += Buffer.from(chunk.data, "base64").toString(); offset = chunk.nextOffset;
    if (chunk.done) break;
  }
  return JSON.parse(data) as T;
}
async function wait(s: AgentService, id: string, states = ["completed", "failed", "cancelled", "awaiting_reconciliation"]): Promise<GameProductionJob> {
  for (let i = 0; i < 200; i++) {
    const job = await call<GameProductionJob>(s, "games.production.get", { id });
    if (states.includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Fixture production did not settle");
}
async function project(s: AgentService, id = "project"): Promise<GameProject> {
  return call(s, "games.projects.create", { requestId: id, document: fixtureGameDocument() });
}
async function fixture(adapters = [adapter()], collectors: GameValidationCollector[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), "game-production-"));
  const file = path.join(directory, "state.sqlite");
  const service = new AgentService(new Store(file), directory, undefined, {}, { gameAdapters: adapters, gameCollectors: collectors });
  return { directory, file, service, async close() { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("installed collector format guidance is bounded/product-scoped metadata without granting availability or starting work", async () => {
  let dispatched = 0;
  const f = await fixture([adapter()], [collector({ projectGuide: gameBrowserTestGuide + "x".repeat(5000),
    probe: async () => ({ available: false, reason: "Fixture unavailable" }), validate: async () => { dispatched++;return []; } })]);
  try {
    const p = await project(f.service);
    const capabilities = await call<GameProductionCapabilities>(f.service, "games.production.capabilities", {});
    const row = capabilities.collectors[0]!;assert.equal(row.available, false);
    assert.equal(row.projectGuide, (gameBrowserTestGuide + "x".repeat(5000)).slice(0, 4000));
    assert.equal((await call<GameProductionCapabilities>(f.service, "games.production.capabilities", {}, { ...reg, product: "companion-vscode" })).collectors.length, 0);
    assert.equal(dispatched, 0);
    assert.equal((await json<GameQualityAssessment>(f.service, "games.quality.get", { projectId: p.id })).ready, false);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_production_jobs").get() as { n: number }).n, 0);
  } finally { await f.close(); }
});

test("the installed browser format reference has a valid bounded recipe and names every canonical action", () => {
  assert.ok(gameBrowserTestGuide.length <= 4000);
  const example = gameBrowserTestGuide.match(/^Example: (.+)$/m)?.[1];assert.ok(example);
  const parsed = gameBrowserTestSuite.parse(JSON.parse(example));
  assert.equal(parsed.scenarios[0]!.steps.at(-1)!.action, "expect-image");
  for (const option of gameBrowserTestStep.options) assert.ok(gameBrowserTestGuide.includes(option.shape.action.value), option.shape.action.value);
  assert.match(gameBrowserTestGuide, /No JavaScript/);assert.match(gameBrowserTestGuide, /do not certify/);
});

test("builds pin immutable revisions, deduplicate requests and expose artifacts without implying game quality", async () => {
  let builds = 0;
  const f = await fixture([adapter({ build: async () => { builds++; return output(); } })], [collector()]);
  try {
    const p = await project(f.service), request = { requestId: "build", projectId: p.id, revision: 1 };
    const job = await call<GameProductionJob>(f.service, "games.builds.start", request);
    assert.equal((await wait(f.service, job.id)).state, "completed");
    assert.equal((await call<GameProductionJob>(f.service, "games.builds.start", request)).id, job.id);
    assert.equal(builds, 1);
    await assert.rejects(call(f.service, "games.builds.start", { ...request, revision: 2 }), /different content/);
    const artifact = await json<GameArtifact>(f.service, "games.builds.artifact", { id: job.id });
    assert.equal(artifact.sourceHash, p.contentHash);
    assert.equal(artifact.toolchain.sha256, toolchain.sha256);
    assert.throws(() => f.service.store.db.prepare("DELETE FROM transfers WHERE id=?").run(artifact.files[0]!.transferId), /FOREIGN KEY/);
    assert.equal((await json<GameQualityAssessment>(f.service, "games.quality.get", { projectId: p.id })).ready, false);
    const validation = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "inspect", buildId: job.id, collectorId: "fixture-license" });
    assert.equal((await wait(f.service, validation.id)).state, "completed");
    const reports = await json<GameValidationReport[]>(f.service, "games.validation.reports", { id: job.id });
    assert.equal(reports[0]!.sourceHash, artifact.sourceHash);
    assert.equal(reports[0]!.artifactHash, artifact.artifactHash);
    assert.equal(reports[0]!.collectorId, "fixture-license");
    for (const method of ["games.production.get", "games.builds.artifact", "games.validation.reports"])
      await assert.rejects(call(f.service, method, { id: job.id }, { ...reg, product: "companion-vscode" }), /not found/);
    await call(f.service, "games.revisions.commit", { projectId: p.id, requestId: "edit", expectedRevision: 1, document: { ...fixtureGameDocument(), title: "Changed" }, message: "Update" });
    const old = await json<GameQualityAssessment>(f.service, "games.quality.get", { projectId: p.id, revision: 1 });
    assert.equal(old.stale, true);
    assert.equal(old.ready, false);
    const events = await call<{ events: { sequence: number; job: GameProductionJob }[]; cursor: number }>(f.service, "games.production.events", { projectId: p.id, limit: 1 });
    assert.equal(events.events[0]!.job.state, "queued");
    assert.ok((await call<{ events: unknown[] }>(f.service, "games.production.events", { projectId: p.id, cursor: events.cursor })).events.length >= 4);
  } finally { await f.close(); }
});

test("the real web compiler reports the exact missing source file and pinned revision without producing an artifact", async () => {
  const { createWebGameAdapters } = await import("../packages/adapter-game-web/src/index");
  const f = await fixture(createWebGameAdapters(path.resolve("packages/adapter-game-web/runtimes")));
  try {
    const p = await project(f.service), job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "missing-config", projectId: p.id, revision: 1 });
    const failed = await wait(f.service, job.id);
    assert.equal(failed.state, "failed");assert.equal(failed.revision, 1);assert.equal(failed.sourceHash, p.contentHash);
    assert.equal(failed.error, 'Source file "game.web.json" not present in the pinned game revision 1.');
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_artifacts").get() as { n: number }).n, 0);
    assert.equal((await json<GameQualityAssessment>(f.service, "games.quality.get", { projectId: p.id })).ready, false);
  } finally { await f.close(); }
});

test("source diagnostics hide invalid paths and preserve reconciliation for an unacknowledged adapter effect", async () => {
  const marker = "HOST_PATH_MUST_NOT_LEAK";
  for (const name of [`/private/${marker}`, `../${marker}`, `bad\u0000${marker}`, `${marker}${"x".repeat(500)}`, "assets/not-created.png"]) {
    let starts = 0;
    const f = await fixture([adapter({ build: async access => { starts++;await access.readFile(name);return output(); } })]);
    try {
      const p = await project(f.service), job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "missing-source", projectId: p.id, revision: 1 });
      const unknown = await wait(f.service, job.id);
      assert.equal(unknown.state, "awaiting_reconciliation", "a named read error cannot acknowledge the adapter's earlier possible effects");
      assert.doesNotMatch(unknown.error ?? "", new RegExp(marker));
      if (name === "assets/not-created.png") assert.match(unknown.error ?? "", /"assets\/not-created\.png"/);
      assert.equal((await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "missing-source", projectId: p.id, revision: 1 })).id, job.id);
      assert.equal(starts, 1);
    } finally { await f.close(); }
  }
});

test("external candidates are disposed after an acknowledged commit and retained until unknown effects are reconciled", async () => {
  let releases = 0, disposed!: () => void;
  const released = new Promise<void>((resolve) => { disposed = resolve; });
  const a = adapter({ build: async () => { throw new Error("Lost external acknowledgment"); },
    reconcile: async () => ({ state: "completed", result: output() }),
    dispose: async (context) => {
      const job = await call<GameProductionJob>(f.service, "games.production.get", { id: context.job.id });
      assert.equal(job.state, "completed");
      assert.ok((await json<GameArtifact>(f.service, "games.builds.artifact", { id: context.job.id })).files.length);
      releases++; disposed();
    } });
  const f = await fixture([a]);
  try {
    const p = await project(f.service), job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "candidate", projectId: p.id, revision: 1 });
    assert.equal((await wait(f.service, job.id)).state, "awaiting_reconciliation"); assert.equal(releases, 0);
    assert.equal((await call<GameProductionJob>(f.service, "games.production.reconcile", { id: job.id })).state, "completed");
    await released; assert.equal(releases, 1);
  } finally { await f.close(); }
});

test("unknown effects require original-toolchain inspection after restart; neither retry nor client proof repeats work", async () => {
  let builds = 0, inspections = 0;
  const a = adapter({ build: async () => { builds++; throw new Error("Lost acknowledgment after build effect"); }, reconcile: async () => { inspections++; return { state: "completed", result: output() }; } });
  const f = await fixture([a]); let restarted: AgentService | undefined;
  try {
    const p = await project(f.service), req = { requestId: "interrupted", projectId: p.id, revision: 1 };
    const job = await call<GameProductionJob>(f.service, "games.builds.start", req);
    assert.equal((await wait(f.service, job.id)).state, "awaiting_reconciliation");
    assert.equal((await call<{ accepted: boolean }>(f.service, "engine.quiesceIfIdle")).accepted, false);
    await assert.rejects(call(f.service, "games.builds.start", { ...req, requestId: "repeat-effect" }), /unreconciled/);
    await assert.rejects(call(f.service, "games.production.cancel", { id: job.id }), /Inspect/);
    await assert.rejects(call(f.service, "games.production.reconcile", { id: job.id, proof: { completed: true } }));
    await f.service.close();
    restarted = new AgentService(new Store(f.file), f.directory, undefined, {}, { gameAdapters: [{ ...a, toolchain: { ...toolchain, version: "2" } }] });
    await assert.rejects(call(restarted, "games.production.reconcile", { id: job.id }), /original build inspector/);
    await restarted.close();
    restarted = new AgentService(new Store(f.file), f.directory, undefined, {}, { gameAdapters: [a] });
    assert.equal((await call<GameProductionJob>(restarted, "games.builds.start", req)).state, "awaiting_reconciliation");
    assert.equal((await call<GameProductionJob>(restarted, "games.production.reconcile", { id: job.id })).state, "completed");
    assert.equal(builds, 1); assert.equal(inspections, 1);
    assert.equal((await call<{ accepted: boolean }>(restarted, "engine.quiesceIfIdle")).accepted, true);
  } finally { await restarted?.close(); await f.close(); }
});

test("cancellation cannot acknowledge success when an external build termination is uncertain", async () => {
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const f = await fixture([adapter({ build: async ({ signal }) => {
    started(); await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("The isolated build termination is not acknowledged");
  }, reconcile: async () => ({ state: "missing", detail: "Original process was inspected and stopped; no acknowledged output" }) })]);
  try {
    const p = await project(f.service), job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "cancel-unknown", projectId: p.id, revision: 1 });
    await running;
    assert.equal((await call<GameProductionJob>(f.service, "games.production.cancel", { id: job.id })).state, "cancelling");
    assert.equal((await wait(f.service, job.id)).state, "awaiting_reconciliation");
    assert.equal((await call<{ accepted: boolean }>(f.service, "engine.quiesceIfIdle")).accepted, false);
    assert.equal((await call<GameProductionJob>(f.service, "games.production.reconcile", { id: job.id })).state, "failed");
  } finally { await f.close(); }
});

test("cancellation is pending until the adapter stops, and shutdown waits before closing its receipt store", async () => {
  let release!: () => void, started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const stopped = new Promise<void>((resolve) => { release = resolve; });
  const f = await fixture([adapter({ build: async ({ signal }) => { started(); await stopped; signal.throwIfAborted(); return output(); } })]);
  let reopened: AgentService | undefined;
  try {
    const p = await project(f.service);
    const job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "cancel", projectId: p.id, revision: 1 });
    await running;
    assert.equal((await call<GameProductionJob>(f.service, "games.production.cancel", { id: job.id })).state, "cancelling");
    assert.equal((await call<{ accepted: boolean }>(f.service, "engine.quiesceIfIdle")).accepted, false);
    const closing = f.service.close();
    assert.equal(f.service.store.db.open, true);
    release(); await closing;
    reopened = new AgentService(new Store(f.file), f.directory);
    assert.equal((await call<GameProductionJob>(reopened, "games.production.get", { id: job.id })).state, "cancelled");
    await assert.rejects(call(reopened, "games.builds.artifact", { id: job.id }), /no acknowledged artifact/);
  } finally { release(); await reopened?.close(); await f.close(); }
});

test("untrusted clients cannot register adapters, certify reports or use workspace tools under KidOS", async () => {
  const f = await fixture();
  try {
    const child = { ...reg, product: "kidos" as const, profile: "isaac" };
    const p = await call<GameProject>(f.service, "games.projects.create", { requestId: "child-game", document: fixtureGameDocument() }, child);
    await assert.rejects(call(f.service, "games.builds.start", { requestId: "child-build", projectId: p.id, revision: 1 }, child), /not authorized/);
    const capabilities = await call<{ adapters: unknown[] }>(f.service, "games.production.capabilities", {}, child);
    assert.deepEqual(capabilities.adapters, []);
    for (const method of ["games.adapters.register", "games.validation.put", "games.quality.approve"])
      await assert.rejects(call(f.service, method, { projectId: p.id, ready: true }), /method|Method/);
    assert.throws(() => new AgentService(new Store(":memory:"), f.directory, undefined, {}, { gameAdapters: [adapter({ products: ["kidos"] })] }), /protected Core/);
  } finally { await f.close(); }
});

test("malformed artifacts and unauthorized collector categories never leave partial published results", async () => {
  const f = await fixture([adapter({ build: async () => ({ entrypoint: "index.html", files: [...output().files, { ...output().files[0]!, path: "../escape" }] }) })]);
  try {
    const p = await project(f.service), job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "invalid-artifact", projectId: p.id, revision: 1 });
    assert.equal((await wait(f.service, job.id)).state, "awaiting_reconciliation");
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_artifacts").get() as { n: number }).n, 0);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_artifact_files").get() as { n: number }).n, 0);
  } finally { await f.close(); }
  const g = await fixture([adapter()], [collector({ validate: async () => [{ category: "human", checks: [{ id: "enjoyment", status: "passed", detail: "Forged human review" }], environment: { scope: "human", platform: "test", device: "test", browser: "test", input: [] }, metrics: {} }] })]);
  try {
    const p = await project(g.service), b = await call<GameProductionJob>(g.service, "games.builds.start", { requestId: "build", projectId: p.id, revision: 1 });
    await wait(g.service, b.id);
    const v = await call<GameProductionJob>(g.service, "games.validation.start", { requestId: "forged", buildId: b.id, collectorId: "fixture-license" });
    assert.match((await wait(g.service, v.id)).error!, /outside its installed authority/);
    assert.deepEqual(await json(g.service, "games.validation.reports", { id: b.id }), []);
  } finally { await g.close(); }
});

test("known safe toolchain failures permit explicit new attempts while absent editors are unavailable before admission", async () => {
  const f = await fixture([adapter({ build: async () => { throw new GameProductionFailure("Compiler exited; candidate discarded"); } })]);
  try {
    const p = await project(f.service), job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "known", projectId: p.id, revision: 1 });
    assert.equal((await wait(f.service, job.id)).state, "failed");
    assert.equal((await call<{ accepted: boolean }>(f.service, "engine.quiesceIfIdle")).accepted, true);
  } finally { await f.close(); }
  const g = await fixture([adapter({ probe: async () => ({ available: false, reason: "Editor is not installed" }) })]);
  try {
    const p = await project(g.service);
    await assert.rejects(call(g.service, "games.builds.start", { requestId: "absent", projectId: p.id, revision: 1 }), /not installed/);
    assert.equal((await call<{ jobs: unknown[] }>(g.service, "games.production.list", { projectId: p.id })).jobs.length, 0);
  } finally { await g.close(); }
});

test("conflicting produced file trees are rejected before storing artifact or evidence blobs", async () => {
  for (const paths of [["assets", "assets/a.png"], ["Assets/a.png", "assets/b.png"]]) {
    const files = paths.map((name) => ({ path: name, mime: "text/plain", data: Buffer.from("fixture") }));
    const f = await fixture([adapter({ build: async () => ({ ...output(), files: [...output().files, ...files] }) })]);
    try {
      const p = await project(f.service), job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "bad-tree", projectId: p.id, revision: 1 });
      assert.equal((await wait(f.service, job.id)).state, "awaiting_reconciliation");
      assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_artifacts").get() as { n: number }).n, 0);
      assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM transfers").get() as { n: number }).n, 0);
    } finally { await f.close(); }
  }
  const f = await fixture([adapter()], [collector({ validate: async () => [{ category: "license", checks: [{ id: "fixture", status: "unverified", detail: "Test fixture only" }],
    environment: { scope: "static", platform: "test", device: "fixture", browser: "none", input: [] }, metrics: {},
    evidenceFiles: ["captures", "captures/image.png"].map((name) => ({ path: name, mime: "text/plain", data: Buffer.from("fixture") })) }] })]);
  try {
    const p = await project(f.service), build = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "valid-tree", projectId: p.id, revision: 1 });
    assert.equal((await wait(f.service, build.id)).state, "completed");
    const before = (f.service.store.db.prepare("SELECT count(*) AS n FROM transfers").get() as { n: number }).n;
    const validation = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "bad-evidence-tree", buildId: build.id, collectorId: "fixture-license" });
    assert.equal((await wait(f.service, validation.id)).state, "awaiting_reconciliation");
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM transfers").get() as { n: number }).n, before);
    assert.deepEqual(await json(f.service, "games.validation.reports", { id: build.id }), []);
  } finally { await f.close(); }
});

test("TypeScript and Python SDKs retrieve pinned artifacts/reports over authenticated IPC", async () => {
  const f = await fixture([adapter()], [collector()]);
  const credential = await createClientCredential(f.directory, reg); f.service.store.register(credential);
  const identity = await ensureIdentity(f.directory), server = new LocalServer(f.service, f.directory);
  let client: AgentClient | undefined;
  try {
    await server.listen(); client = new AgentClient({ address: ipcPath(f.directory), certificate: identity.cert, credential }); await client.connect();
    assert.equal((await client.gameProductionCapabilities()).adapters[0]!.id, "fixture-build");
    const p = await client.createGameProject("sdk-project", fixtureGameDocument());
    const b = await client.startGameBuild("sdk-build", p.id, 1); await wait(f.service, b.id);
    assert.equal((await client.getGameProduction(b.id)).state, "completed");
    const a = await client.getGameArtifact(b.id);
    const bytes = await client.downloadGameArtifactFile(b.id, "index.html");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), a.files[0]!.sha256);
    assert.equal((await client.listGameProduction(p.id)).jobs.length, 1);
    assert.equal((await client.getGameQuality(p.id)).ready, false);
    assert.equal((await client.readGameProductionEvents(p.id)).events.at(-1)!.job.state, "completed");
    if (process.platform !== "win32") {
      const certificate = path.join(f.directory, "certificate"), auth = path.join(f.directory, "client.json");
      await writeFile(certificate, identity.cert, { mode: 0o600 }); await writeFile(auth, JSON.stringify(credential), { mode: 0o600 });
      const code = `import sys,json,time\nsys.path.insert(0,sys.argv[1])\nfrom pathlib import Path\nfrom companion_client import AgentClient\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4])); c.connect()\nb=c.start_game_build('sdk-build',sys.argv[5],1)\nassert b['state']=='completed'\nassert c.get_game_artifact(b['id'])['sourceHash']==sys.argv[6]\nassert b'Synthetic fixture' in c.download_game_artifact_file(b['id'],'index.html')\nv=c.start_game_validation('py-validation',b['id'],'fixture-license')\nfor i in range(200):\n v=c.get_game_production(v['id'])\n if v['state']=='completed': break\n time.sleep(.01)\nassert v['state']=='completed'\nassert c.get_game_reports(b['id'])[0]['category']=='license'\nassert not c.get_game_quality(sys.argv[5])['ready']\nassert len(c.list_game_production(sys.argv[5])['jobs'])==2\nassert c.read_game_production_events(sys.argv[5])['events'][-1]['job']['state']=='completed'\nc.close()\nprint('PYTHON_GAME_PRODUCTION_OK')`;
      const result = await promisify(execFile)("python3", ["-I", "-c", code, path.resolve("packages/client-python"), ipcPath(f.directory), certificate, auth, p.id, p.contentHash], { timeout: 30000 });
      assert.match(result.stdout, /PYTHON_GAME_PRODUCTION_OK/);
    }
    // Blob metadata alone is not sufficient; validators must detect altered stored bytes.
    f.service.store.db.prepare("UPDATE transfer_parts SET data=? WHERE id=?").run(Buffer.from("corrupted"), a.files[0]!.transferId);
    const bad = await client.startGameValidation("tampered", b.id, "fixture-license");
    assert.match((await wait(f.service, bad.id)).error!, /verified SHA-256/);
  } finally { client?.close(); await server.close(); await f.close(); }
});

test("artifact acknowledgement failure rolls back blobs, file pins and metadata together", async () => {
  const f = await fixture();
  try {
    const p = await project(f.service);
    f.service.store.db.exec("CREATE TRIGGER reject_artifact_pin BEFORE INSERT ON game_artifact_files BEGIN SELECT RAISE(ABORT, 'fixture-ack-failure'); END;");
    const job = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "atomic-artifact", projectId: p.id, revision: 1 });
    const result = await wait(f.service, job.id);
    assert.equal(result.state, "awaiting_reconciliation");
    assert.match(result.error!, /fixture-ack-failure/);
    for (const table of ["game_artifacts", "game_artifact_files", "transfers", "transfer_parts"])
      assert.equal((f.service.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
  } finally { await f.close(); }
});

test("collector evidence and its report are atomic, including when the final file pin fails", async () => {
  const c = collector({ validate: async () => [{ category: "license", environment: { platform: "test", device: "fixture", browser: "none", input: [], scope: "static" },
    checks: [{ id: "licenses", status: "unverified", detail: "No license acceptance implied by a synthetic fixture" }], metrics: {},
    evidenceFiles: [{ path: "trace.json", mime: "application/json", data: Buffer.from('{"fixture":true}') }] }] });
  const f = await fixture([adapter()], [c]);
  try {
    const p = await project(f.service), b = await call<GameProductionJob>(f.service, "games.builds.start", { requestId: "build-evidence", projectId: p.id, revision: 1 });
    await wait(f.service, b.id);
    const before = (f.service.store.db.prepare("SELECT count(*) AS n FROM transfers").get() as { n: number }).n;
    f.service.store.db.exec("CREATE TRIGGER fail_report_pin BEFORE INSERT ON game_report_files BEGIN SELECT RAISE(ABORT, 'fixture-report-pin-failure'); END;");
    const v = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "atomic-report", buildId: b.id, collectorId: c.id });
    const result = await wait(f.service, v.id);
    assert.equal(result.state, "awaiting_reconciliation");
    assert.match(result.error!, /fixture-report-pin-failure/);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_validation_reports").get() as { n: number }).n, 0);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_report_files").get() as { n: number }).n, 0);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM transfers").get() as { n: number }).n, before);
  } finally { await f.close(); }
});

test("installed Core and workspace adapters for the same engine stay separated by authenticated product", async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"production-products-"));let workspaceBuilds=0,coreBuilds=0;
 const corePort=adapter({id:"protected-core-phaser",products:["kidos"],authority:"kidos-core",build:async()=>{coreBuilds++;return output();}});
 const installed:import("../packages/agent-core/src/installed-adapter").InstalledAdapter={product:"kidos",validate(){},prepareTool(_r,_t,input){return input;},async invokeTool(){throw Error("No UI host tool");},async execute(){throw Error("No model needed");},gameAdapters:[corePort]};
 const service=new AgentService(new Store(path.join(directory,"state.sqlite")),directory,undefined,{}, {adapter:installed,gameAdapters:[adapter({build:async()=>{workspaceBuilds++;return output();}})]});
 const child={...reg,id:"child",product:"kidos" as const,profile:"child",providers:["kidos-gateway" as const]};
 try{
  const macCaps=await call<{adapters:{id:string}[]}>(service,"games.production.capabilities",{});
  const childCaps=await call<{adapters:{id:string}[]}>(service,"games.production.capabilities",{},child);
  assert.deepEqual(macCaps.adapters.map(row=>row.id),["fixture-build"]);
  assert.deepEqual(childCaps.adapters.map(row=>row.id),["protected-core-phaser"]);
  const mac=await project(service),kid=await call<GameProject>(service,"games.projects.create",{requestId:"kid",document:fixtureGameDocument()},child);
  const macJob=await call<GameProductionJob>(service,"games.builds.start",{requestId:"mac-build",projectId:mac.id,revision:1});
  const kidJob=await call<GameProductionJob>(service,"games.builds.start",{requestId:"kid-build",projectId:kid.id,revision:1},child);
  assert.equal((await wait(service,macJob.id)).state,"completed");
  for(let index=0;index<100;index++){
   const current=await call<GameProductionJob>(service,"games.production.get",{id:kidJob.id},child);
   if(current.state==="completed")break;await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal((await call<GameProductionJob>(service,"games.production.get",{id:kidJob.id},child)).state,"completed");
  assert.equal(kidJob.adapterId,"protected-core-phaser");assert.equal(macJob.adapterId,"fixture-build");
  assert.equal(coreBuilds,1);assert.equal(workspaceBuilds,1);
  await assert.rejects(call(service,"games.production.get",{id:kidJob.id}),/namespace|profile|owned|not found|does not belong/i);
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});

test('admitted validation publishes only observations pinned to its original build and never implies quality',async()=>{
  let reserves=0,validates=0,cancels=0;let artifactHash='';
  const observer=collector({admission:{reserve:async context=>{
    reserves++;artifactHash=context.artifact.artifactHash;
    assert.equal(context.job.state,'admitting');assert.equal(context.job.admission,'pending');
    assert.equal(context.artifact.jobId,context.job.buildId);
    assert.match(Buffer.from(await context.readFile('index.html')).toString(),/Synthetic fixture/);
  },cancel:async()=>{cancels++;}},validate:async context=>{
    validates++;assert.equal(context.job.admission,'reserved');assert.equal(context.artifact.artifactHash,artifactHash);
    return [{category:'license',environment:{platform:'fixture',device:'fixture',browser:'none',input:[],scope:'static'},
      checks:[{id:'license',status:'unverified',detail:'Scheduling fixture does not certify game assets or quality.'}],metrics:{}}];
  },reconcile:async()=>({state:'missing',detail:'Fixture original closed.'})});
  const f=await fixture([adapter()],[observer]);
  try{
    const p=await project(f.service),build=await call<GameProductionJob>(f.service,'games.builds.start',{requestId:'built',projectId:p.id,revision:1});await wait(f.service,build.id);
    const request={requestId:'observe',buildId:build.id,collectorId:observer.id};
    const job=await call<GameProductionJob>(f.service,'games.validation.start',request);assert.equal((await wait(f.service,job.id)).state,'completed');
    assert.equal((await call<GameProductionJob>(f.service,'games.validation.start',request)).id,job.id);
    const reports=await json<GameValidationReport[]>(f.service,'games.validation.reports',{id:build.id});
    assert.equal(reports.length,1);assert.equal(reports[0]!.artifactHash,artifactHash);assert.equal(reports[0]!.buildId,build.id);
    assert.equal((await json<GameQualityAssessment>(f.service,'games.quality.get',{projectId:p.id})).ready,false);
    assert.equal(reserves,1);assert.equal(validates,1);assert.equal(cancels,0);
  }finally{await f.close();}
});

test('shared production-policy schema accepts legacy and validation-capable authorities but rejects unknown kinds',async()=>{
  const {coreProductionPolicy}=await import('../packages/contracts/src/kidos-game-builds');
  const base={day:'2026-11-11',starts:0,reserved_bytes:0,daily_starts:64,daily_reserved_bytes:16*1024**3,allowed:true};
  for(const production_kinds of [undefined,['build','assets'],['build','assets','validate']]){
    assert.doesNotThrow(()=>coreProductionPolicy.parse({...base,...(production_kinds?{production_kinds}:{})}));
  }
  assert.throws(()=>coreProductionPolicy.parse({...base,production_kinds:['validate','human-approved']}));
});
