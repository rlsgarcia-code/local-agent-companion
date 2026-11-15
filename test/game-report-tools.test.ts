import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { gameReportPage, readGameReportText, MAX_REPORT_TEXT_BYTES } from "../packages/game-production/src/report-views";
import { gameAgentSchemas } from "../packages/contracts/src/game-agent";
import { GAME_AGENT_TOOLS } from "../packages/agent-service/src/game-agent-tools";
import { gameProductionProfile } from "../packages/agent-core/src/game-production-profile";
import { FakeToolCallingModel } from "langchain";
import { runSpec, type Registration, type Run } from "../packages/contracts/src/index";
import type { GameProductionAdapter, GameValidationCollector, CollectedGameObservation } from "../packages/game-production/src/index";
import type { GameProject } from "../packages/contracts/src/games";
import type { GameProductionJob, GameValidationReport } from "../packages/contracts/src/game-production";
import { fixtureGameDocument } from "./game-fixtures";
import { Transfers } from "../packages/agent-service/src/transfers";
import { executeGraph } from "../packages/agent-core/src/index";

test("report pages preserve complete escaped records and advance only by returned items", () => {
  const input = Array.from({ length: 21 }, (_, id) => ({ id, detail: "\0".repeat(4000) }));
  const all: typeof input = [];let cursor = 0;
  while (true) { const page = gameReportPage(input, cursor, 20);assert.ok(page.items.length < 20);assert.ok(Buffer.byteLength(JSON.stringify(page.items)) <= 64 * 1024 + 2);assert.equal(page.cursor, cursor + page.items.length);all.push(...page.items);cursor = page.cursor;if (!page.hasMore) break; }
  assert.deepEqual(all, input);assert.deepEqual(gameReportPage(input, cursor, 20).items, []);
  assert.throws(() => gameReportPage([{ detail: "PRIVATE_DATA".repeat(10000) }], 0, 1), error => error instanceof Error && !error.message.includes("PRIVATE_DATA"));
});

test("evidence text uses exact UTF-8 byte cursors including BOM, controls and astral characters", () => {
  const text = "\ufeff" + "🛶 Maré\r\n\0".repeat(5000),data = Buffer.from(text),original = Buffer.from(data);let cursor = 0,result = "";
  while (true) { const page = readGameReportText(data, cursor, 257);assert.equal(page.offset, cursor);assert.equal(page.totalBytes, data.length);assert.ok(Buffer.byteLength(page.content) <= 257);result += page.content;cursor = page.cursor;if (!page.hasMore) break; }
  assert.equal(result, text);assert.deepEqual(data, original);assert.equal(readGameReportText(data, data.length, 256).content, "");
  for (const args of [[1, 256], [-1, 256], [data.length + 1, 256], [0, 255], [0, 16385]]) assert.throws(() => readGameReportText(data, args[0]!, args[1]!));
  assert.throws(() => readGameReportText(Buffer.from([255, 254]), 0, 256), /not valid UTF-8/);
  assert.throws(() => readGameReportText(Buffer.alloc(MAX_REPORT_TEXT_BYTES + 1), 0, 256), /complete bytes remain/);
});

test("report tools are strict read-only inputs available in Plan and reviewer catalogs", () => {
  const names = ["game_reports", "game_report", "game_read_report_file"];
  const model = new FakeToolCallingModel(),profile = gameProductionProfile({ catalog: GAME_AGENT_TOOLS, invoke: async () => ({}), evidence: () => ({ changes: [], projects: [] }) }, { mode: "plan", signal: new AbortController().signal, readTools: [], modelForRole: () => model })!;
  for (const name of names) { assert.equal(GAME_AGENT_TOOLS.find(tool => tool.name === name)!.effect, "read");assert.ok(profile.tools.some(tool => tool.name === name));for (const specialist of profile.specialists) assert.ok(specialist.tools.some(tool => tool.name === name)); }
  for (const input of [{ reportId: "report", path: "../host" }, { reportId: "report", path: "/home/child/file" }, { reportId: "report", path: "runtime.json", cursor: -1 }, { reportId: "report", path: "runtime.json", limit: 16385 }, { reportId: "report", path: "runtime.json", execute: true }]) assert.equal(gameAgentSchemas.game_read_report_file.safeParse(input).success, false);
});

