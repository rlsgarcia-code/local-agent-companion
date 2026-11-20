import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { FakeToolCallingModel } from "langchain";
import { executeGraph } from "../packages/agent-core/src/index";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { Transfers } from "../packages/agent-service/src/transfers";
import { GAME_AGENT_TOOLS } from "../packages/agent-service/src/game-agent-tools";
import { gameAgentSchemas } from "../packages/contracts/src/game-agent";
import { runSpec, type Registration, type Run } from "../packages/contracts/src/index";
import type { GameFile, GameProject } from "../packages/contracts/src/games";
import { fixtureGameDocument } from "./game-fixtures";

type Inspection = { revision: number; sourceHash: string; fileHash: string; valid: boolean; scenarioCount?: number; stepCount?: number;
  issues: { path: (string | number)[]; code: string; message: string }[]; omittedIssues: number };
for (const runtime of ["standard", "deep"] as const) test(`${runtime} checks saved recipes read-only with canonical limits, design bindings and bounded private diagnostics`, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "game-recipe-")),store = new Store(path.join(directory, "state.sqlite"));
  const reg: Registration = { id: "recipe", product: "companion-vscode", profile: "fixture", workspace: "fixture", providers: ["ollama"], hostTools: [] };
  const calls: { name: string; args: Record<string, unknown>; id: string }[] = [],observed: unknown[] = [],model = new FakeToolCallingModel({ toolCalls: [calls, []] });
  const bind = model.bindTools.bind(model);model.bindTools = tools => { const bound = bind(tools);assert.ok(bound instanceof FakeToolCallingModel);const generate = bound._generate.bind(bound);bound._generate = async (...args) => { const result = await generate(...args);for (const generation of result.generations) { generation.text = "Recipe inspection fixture";generation.message.content = generation.text; }return result; };return bound; };
  const service = new AgentService(store, directory, (request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model },
    gameProduction: { ...context.gameProduction!, invoke: async (...args) => { const value = await context.gameProduction!.invoke(...args);observed.push(value);return value; } } }));
  const api = <T>(method: string, input: unknown, actor = reg) => service.dispatch(actor, method, input, "fixture-client") as Promise<T>;
  try {
    assert.equal(GAME_AGENT_TOOLS.find(tool => tool.name === "game_check_tests")!.effect, "read");
    assert.equal(gameAgentSchemas.game_check_tests.safeParse({ projectId: "fixture", path: "../host.json" }).success, false);
    const transfers = new Transfers(store),doc = fixtureGameDocument(),marker = "PRIVATE_SUBMITTED_EXTRA_KEY_DO_NOT_ECHO";
    const valid = { schemaVersion: 1, scenarios: [{ id: "input", designScenarioId: "anchor", steps: [{ action: "capture", name: "before" }, { action: "key-down", key: "ArrowRight" }, { action: "wait", ms: 100 }, { action: "key-up", key: "ArrowRight" }, { action: "expect-image", baseline: "before", comparison: "changed" }] }] };
    const cases = [JSON.stringify(valid), JSON.stringify({ schemaVersion: 1, scenarios: [{ id: "bad", steps: [{ action: "wait", ms: 3000 }, { action: "expect-image", baseline: "never-captured", comparison: "changed" }] }] }),
      JSON.stringify({ ...valid, [marker]: marker }), "{invalid-json:" + marker, JSON.stringify({ ...valid, scenarios: [{ ...valid.scenarios[0], designScenarioId: "missing" }] }),
      JSON.stringify({ schemaVersion: 1, scenarios: Array.from({ length: 40 }, (_value, index) => ({ id: `case-${index}`, steps: [{ action: "wait", ms: 3000 }] })) }), " ".repeat(1024 * 1024 + 1), JSON.stringify({ schemaVersion: 1, scenarios: [] }), "EXECUTABLE_FIXTURE_MUST_NOT_RUN"];
    for (const [index, text] of cases.entries()) {
      const data = Buffer.from(text),sha256 = createHash("sha256").update(data).digest("hex"),transfer = transfers.begin(reg, { key: `recipe-${index}`, size: data.length, sha256, mime: "application/json" });
      for (let offset = 0;offset < data.length;offset += 192 * 1024) transfers.append(reg, transfer.id, offset, data.subarray(offset, offset + 192 * 1024));transfers.commit(reg, transfer.id);
      doc.files.push({ path: `data/playtests/case-${index}.json`, size: data.length, sha256, mime: "application/json", transferId: transfer.id } as GameFile);
    }
    const p = await api<GameProject>("games.projects.create", { requestId: "create", document: doc });
    const changed = structuredClone(doc);changed.title = "New revision";const current = await api<GameProject>("games.revisions.commit", { projectId: p.id, requestId: "change", expectedRevision: 1, document: changed, message: "Revision binding fixture" });
    const foreign = await api<GameProject>("games.projects.create", { requestId: "foreign", document: fixtureGameDocument() }, { ...reg, product: "companion-mac" });
    cases.forEach((_text, index) => calls.push({ name: "game_check_tests", args: { projectId: p.id, path: doc.files[index]!.path, revision: 1 }, id: `check-${index}` }));
    calls.push({ name: "game_check_tests", args: { projectId: foreign.id, path: "data/playtests.json" }, id: "foreign" });
    const session = store.createSession(reg, "Check recipes"),run = await api<Run>("runs.start", { sessionId: session.id, key: "check", spec: runSpec.parse({ runtime, mode: "plan", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } }, messages: [{ role: "user", content: "Inspect only the saved recipes" }], tools: [], systemPrompt: "Read-only fixture" }) });
    for (let i = 0;i < 800 && !["completed", "failed"].includes(store.run(reg, run.id).state);i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(store.run(reg, run.id).state, "completed", store.run(reg, run.id).error);const inspections = observed.slice(0, cases.length) as Inspection[];
    assert.equal(inspections.length, cases.length);assert.equal(inspections[0]!.valid, true);assert.equal(inspections[0]!.scenarioCount, 1);assert.equal(inspections[0]!.stepCount, 5);
    for (const [index, result] of inspections.entries()) { assert.equal(result.revision, 1);assert.equal(result.sourceHash, p.contentHash);assert.equal(result.fileHash, doc.files[index]!.sha256);if (index) assert.equal(result.valid, false); }
    assert.match(JSON.stringify(inspections[1]!.issues), /2000/);assert.match(JSON.stringify(inspections[1]!.issues), /earlier captured baseline/);
    assert.equal(inspections[4]!.issues[0]!.code, "invalid_reference");assert.equal(inspections[5]!.issues.length, 20);assert.equal(inspections[5]!.omittedIssues, 20);
    assert.equal(inspections[6]!.issues[0]!.code, "too_big");assert.equal(inspections[7]!.valid, false);assert.equal(JSON.stringify(observed).includes(marker), false);
    assert.equal((observed.at(-1) as { ok: boolean }).ok, false);assert.equal((await api<GameProject>("games.projects.get", { id: p.id })).revision, current.revision);
    assert.deepEqual(await api("host.poll", {}), []);assert.equal((await api<{ jobs: unknown[] }>("games.production.list", { projectId: p.id })).jobs.length, 0);
  } finally { await service.close();await rm(directory, { recursive: true, force: true }); }
});