test("the service exposes exact failed report evidence without dispatch, foreign access or quality changes, including after restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "game-report-tools-")),file = path.join(directory, "state.sqlite");
  const reg: Registration = { id: "report-reader", product: "companion-vscode", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
  const toolchain = { id: "report-fixture", version: "1", sha256: "a".repeat(64) };
  let builds = 0,collections = 0,read = false,buildId = "",reportId = "";
  const text = JSON.stringify({ errors: ["Missing packaged resource: assets/fixture.png"], trace: "Maré 🛶\n".repeat(8000) });
  const adapter: GameProductionAdapter = { id: "report-fixture-build", engine: "phaser", products: ["companion-vscode"], authority: "workspace", toolchain, probe: async () => ({ available: true }), build: async () => { builds++;return { entrypoint: "index.html", files: [{ path: "index.html", mime: "text/html", data: Buffer.from("<!doctype html>fixture") }] }; } };
  const collector: GameValidationCollector = { id: "report-fixture-collector", engines: ["phaser"], products: ["companion-vscode"], authority: "workspace", toolchain, categories: ["runtime"], validate: async () => {
    collections++;const report: CollectedGameObservation = { category: "runtime", environment: { platform: "fixture", device: "synthetic diagnostics", browser: "none", input: [], scope: "automated" },
      checks: [{ id: "console", status: "failed", detail: "Synthetic missing-resource failure; not a browser observation." }], metrics: { fixture: true }, coverage: { contentIds: [], scenarioIds: [] },
      evidenceFiles: [{ path: "runtime.json", mime: "application/json", data: Buffer.from(text) }, { path: "boot.png", mime: "image/png", data: Buffer.from([137, 80, 78, 71]) }, { path: "bad.json", mime: "application/json", data: Buffer.from([255, 254]) }] };
    return [report, { ...report, metrics: { fixture: true, index: 1 } }, { ...report, metrics: { fixture: true, index: 2 } }];
  } };
  const execute = async (_spec: unknown, context: import("../packages/agent-core/src/index").ExecutionContext) => {
    const port = context.gameProduction!;
    if (context.registration.profile === "other") {
      for (const [name, input] of [["game_reports", { buildId }], ["game_report", { reportId }], ["game_read_report_file", { reportId, path: "runtime.json" }]] as const) {
        const result = await port.invoke(name, input, name) as { ok: boolean; error: { message: string } };assert.equal(result.ok, false);assert.doesNotMatch(result.error.message, /Missing packaged resource/);
      }
      return { text: "Foreign report remains unavailable" };
    }
    const listing = await port.invoke("game_reports", { buildId, limit: 1 }, "reports") as { reports: { id: string; counts: { failed: number } }[]; total: number; cursor: number; hasMore: boolean };
    assert.equal(listing.total, 3);assert.equal(listing.reports[0]!.id, reportId);assert.equal(listing.reports[0]!.counts.failed, 1);assert.equal(listing.cursor, 1);assert.equal(listing.hasMore, true);
    const next = await port.invoke("game_reports", { buildId, cursor: listing.cursor, limit: 1 }, "reports-next") as typeof listing;
    assert.equal(next.cursor, 2);assert.notEqual(next.reports[0]!.id, reportId);
    const checks = await port.invoke("game_report", { reportId }, "checks") as { report: { sourceHash: string; revision: number }; items: { status: string; detail: string }[] };
    assert.equal(checks.report.revision, 1);assert.equal(checks.items[0]!.status, "failed");
    const evidence = await port.invoke("game_report", { reportId, section: "evidence", limit: 1 }, "evidence") as { items: { path: string }[]; cursor: number; hasMore: boolean };
    assert.equal(evidence.items[0]!.path, "runtime.json");assert.equal(evidence.cursor, 1);assert.equal(evidence.hasMore, true);
    let cursor = 0,combined = "";
    while (true) { const page = await port.invoke("game_read_report_file", { reportId, path: "runtime.json", cursor, limit: 16384 }, `text-${cursor}`) as { kind: string; content: string; cursor: number; hasMore: boolean; report: { sourceHash: string } };
      assert.equal(page.kind, "text-evidence");assert.equal(page.report.sourceHash, checks.report.sourceHash);combined += page.content;cursor = page.cursor;if (!page.hasMore) break; }
    assert.equal(combined, text);
    assert.equal((await port.invoke("game_read_report_file", { reportId, path: "boot.png" }, "image") as { kind: string }).kind, "sdk-download-required");
    for (const [path, cursor] of [["bad.json", 0], ["not-in-report.json", 0], ["runtime.json", 99999999]] as const) assert.equal((await port.invoke("game_read_report_file", { reportId, path, cursor }, `bad-${path}`) as { ok: boolean }).ok, false);
    assert.equal((await port.invoke("game_reports", { buildId: "unknown" }, "unknown-build") as { ok: boolean }).ok, false);
    assert.deepEqual(port.evidence().changes, []);read = true;return { text: "Actual fixture diagnostics read; no quality granted" };
  };
  let service = new AgentService(new Store(file), directory, execute, {}, { gameAdapters: [adapter], gameCollectors: [collector] });
  const call = (method: string, args: unknown, registration = reg) => service.dispatch(registration, method, args, "fixture");
  async function settled(id: string) { for (let i = 0; i < 500; i++) { const job = await call("games.production.get", { id }) as GameProductionJob;if (["completed", "failed"].includes(job.state)) return job;await new Promise(resolve => setTimeout(resolve, 2)); }throw Error("Original fixture job did not settle"); }
  async function run(registration: Registration, key: string, runtime: "standard" | "deep" = "standard") { const session = service.store.createSession(registration, "Read report");const saved = await call("runs.start", { sessionId: session.id, key, spec: runSpec.parse({ runtime, mode: "plan", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "not-called" } }, messages: [{ role: "user", content: "Inspect recorded diagnostics only" }], systemPrompt: "Fixture", tools: [] }) }, registration) as Run;
    for (let i = 0; i < 2000 && service.store.run(registration, saved.id).state === "running"; i++) await new Promise(resolve => setTimeout(resolve, 2));assert.equal(service.store.run(registration, saved.id).state, "completed", service.store.run(registration, saved.id).error);return session; }
  try {
    const project = await call("games.projects.create", { requestId: "project", document: fixtureGameDocument() }) as GameProject;
    const build = await call("games.builds.start", { requestId: "build", projectId: project.id, revision: 1 }) as GameProductionJob;buildId = build.id;assert.equal((await settled(build.id)).state, "completed");
    const validation = await call("games.validation.start", { requestId: "validate", buildId, collectorId: collector.id }) as GameProductionJob;assert.equal((await settled(validation.id)).state, "completed");
    const transfer = await call("games.validation.reports", { id: buildId }) as { id: string };reportId = (new Transfers(service.store).json(reg, transfer.id) as GameValidationReport[])[0]!.id;
    const quality = async () => { const result = await call("games.quality.get", { projectId: project.id }) as { id: string };return new Transfers(service.store).json(reg, result.id) as { ready: boolean; blockers: string[] }; };
    const before = await quality();assert.equal(before.ready, false);
    await run(reg, "read-one");assert.equal(read, true);assert.deepEqual(await call("host.poll", {}), []);assert.equal(builds, 1);assert.equal(collections, 1);
    assert.deepEqual(await quality(), before, "reading a failed observation cannot improve quality");
    await run({ ...reg, profile: "other" }, "foreign");
    await call("games.revisions.commit", { requestId: "new-source", projectId: project.id, expectedRevision: 1, document: { ...fixtureGameDocument(), title: "New source" }, message: "Fixture later revision" });
    await service.close();service = new AgentService(new Store(file), directory, execute, {}, { gameAdapters: [adapter], gameCollectors: [collector] });
    await run(reg, "read-after-restart");assert.equal((await call("games.projects.get", { id: project.id }) as GameProject).revision, 2);assert.equal(builds, 1);assert.equal(collections, 1);
    for (const runtime of ["standard", "deep"] as const) {
      await service.close();
      const model = new FakeToolCallingModel({ toolCalls: [[{ id: `read-${runtime}`, name: "game_read_report_file", args: { reportId, path: "runtime.json" } }], []] });
      service = new AgentService(new Store(file), directory, (request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model } }), {}, { gameAdapters: [adapter], gameCollectors: [collector] });
      const session = await run(reg, `graph-${runtime}`, runtime);
      const results = service.store.events(reg, session.id, 0).filter(event => event.type === "game.activity" && (event.data as { tool: string }).tool === "game_read_report_file");
      assert.equal(results.length, 1);assert.ok(JSON.stringify(results[0]!.data).includes("Missing packaged resource: assets/fixture.png"));
      assert.equal((await quality()).ready, false);assert.deepEqual(await call("host.poll", {}), []);
    }
    assert.equal((service.store.db.prepare("SELECT count(*) AS n FROM game_production_jobs").get() as { n: number }).n, 2);
    const child = { ...reg, product: "kidos" as const };assert.equal((await call("engine.info", {}, child) as { capabilities: string[] }).capabilities.includes("game-validation-reports-v1"), false);
  } finally { await service.close();await rm(directory, { recursive: true, force: true }); }
});
