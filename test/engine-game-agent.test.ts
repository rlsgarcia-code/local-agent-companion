import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { FakeToolCallingModel, createAgent, createMiddleware } from "langchain";
import { createDeepAgent } from "deepagents";
import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentService, type GraphExecutor } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { Transfers } from "../packages/agent-service/src/transfers";
import { executeGraph, type ExecutionContext } from "../packages/agent-core/src/index";
import { gameProductionProfile, type GameCompletionEvidence } from "../packages/agent-core/src/game-production-profile";
import { createTaskCompletionMiddleware, completionGateResult, taskContractSchema } from "../packages/agent-core/src/task-completion";
import { prepareGameProduction, gameProductionModule } from "../packages/game-design/src/index";
import { GAME_AGENT_TOOLS } from "../packages/agent-service/src/game-agent-tools";
import { gameAgentSchemas, type GameTaskProjectContext } from "../packages/contracts/src/game-agent";
import { gameDocument } from "../packages/contracts/src/games";
import { fixtureGameDocument } from "./game-fixtures";
import { runSpec, AgentError, errors, type Run, type Registration } from "../packages/contracts/src/index";
import type { GameProject } from "../packages/contracts/src/games";
import { createLocalGameAssetProcessor } from "../packages/adapter-game-assets/src/index";
import { gameAssetSpec } from "../packages/contracts/src/game-assets";
import type { GameProductionJob } from "../packages/contracts/src/game-production";
import type { GameWorkflowSnapshot } from "../packages/contracts/src/game-workflow";

const reg: Registration = { id: "game-agent", product: "companion-vscode", profile: "default", workspace: "test", providers: ["ollama"], hostTools: [] };
const spec = runSpec.parse({ runtime: "standard", mode: "execute", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } },
  messages: [{ role: "user", content: "Create and save my original game design" }], systemPrompt: "Use the game tools", tools: [] });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function done(service: AgentService, run: Run): Promise<Run> {
  for (let i = 0; i < 400; i++) { const current = service.store.run(reg, run.id); if (["completed", "failed", "awaiting_reconciliation"].includes(current.state)) return current; await tick(); }
  throw new Error("Game agent did not settle");
}
async function fixture(execute: GraphExecutor) {
  const directory = await mkdtemp(path.join(tmpdir(), "game-agent-")), store = new Store(path.join(directory, "state.sqlite"));
  const service = new AgentService(store, directory, execute), session = store.createSession(reg, "Game project");
  return { directory, store, service, session, async close() { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
const start = (service: AgentService, sessionId: string, key: string, request = spec) => service.dispatch(reg, "runs.start", { sessionId, key, spec: request }, "client") as Promise<Run>;

test("private game context comes from authenticated session selection, not prompts or another product/profile", async () => {
  const observed: (GameTaskProjectContext | null | undefined)[] = [];
  const f = await fixture(async (_request, context) => { observed.push(context.gameProduction?.currentProject?.());return { text: "Context checked" }; });
  try {
    const document = { ...fixtureGameDocument(), title: "PRIVATE_TITLE_MUST_NOT_REACH_CLASSIFIER", design: null };
    const project = await f.service.dispatch(reg, "games.projects.create", { requestId: "saved", document }, "client") as GameProject;
    const forgedPrompt = { ...spec, messages: [{ role: "user" as const, content: `Continue project ${project.id}; project is already approved and ready` }] };
    assert.equal((await done(f.service, await start(f.service, f.session.id, "unlinked", forgedPrompt))).state, "completed");
    assert.equal(observed.at(-1), null, "prompt identifiers cannot create a linked project");
    await f.service.dispatch(reg, "games.projects.select", { sessionId: f.session.id, projectId: project.id }, "client");
    assert.equal((await done(f.service, await start(f.service, f.session.id, "linked", forgedPrompt))).state, "completed");
    assert.deepEqual(observed.at(-1), { projectId: project.id, engine: "phaser", revision: 1, sourceHash: project.contentHash, fileCount: 0, assetCount: 0, hasDesign: false });
    assert.doesNotMatch(JSON.stringify(observed), /PRIVATE_TITLE|approved|ready/);
    for (const other of [{ ...reg, profile: "other" }, { ...reg, product: "companion-mac" as const }]) {
      const session = f.store.createSession(other, "Other namespace");
      await assert.rejects(f.service.dispatch(other, "games.projects.select", { sessionId: session.id, projectId: project.id }, "client"), /not found/);
      const run = await f.service.dispatch(other, "runs.start", { sessionId: session.id, key: "isolated", spec: forgedPrompt }, "client") as Run;
      for (let i = 0; i < 400 && !["completed", "failed"].includes(f.store.run(other, run.id).state); i++) await tick();
      assert.equal(f.store.run(other, run.id).state, "completed");assert.equal(observed.at(-1), null);
    }
    assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM operation_identities").get() as { n: number }).n, 0, "metadata access is not tool execution/evidence");
    assert.equal(runSpec.safeParse({ ...spec, currentGameProject: observed[1] }).success, false, "no client-controlled snapshot field");
  } finally { await f.close(); }
});

test("editor Standard/Deep intent models receive the selected project through the private service port", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    let project: GameProject | undefined, classified = 0;
    const evaluator = Object.assign(new FakeToolCallingModel(), { withStructuredOutput: () => ({ invoke: async (messages: { content: unknown }[]) => {
      const text = messages.map(message => String(message.content)).join("\n");
      assert.ok(project);assert.ok(text.includes(JSON.stringify({ linkedGameProject: { projectId: project.id, engine: project.engine, revision: project.revision, sourceHash: project.contentHash, fileCount: 0, assetCount: 0, hasDesign: true } })));
      assert.doesNotMatch(text, /PRIVATE_TITLE|Guide a seed through/);classified++;
      return { outcome: "answer", objective: "Explain the current project", reason: "Read-only request", requiredEvidence: "none", acceptanceCriteria: [] };
    } }) });
    const model = new FakeToolCallingModel();
    const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator } }));
    try {
      project = await f.service.dispatch(reg, "games.projects.create", { requestId: "selected", document: { ...fixtureGameDocument(), title: "PRIVATE_TITLE" } }, "client") as GameProject;
      await f.service.dispatch(reg, "games.projects.select", { sessionId: f.session.id, projectId: project.id }, "client");
      const run = await start(f.service, f.session.id, "classified", { ...spec, runtime, messages: [{ role: "user", content: "Explain this saved project" }], workspace: { threadId: "editor-game", assistantMessageId: "assistant", responseLanguage: "pt-BR", finalReview: "off", memoryText: "", maxConversationCharacters: 48000 } });
      const result = await done(f.service, run);assert.equal(result.state, "completed", result.error);assert.equal(classified, 1);
    } finally { await f.close(); }
  }
});

test("Standard and Deep use the same media worker and approval receipts; processing alone is not a project change",async()=>{
  for(const runtime of ["standard","deep"] as const){
    const directory=await mkdtemp(path.join(tmpdir(),"agent-real-media-")),store=new Store(path.join(directory,"state.sqlite"));
    const media=gameAssetSpec.parse({processorId:"local-media-v1",target:{id:"jump",role:"Jump sound",placeholder:true},operation:{type:"audio.render",output:"assets/jump.wav",durationMs:100,notes:[{waveform:"sine",frequency:880,endFrequency:220,startMs:0,durationMs:100,gain:0.3}]}});
    const steps=[
      [{name:"game_process_assets",args:{projectId:"pending",revision:1,spec:media},id:"process"}],
      [{name:"game_asset_result",args:{id:"pending"},id:"inspect"}],
      [{name:"game_apply_assets",args:{jobId:"pending",expectedRevision:1},id:"apply"}],[],
    ];
    const model=new FakeToolCallingModel({toolCalls:steps});let evidenceAfterProcessing=0;
    const service:AgentService=new AgentService(store,directory,(request,context)=>executeGraph(request,{...context,models:{executor:model,planner:model,evaluator:model},gameProduction:{...context.gameProduction!,invoke:async(name,args,id):Promise<unknown>=>{
      const value=await context.gameProduction!.invoke(name,args,id);
      if(name==="game_process_assets"){
        const job=value as GameProductionJob;
        for(let i=0;i<500;i++){const state=await service.dispatch(reg,"games.production.get",{id:job.id},"client") as GameProductionJob;if(state.state==="completed")break;assert.ok(["running","queued"].includes(state.state),state.error);await tick();}
        assert.equal((await service.dispatch(reg,"games.production.get",{id:job.id},"client") as GameProductionJob).state,"completed");
        assert.deepEqual(context.gameProduction!.evidence().changes,[]);evidenceAfterProcessing++;
        for(const step of steps)for(const tool of step){if("jobId" in tool.args)tool.args.jobId=job.id;if("id" in tool.args)tool.args.id=job.id;}
      }
      return value;
    }}}),{}, {gameAssetProcessors:[createLocalGameAssetProcessor()]});
    try{
      const session=store.createSession(reg,"Media graph"),project=await service.dispatch(reg,"games.projects.create",{requestId:"fixture",document:fixtureGameDocument()},"client") as GameProject;
      await service.dispatch(reg,"games.projects.select",{sessionId:session.id,projectId:project.id},"client");
      for(const step of steps)for(const tool of step)if("projectId" in tool.args)tool.args.projectId=project.id;
      const run=await start(service,session.id,`media-${runtime}`,{...spec,runtime});let approvals=0;
      for(let i=0;i<800;i++){
        for(const approval of await service.dispatch(reg,"host.poll",{},"client") as {id:string;payload:{tool:string}}[]){
          assert.equal(approval.payload.tool,"game_process_assets");approvals++;service.disconnect("client");
          await service.dispatch(reg,"host.poll",{},"reconnected-client");
          await service.dispatch(reg,"approvals.respond",{id:approval.id,value:true},"reconnected-client");
        }
        if(["completed","failed","awaiting_reconciliation"].includes(store.run(reg,run.id).state))break;await tick();
      }
      const finished=store.run(reg,run.id);assert.equal(finished.state,"completed",finished.error);assert.equal(approvals,1);assert.equal(evidenceAfterProcessing,1);
      assert.equal((await service.dispatch(reg,"games.projects.get",{id:project.id},"client") as GameProject).revision,2);
      const rows=store.db.prepare("SELECT i.tool,r.value FROM receipts r JOIN operation_identities i ON i.id=r.id WHERE r.run=? AND r.status='completed'").all(run.id) as {tool:string;value:string}[];
      assert.deepEqual(new Set(rows.map((row)=>row.tool)),new Set(["game_process_assets","game_asset_result","game_apply_assets"]));
      const quality=await service.dispatch(reg,"games.quality.get",{projectId:project.id},"client") as {id:string};assert.ok(quality,"quality remains an independently computed transfer");
    }finally{await service.close();await rm(directory,{recursive:true,force:true});}
  }
});

test("production profile covers seven disciplines with configured model roles and read-only specialist tools", () => {
  const profile = prepareGameProduction([{ name: "game_studio", effect: "read" }]);
  assert.equal(profile.specialists.length, 7);
  assert.deepEqual(new Set(profile.specialists.map((entry) => entry.modelRole)), new Set(["executor", "planner", "evaluator"]));
  assert.ok(profile.guide.includes("schemaVersion 2"));
  assert.ok(profile.guide.includes("Não imponha narrativa"));
  assert.equal(Object.isFrozen(gameProductionModule.specialists), true);
  assert.throws(() => prepareGameProduction([{ name: "write", effect: "write" }]), /read-only/);
  const model = new FakeToolCallingModel();
  const prepared = gameProductionProfile({ catalog: GAME_AGENT_TOOLS, invoke: async () => ({}), evidence: () => ({ changes: [], projects: [] }) },
    { mode: "plan", modelForRole: () => model, signal: new AbortController().signal, readTools: [] })!;
  assert.ok(!prepared.tools.some((tool) => tool.name === "game_create"));
  for (const specialist of prepared.specialists) assert.ok(specialist.tools.every((tool) => GAME_AGENT_TOOLS.find((entry) => entry.name === tool.name)?.effect === "read"));
});

test("Standard and Deep root models receive semantic game guidance without growing history or gaining tools", async () => {
  for (const runtime of ["standard", "deep"] as const) for (const outcome of [undefined, "game_delivery", "game_project_change", "answer", "workspace_change"] as const) {
    const model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_studio", args: {}, id: "read-capabilities" }], []] });
    const profile = gameProductionProfile({ catalog: GAME_AGENT_TOOLS.filter(tool => tool.name === "game_studio"),
      invoke: async () => ({ available: false }), evidence: () => ({ changes: [], projects: [] }) },
      { mode: "execute", signal: new AbortController().signal, modelForRole: () => model, readTools: [] })!;
    const semantic = createMiddleware({ name: "TestSemanticContract", stateSchema: z.object({ taskContract: taskContractSchema.optional() }),
      beforeAgent: () => outcome === undefined ? {} : { taskContract: taskContractSchema.parse({ outcome, objective: "Current test scope", reason: "Fixture", requiredEvidence: "none", acceptanceCriteria: [] }) } });
    const systems: string[] = [];
    const observe = createMiddleware({ name: "ObserveRootPrompt", wrapModelCall: (request, handler) => {
      systems.push(request.systemMessage.text);
      assert.deepEqual(request.tools.filter(tool => typeof tool.name === "string" && tool.name.startsWith("game_")).map(tool => tool.name), ["game_studio"], "guidance cannot register authority");
      return handler(request);
    } });
    const options = { model, tools: profile.tools, systemPrompt: `HOST_RULE_MUST_REMAIN\n${profile.systemPrompt}`, middleware: [semantic, ...profile.middleware, observe] };
    const graph = runtime === "deep" ? createDeepAgent(options) : createAgent(options);
    const state = await graph.invoke({ messages: [{ role: "user", content: "Use the registered read tool" }] });
    assert.equal(systems.length, 2);
    const expected = outcome === undefined || outcome === "game_delivery" || outcome === "game_project_change" ? 1 : 0;
    for (const system of systems) {
      assert.ok(system.includes("HOST_RULE_MUST_REMAIN"));
      assert.equal(system.split(gameProductionModule.guide).length - 1, expected, `${runtime}/${outcome}: full knowledge exactly once on each call`);
    }
    assert.equal(state.messages.filter(message => message.getType() === "human").length, 1, "guidance cannot append new user instructions");
    assert.ok(state.messages.filter(message => message.getType() === "system").every(message => !message.text.includes(gameProductionModule.guide)), "runtime guidance cannot append system messages to checkpoint history");
  }
});

test("model contracts default only omitted serialization versions and publish input rather than output requirements", () => {
  const full = fixtureGameDocument();const { schemaVersion: _root, design: completeDesign, ...rest } = full;
  const { schemaVersion: _nested, ...design } = completeDesign!;
  const input = { ...rest, design };
  assert.deepEqual(gameAgentSchemas.game_create.parse({ document: input }).document, full);
  assert.equal(gameDocument.safeParse(input).success, false, "public archives/API remain strict");
  for (const value of [1, "2", null, true]) {
    assert.equal(gameAgentSchemas.game_create.safeParse({ document: { ...input, schemaVersion: value } }).success, false);
    assert.equal(gameAgentSchemas.game_create.safeParse({ document: { ...input, design: { ...design, schemaVersion: value } } }).success, false);
  }
  assert.equal(gameAgentSchemas.game_create.safeParse({ document: { ...input, brief: { ...input.brief, players: { min: 2, max: 1 } } } }).success, false);
  const invalid = gameAgentSchemas.game_create.safeParse({ document: { ...input, design: { ...design, progression: { ...design.progression, stages: [{ id: "unknown", objective: "Reach target", challenge: "Route", mechanicIds: ["missing"], completion: "Target lit" }] } } } });
  assert.equal(invalid.success, false);if (!invalid.success) assert.ok(invalid.error.issues.some(issue => issue.path.includes("mechanicIds")), "cross-reference refinements preserved");
  const listed = GAME_AGENT_TOOLS.find(tool => tool.name === "game_projects")!.schema as { required?: string[] };
  assert.ok(!listed.required?.includes("cursor"), "defaulted input cursor must not become required output");
  const created = GAME_AGENT_TOOLS.find(tool => tool.name === "game_create")!.schema as { properties: { document: { required?: string[]; properties: Record<string, unknown> } } };
  assert.ok(!created.properties.document.required?.includes("schemaVersion"));assert.ok(created.properties.document.required?.includes("title"));
});

test("opening a draft defaults only absent initial metadata and preserves canonical validation", () => {
  const full = fixtureGameDocument(), basic = { title: full.title, brief: full.brief, engine: full.engine };
  const expected = { ...full, design: null, files: [], assets: [] };
  assert.deepEqual(gameAgentSchemas.game_create.parse({ document: basic }).document, expected);
  assert.equal(gameDocument.safeParse(basic).success, false, "public API/archive input still requires the complete serialized shape");
  for (const [field, value] of [["design", "{}"], ["files", "[]"], ["assets", null], ["title", 123], ["brief", "Arcade brief"]] as const)
    assert.equal(gameAgentSchemas.game_create.safeParse({ document: { ...basic, [field]: value } }).success, false, `invalid supplied ${field} cannot become a default`);
  const invalidAsset = { id: "missing-file", kind: "image", role: "Asset", files: ["assets/missing.png"],
    origin: { kind: "procedural", source: "Fixture", author: "Fixture", license: "CC0", referenceIds: [] }, placeholder: false };
  const parsed = gameAgentSchemas.game_create.safeParse({ document: { ...basic, assets: [invalidAsset] } });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.ok(parsed.error.issues.some(issue => issue.path.join(".") === "document.assets.0.files"), "the final canonical pipeline must retain cross-reference refinements");
});

test("Standard/Deep persist empty drafts once without advancing design or certifying quality", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const full = fixtureGameDocument(), basic = { title: full.title, brief: full.brief, engine: full.engine };
    const model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_create", args: { document: basic }, id: "draft-create" }], []] });
    const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model } }));
    try {
      const request = { ...spec, runtime }, run = await start(f.service, f.session.id, `draft-${runtime}`, request);
      assert.equal((await done(f.service, run)).state, "completed");
      assert.equal((await start(f.service, f.session.id, `draft-${runtime}`, request)).id, run.id);
      const project = await f.service.dispatch(reg, "games.projects.linked", { sessionId: f.session.id }, "client") as GameProject;
      const snapshot = await f.service.dispatch(reg, "games.projects.snapshot", { id: project.id }, "client") as { id: string };
      const document = (new Transfers(f.store).json(reg, snapshot.id) as { revision: { document: unknown } }).revision.document;
      assert.deepEqual(gameDocument.parse(document), { ...full, design: null, files: [], assets: [] });
      const transfer = await f.service.dispatch(reg, "games.workflows.get", { projectId: project.id }, "client") as { id: string };
      const workflow = new Transfers(f.store).json(reg, transfer.id) as GameWorkflowSnapshot;
      assert.equal(workflow.workflow!.stage, "design");assert.equal(workflow.canAdvance, false);assert.equal(workflow.qualityReady, false);
      assert.ok(workflow.gates.find(gate => gate.stage === "design")!.blockers.includes("design-missing"));
      await assert.rejects(f.service.dispatch(reg, "games.workflows.advance", { requestId: "not-designed", projectId: project.id,
        expectedVersion: workflow.workflow!.version, expectedRevision: project.revision }, "client"),
        error => error instanceof AgentError && error.code === errors.conflict && /independent evidence/.test(error.message));
      assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM game_projects").get() as { n: number }).n, 1);
      assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM operation_identities WHERE tool='game_create'").get() as { n: number }).n, 1);
    } finally { await f.close(); }
  }
});

test("official Standard/Deep tool handlers persist full v2 documents when internal versions are omitted", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const full = fixtureGameDocument();const { schemaVersion: _root, design: completeDesign, ...rest } = full;const { schemaVersion: _nested, ...design } = completeDesign!;
    const model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_create", args: { document: { ...rest, design } }, id: "version-defaults" }], []] });
    const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model } }));
    try {
      const run = await start(f.service, f.session.id, `defaults-${runtime}`, { ...spec, runtime });assert.equal((await done(f.service, run)).state, "completed");
      const project = await f.service.dispatch(reg, "games.projects.linked", { sessionId: f.session.id }, "client") as GameProject;
      const transfer = await f.service.dispatch(reg, "games.projects.snapshot", { id: project.id }, "client") as { id: string; size: number };
      const chunk = await f.service.dispatch(reg, "transfers.read", { id: transfer.id, offset: 0 }, "client") as { data: string; nextOffset: number };
      assert.equal(chunk.nextOffset, transfer.size, "small fixture transfers completely");
      const snapshot = JSON.parse(Buffer.from(chunk.data, "base64").toString("utf8"));
      assert.deepEqual(gameDocument.parse(snapshot.revision.document), full);
      assert.equal(f.store.events(reg, f.session.id, 0).filter(event => event.type === "game.tool_rejected").length, 0);
    } finally { await f.close(); }
  }
});

test("Standard and Deep reject malformed game objects compactly before dispatch, then persist only the corrected request", async () => {
  const marker = "RAW_SUBMITTED_ARGUMENT_MUST_NOT_BE_ECHOED";
  for (const runtime of ["standard", "deep"] as const) for (const invalid of [
    { document: marker.repeat(1000) },
    { document: { ...fixtureGameDocument(), design: { ...fixtureGameDocument().design!, camera: { value: marker } } } },
  ]) {
    const model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_create", args: invalid, id: "invalid" }], [{ name: "game_create", args: { document: fixtureGameDocument() }, id: "corrected" }], []] });
    const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model } }));
    try {
      const run = await start(f.service, f.session.id, `invalid-${runtime}`, { ...spec, runtime });
      const finished = await done(f.service, run);assert.equal(finished.state, "completed", finished.error);
      const rejected = f.store.events(reg, f.session.id, 0).filter(event => event.type === "game.tool_rejected");
      assert.equal(rejected.length, 1);const diagnostic = rejected[0]!.data as { callId: string; rejectedBeforeDispatch: boolean; error: { issues: { path: string[]; expected?: string; hint?: string }[] } };
      assert.match(diagnostic.callId, /^[a-f0-9]{64}$/);assert.equal(diagnostic.rejectedBeforeDispatch, true);
      assert.equal(diagnostic.error.issues[0]!.expected, typeof invalid.document === "string" ? "object" : "string");
      assert.match(diagnostic.error.issues[0]!.hint ?? "", typeof invalid.document === "string" ? /Nested project object/ : /Plain text/);
      assert.doesNotMatch(JSON.stringify(rejected), new RegExp(marker));assert.ok(Buffer.byteLength(JSON.stringify(rejected)) < 6000);
      assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM game_projects").get() as { n: number }).n, 1);
      assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM operation_identities WHERE tool='game_create'").get() as { n: number }).n, 1, "rejection is not an admitted effect/receipt");
      assert.ok(f.store.events(reg, f.session.id, 0).some(event => event.type === "workspace.activity" && JSON.stringify(event.data).includes("Argumentos rejeitados")));
    } finally { await f.close(); }
  }
});

test("the official graph gives the model bounded field/type feedback without echoing submitted arguments", async () => {
  const marker = "DO_NOT_ECHO_ARGUMENT_CONTENT";
  const model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_create", args: { document: marker.repeat(2000) }, id: "rejected" }], []] });
  let dispatched = 0;
  const profile = gameProductionProfile({ catalog: GAME_AGENT_TOOLS, invoke: async () => { dispatched++;return {}; }, evidence: () => ({ changes: [], projects: [] }) },
    { mode: "execute", signal: new AbortController().signal, modelForRole: () => model, readTools: [] })!;
  const graph = createAgent({ model, tools: profile.tools, middleware: profile.middleware });
  const state = await graph.invoke({ messages: [{ role: "user", content: "Create the requested game" }] });
  const toolMessage = state.messages.find(message => message.getType() === "tool");assert.ok(toolMessage);
  const content = String(toolMessage.content);assert.ok(Buffer.byteLength(content) < 6000);assert.doesNotMatch(content, new RegExp(marker));
  const response = JSON.parse(content);assert.equal(response.rejectedBeforeDispatch, true);assert.equal(response.error.kind, "invalid_game_arguments");
  assert.deepEqual(response.error.issues[0].path, ["document"]);assert.equal(response.error.issues[0].expected, "object");assert.equal(dispatched, 0);
});

test("game argument feedback never converts an unknown dispatched effect into a retryable validation error", async () => {
  let attempts = 0;
  const model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_build", args: { projectId: "game", revision: 1 }, id: "unknown-build" }], []] });
  const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model },
    gameProduction: { ...context.gameProduction!, invoke: async () => { attempts++;throw new AgentError(errors.reconciliation, "Original effect requires inspection"); } } }));
  try {
    const run = await start(f.service, f.session.id, "unknown-game-effect");
    const finished = await done(f.service, run);assert.equal(finished.state, "awaiting_reconciliation");assert.equal(attempts, 1);
    assert.equal(f.store.events(reg, f.session.id, 0).filter(event => event.type === "game.tool_rejected").length, 0);
  } finally { await f.close(); }
});

test("real official Standard and Deep graphs create/link one game without host callbacks or an interface-owned loop", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_studio", args: {}, id: "studio" }], [{ name: "game_create", args: { document: fixtureGameDocument() }, id: "create" }], []] });
    const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model } }));
    try {
      const run = await start(f.service, f.session.id, `graph-${runtime}`, { ...spec, runtime });
      const finished = await done(f.service, run);
      assert.equal(finished.state, "completed", finished.error);
      const linked = await f.service.dispatch(reg, "games.projects.linked", { sessionId: f.session.id }, "client") as GameProject;
      assert.equal(linked.title, fixtureGameDocument().title);
      assert.deepEqual(await f.service.dispatch(reg, "host.poll", {}, "client"), []);
      assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM game_projects").get() as { n: number }).n, 1);
      assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM receipts WHERE run=? AND status='completed'").get(run.id) as { n: number }).n, 2);
    } finally { await f.close(); }
  }
});

test("game edits survive another turn/service restart, keep exact revisions and reject stale writes without unknown-effect state", async () => {
  let saved: GameProject | undefined;
  const execute: GraphExecutor = async (_request, context) => {
    const port = context.gameProduction!;
    const studio = await port.invoke("game_studio", {}, "studio") as { project: GameProject | null };
    if (!studio.project) saved = await port.invoke("game_create", { document: fixtureGameDocument() }, "create") as GameProject;
    else {
      assert.equal(studio.project.id, saved!.id);
      const changed = await port.invoke("game_write_file", { projectId: saved!.id, expectedRevision: 1, path: "src/main.ts", content: "export const value=42;", mime: "text/javascript" }, "write") as GameProject;
      assert.equal(changed.revision, 2);
      const replay = await port.invoke("game_write_file", { projectId: saved!.id, expectedRevision: 1, path: "src/main.ts", content: "export const value=42;", mime: "text/javascript" }, "write");
      assert.deepEqual(replay, changed);
      const stale = await port.invoke("game_write_file", { projectId: saved!.id, expectedRevision: 1, path: "src/main.ts", content: "incorrect", mime: "text/javascript" }, "stale") as { ok: boolean };
      assert.equal(stale.ok, false);
      const evidence = port.evidence();
      assert.deepEqual(evidence.changes[0]!.filesChanged, ["src/main.ts"]);
      assert.equal(evidence.projects[0]!.ready, false);
    }
    return { text: "Project change saved; game acceptance pending" };
  };
  const f = await fixture(execute); let reopened: AgentService | undefined;
  try {
    assert.equal((await done(f.service, await start(f.service, f.session.id, "first"))).state, "completed");
    await f.service.close();
    reopened = new AgentService(new Store(path.join(f.directory, "state.sqlite")), f.directory, execute);
    assert.equal((await done(reopened, await start(reopened, f.session.id, "second"))).state, "completed");
    const revision = await reopened.dispatch(reg, "games.projects.get", { id: saved!.id }, "client") as GameProject;
    assert.equal(revision.revision, 2);
  } finally { await reopened?.close(); await f.close(); }
});

test("official Standard and Deep graphs apply the installed directed-edit tool without host authority", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    let model: BaseChatModel;
    const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model } }));
    try {
      const bytes = Buffer.from("export const speed = 2;\r\n"),sha256 = createHash("sha256").update(bytes).digest("hex"),transfers = new Transfers(f.store);
      const transfer = transfers.begin(reg, { key: `seed-${runtime}`, size: bytes.length, sha256, mime: "text/plain" });
      transfers.append(reg, transfer.id, 0, bytes);transfers.commit(reg, transfer.id);
      const project = await f.service.dispatch(reg, "games.projects.create", { requestId: `seed-${runtime}`, document: { ...fixtureGameDocument(), files: [{ path: "src/main.js", mime: "text/plain", size: bytes.length, sha256, transferId: transfer.id }] } }, "client") as GameProject;
      await f.service.dispatch(reg, "games.projects.select", { sessionId: f.session.id, projectId: project.id }, "client");
      model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_edit_file", args: { projectId: project.id, expectedRevision: 1, path: "src/main.js", baseSha256: sha256, edits: [{ before: "speed = 2", after: "speed = 3" }] }, id: "edit-game" }], []] });
      const run = await start(f.service, f.session.id, `edit-${runtime}`, { ...spec, runtime }),result = await done(f.service, run);
      assert.equal(result.state, "completed", result.error);
      const snapshot = await f.service.dispatch(reg, "games.projects.snapshot", { id: project.id }, "client") as { id: string };
      const saved = transfers.json(reg, snapshot.id) as { revision: { revision: number; document: { files: { sha256: string }[] } } };
      assert.equal(saved.revision.revision, 2);assert.equal(saved.revision.document.files[0]!.sha256, createHash("sha256").update("export const speed = 3;\r\n").digest("hex"));
      assert.deepEqual(await f.service.dispatch(reg, "host.poll", {}, "client"), []);
      assert.equal(f.store.events(reg, f.session.id, 0).filter(event => event.type === "game.activity" && (event.data as { tool: string }).tool === "game_edit_file").length, 1);
    } finally { await f.close(); }
  }
});

test("literal game edits commit atomically with exact hash/revision, preserve bytes and replay after later changes and restart", async () => {
  const source = "\ufeffconst label='Maré 🛶';\r\nconst speed=2;\r\n";
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  let saved: GameProject | undefined;
  const f = await fixture(async (_request, context) => {
    const port = context.gameProduction!;
    saved = await port.invoke("game_create", { document: fixtureGameDocument() }, "create") as GameProject;
    saved = await port.invoke("game_write_file", { projectId: saved.id, expectedRevision: 1, path: "src/main.ts", content: source, mime: "text/javascript" }, "seed") as GameProject;
    saved = await port.invoke("game_write_file", { projectId: saved.id, expectedRevision: 2, path: "data/settings.json", content: '{"keep":true}', mime: "application/json" }, "other") as GameProject;
    const edit = { projectId: saved.id, expectedRevision: 3, path: "src/main.ts", baseSha256: hash(source), edits: [{ before: "speed=2", after: "speed=4" }, { before: "Maré 🛶", after: "Aurora 🌄" }] };
    const edited = await port.invoke("game_edit_file", edit, "edit") as GameProject;
    assert.equal(edited.revision, 4);
    const read = await port.invoke("game_read_file", { projectId: saved.id, path: "src/main.ts" }, "read") as { file: { sha256: string; mime: string }; content: string };
    assert.equal(read.file.sha256, hash(source.replace("speed=2", "speed=4").replace("Maré 🛶", "Aurora 🌄")), "BOM and CRLF remain in the actual bytes");
    assert.equal(read.file.mime, "text/javascript");assert.ok(read.content.includes("Aurora 🌄"));
    saved = await port.invoke("game_write_file", { projectId: saved.id, expectedRevision: 4, path: "data/settings.json", content: '{"keep":false}', mime: "application/json" }, "later") as GameProject;
    const binary = Buffer.from([255, 254, 0]);
    saved = await port.invoke("game_write_file", { projectId: saved.id, expectedRevision: 5, path: "data/binary.bin", content: binary.toString("base64"), mime: "application/octet-stream", encoding: "base64" }, "seed-binary") as GameProject;
    assert.deepEqual(await port.invoke("game_edit_file", edit, "edit"), edited, "replay returns the historical receipt without applying again");
    await assert.rejects(port.invoke("game_edit_file", { ...edit, edits: [{ before: "speed=2", after: "speed=9" }] }, "edit"), error => error instanceof AgentError && error.code === errors.conflict);
    const reject = async (key: string, input: unknown) => {
      const before = f.store.db.prepare("SELECT count(*) AS n FROM game_revisions").get() as { n: number };
      const result = await port.invoke("game_edit_file", input, key) as { ok: boolean; error: { message: string } };
      assert.equal(result.ok, false);assert.doesNotMatch(result.error.message, /PRIVATE_MISSING/);
      assert.deepEqual(f.store.db.prepare("SELECT count(*) AS n FROM game_revisions").get(), before);
    };
    await reject("stale", edit);
    await reject("wrong-hash", { ...edit, expectedRevision: 6 });
    await reject("partial", { ...edit, expectedRevision: 6, baseSha256: read.file.sha256, edits: [{ before: "speed=4", after: "speed=8" }, { before: "PRIVATE_MISSING", after: "bad" }] });
    await reject("binary", { ...edit, expectedRevision: 6, baseSha256: createHash("sha256").update(binary).digest("hex"), path: "data/binary.bin" });
    await reject("missing-file", { ...edit, expectedRevision: 6, path: "data/missing.ts" });
    const after = await port.invoke("game_read_file", { projectId: saved.id, path: "src/main.ts" }, "after") as typeof read;
    assert.equal(after.file.sha256, read.file.sha256);
    const other = await port.invoke("game_read_file", { projectId: saved.id, path: "data/settings.json" }, "other-after") as typeof read;
    assert.equal(other.content, '{"keep":false}');
    const evidence = port.evidence();
    assert.equal(evidence.changes.filter(change => change.revision === 4).length, 1);
    assert.deepEqual(evidence.changes.find(change => change.revision === 4)!.filesChanged, ["src/main.ts"]);
    assert.equal(evidence.projects[0]!.ready, false);
    return { text: "Directed edits saved; acceptance still pending" };
  });
  let reopened: AgentService | undefined;
  try {
    const run = await start(f.service, f.session.id, "edit-run");const result = await done(f.service, run);assert.equal(result.state, "completed", result.error);
    assert.equal(saved!.revision, 6);
    await f.service.close();reopened = new AgentService(new Store(path.join(f.directory, "state.sqlite")), f.directory, async () => assert.fail("Completed run must not execute again"));
    const replay = await start(reopened, f.session.id, "edit-run");assert.equal(replay.id, run.id);assert.equal(replay.state, "completed");
    const project = await reopened.dispatch(reg, "games.projects.get", { id: saved!.id }, "client") as GameProject;assert.equal(project.revision, 6);
  } finally { await reopened?.close();await f.close(); }
});

test("pinned UTF-8 source pages expose large files without losing bytes or mixing revisions",async()=>{
  const source='\ufeff'+('Maré 🛶 e ação\r\n'.repeat(18000)),hash=createHash('sha256').update(source).digest('hex');
  const f=await fixture(async(_request,context)=>{
    const port=context.gameProduction!;
    let project=await port.invoke('game_create',{document:fixtureGameDocument()},'create') as GameProject;
    project=await port.invoke('game_write_file',{projectId:project.id,expectedRevision:1,path:'src/large.ts',content:source,mime:'text/javascript'},'seed') as GameProject;
    const old=await port.invoke('game_read_file',{projectId:project.id,path:'src/large.ts'},'legacy') as {error:string};
    assert.equal(old.error,'file-requires-sdk-download');
    const request={projectId:project.id,path:'src/large.ts',textPage:{revision:2,sha256:hash,cursor:0,limit:257}};
    type Page={file:{sha256:string};revision:number;sourceHash:string;content:string;encoding:string;offset:number;cursor:number;hasMore:boolean;totalBytes:number};
    const first=await port.invoke('game_read_file',request,'page-0') as Page;
    assert.equal(first.file.sha256,hash);assert.equal(first.revision,2);assert.equal(first.sourceHash,project.contentHash);
    assert.equal(first.encoding,'utf-8');assert.equal(first.offset,0);assert.ok(Buffer.byteLength(first.content)<=257);
    const later=await port.invoke('game_write_file',{projectId:project.id,expectedRevision:2,path:'src/large.ts',content:'Changed source',mime:'text/javascript'},'replace') as GameProject;
    let cursor=first.cursor,text=first.content,pages=1;
    while(first.totalBytes>cursor){
      const page=await port.invoke('game_read_file',{...request,textPage:{...request.textPage,cursor,limit:16384}},'page-'+pages++) as Page;
      assert.equal(page.offset,cursor);assert.equal(page.revision,2);assert.equal(page.sourceHash,project.contentHash);assert.equal(page.file.sha256,hash);
      assert.ok(page.cursor>cursor);assert.equal(page.hasMore,page.cursor<page.totalBytes);assert.ok(Buffer.byteLength(page.content)<=16384);
      text+=page.content;cursor=page.cursor;
    }
    assert.equal(text,source,'BOM, CRLF and multibyte content reconstruct the exact original');
    assert.equal(createHash('sha256').update(text).digest('hex'),hash);
    const bad=await port.invoke('game_read_file',{...request,textPage:{...request.textPage,revision:later.revision}},'stale-hash') as {ok:boolean;error:{message:string}};
    assert.equal(bad.ok,false);assert.match(bad.error.message,/hash/i);assert.doesNotMatch(bad.error.message,/Maré|Changed source/);
    assert.equal((await port.invoke('game_project',{projectId:project.id},'unchanged') as {project:GameProject}).project.revision,3);
    return {text:'Read-only pinned pages verified; no quality approval'};
  });
  try{const result=await done(f.service,await start(f.service,f.session.id,'paged'));assert.equal(result.state,'completed',result.error);}
  finally{await f.close();}
});

test('Mac/editor Standard/Deep graphs read pinned pages in plan mode and reject another profile without host callbacks',async()=>{
  for(const product of ['companion-mac','companion-vscode'] as const)for(const runtime of ['standard','deep'] as const){
    const registration={...reg,product},directory=await mkdtemp(path.join(tmpdir(),'source-graph-')),store=new Store(path.join(directory,'metadata.sqlite'));
    const steps=[{name:'game_read_file',args:{projectId:'pending',path:'src/main.ts',textPage:{revision:1,sha256:'0'.repeat(64),cursor:0,limit:257}},id:'page'}];
    let model=new FakeToolCallingModel({toolCalls:[steps,[]]});
    const service=new AgentService(store,directory,(request,context)=>executeGraph(request,{...context,models:{executor:model,planner:model,evaluator:model}}));
    try{
      const bytes=Buffer.from('\ufeff'+'🛶 cenário\r\n'.repeat(1000)),sha256=createHash('sha256').update(bytes).digest('hex'),transfers=new Transfers(store);
      const transfer=transfers.begin(registration,{key:'source',size:bytes.length,sha256,mime:'application/octet-stream'});transfers.append(registration,transfer.id,0,bytes);transfers.commit(registration,transfer.id);
      const document={...fixtureGameDocument(),files:[{path:'src/main.ts',sha256,size:bytes.length,mime:'text/javascript',transferId:transfer.id}]};
      const project=await service.dispatch(registration,'games.projects.create',{requestId:'seed',document},'client') as GameProject;
      steps[0]!.args.projectId=project.id;steps[0]!.args.textPage.sha256=sha256;
      const startRead=async(identity:Registration,key:string)=>{
        const session=store.createSession(identity,'Source read'),run=await service.dispatch(identity,'runs.start',{sessionId:session.id,key,spec:{...spec,runtime,mode:'plan'}},'client') as Run;
        for(let i=0;i<400;i++){const current=store.run(identity,run.id);if(['completed','failed'].includes(current.state)){assert.equal(current.state,'completed',current.error);return {session,run};}await tick();}
        throw Error('Inspect original source graph; no restart on observer timeout');
      };
      const {run}=await startRead(registration,'page');
      const row=store.db.prepare("SELECT value FROM receipts WHERE run=? AND status='completed'").get(run.id) as {value:string};
      const page=JSON.parse(row.value) as {kind:string;file:{sha256:string};content:string;cursor:number;hasMore:boolean};
      assert.equal(page.kind,'text-source-page');assert.equal(page.file.sha256,sha256);assert.ok(page.hasMore);assert.ok(page.content.startsWith('\ufeff🛶'));
      assert.equal(page.content,bytes.subarray(0,page.cursor).toString('utf8'));assert.deepEqual(await service.dispatch(registration,'host.poll',{},'client'),[]);
      assert.equal((await service.dispatch(registration,'engine.info',{},'client') as {capabilities:string[]}).capabilities.includes('game-source-text-pages-v1'),true);
      // An independently authenticated namespace cannot use the original file's
      // known project/revision/hash as authority to read it.
      const other={...registration,profile:'other'};
      model=new FakeToolCallingModel({toolCalls:[steps,[]]});
      const session=store.createSession(other,'Other namespace'),denied=await service.dispatch(other,'runs.start',{sessionId:session.id,key:'foreign',spec:{...spec,runtime,mode:'plan'}},'client') as Run;
      for(let i=0;i<400&&!['completed','failed'].includes(store.run(other,denied.id).state);i++)await tick();
      assert.equal(store.run(other,denied.id).state,'completed');
      const rejected=JSON.parse((store.db.prepare("SELECT value FROM receipts WHERE run=? AND status='completed'").get(denied.id) as {value:string}).value);
      assert.equal(rejected.ok,false);assert.doesNotMatch(JSON.stringify(rejected),/cenário|text-source-page/);
      assert.equal((await service.dispatch(registration,'games.projects.get',{id:project.id},'client') as GameProject).revision,1);
    }finally{await service.close();await rm(directory,{recursive:true,force:true});}
  }
});

test("review approval survives interface disconnection and a denied design change never creates a project", async () => {
  const f = await fixture(async (_spec, context) => ({ text: JSON.stringify(await context.gameProduction!.invoke("game_create", { document: fixtureGameDocument() }, "create")) }));
  try {
    const run = await start(f.service, f.session.id, "review", { ...spec, mode: "review" });
    let pending: { id: string; kind: string }[] = [];
    for (let i = 0; i < 100 && !pending.length; i++) { pending = await f.service.dispatch(reg, "host.poll", {}, "client") as typeof pending; await tick(); }
    assert.equal(pending[0]!.kind, "approval");
    f.service.disconnect("client");
    assert.equal(f.store.run(reg, run.id).state, "awaiting_approval");
    const recovered = await f.service.dispatch(reg, "host.poll", {}, "reopened") as typeof pending;
    assert.equal(recovered[0]!.id, pending[0]!.id);
    await f.service.dispatch(reg, "approvals.respond", { id: recovered[0]!.id, value: false }, "reopened");
    assert.equal((await done(f.service, run)).state, "completed");
    assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM game_projects").get() as { n: number }).n, 0);
  } finally { await f.close(); }
});

test("plan and KidOS cannot use the service's workspace game mutations or forged service catalogs", async () => {
  const f = await fixture(async (_spec, context) => {
    await assert.rejects(context.gameProduction!.invoke("game_create", { document: fixtureGameDocument() }, "forbidden"), /Plan mode/);
    await assert.rejects(context.gameProduction!.invoke("game_edit_file", { projectId: "forged", expectedRevision: 1, path: "src/main.js", baseSha256: "a".repeat(64), edits: [{ before: "a", after: "b" }] }, "forbidden-edit"), /Plan mode/);
    return { text: "Plan only" };
  });
  try {
    assert.equal((await done(f.service, await start(f.service, f.session.id, "plan", { ...spec, mode: "plan" }))).state, "completed");
    const forged = GAME_AGENT_TOOLS.find((tool) => tool.name === "game_create")!;
    const client = { ...reg, hostTools: [forged.name], toolCatalog: [forged] };
    await assert.rejects(f.service.dispatch(client, "runs.start", { sessionId: f.session.id, key: "forge", spec: { ...spec, tools: [forged] } }, "client"), /installed service catalog/);
    const child = { ...reg, id: "child", product: "kidos" as const, profile: "isaac", providers: ["kidos-gateway" as const] };
    await assert.rejects(f.service.dispatch(child, "games.projects.linked", { sessionId: f.session.id }, "client"), /not found/);
    let childContext: ExecutionContext | undefined;
    const isolated = new AgentService(new Store(":memory:"), f.directory, async (_spec, context) => { childContext = context; return { text: "Core only" }; });
    try {
      const session = isolated.store.createSession(child, "Child");
      await isolated.dispatch(child, "runs.start", { sessionId: session.id, key: "child", spec: { ...spec, provider: { ...spec.provider, kind: "kidos-gateway", endpoint: "http://127.0.0.1:8788" } } }, "child");
      for (let i = 0; i < 100 && !childContext; i++) await tick();
      assert.equal(childContext?.gameProduction, undefined);
    } finally { await isolated.close(); }
  } finally { await f.close(); }
});

test("game completion gate cannot accept a build or model verdict as final game quality", async () => {
  const evidence: GameCompletionEvidence = { changes: [{ projectId: "game", revision: 2, beforeHash: "a", sourceHash: "b", filesChanged: ["src/main.ts"] }], projects: [{ projectId: "game", revision: 2, ready: false, blockers: ["human-playtest-targets-unverified"] }] };
  for (const outcome of ["game_project_change", "game_delivery"] as const) {
    let calls = 0;
    const evaluator = { invoke: async () => ({ text: JSON.stringify(calls++ === 0 ? { outcome, objective: "Intended game result", acceptanceCriteria: ["Verified result"] }
      : { verdict: "satisfied", reason: "Model claims it is ready" }) }) } as unknown as BaseChatModel;
    const gate = createTaskCompletionMiddleware({ model: evaluator, mode: "execute", signal: new AbortController().signal, conversation: [{ role: "user", content: "Game result" }], gameEvidence: () => evidence, onRetry: async () => {} });
    const graph = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [gate] });
    const state = await graph.invoke({ messages: [{ role: "user", content: "Game result" }] });
    assert.equal(completionGateResult(state).completionOutcome, outcome === "game_project_change" ? "complete" : "incomplete");
  }
});

test("a real Deep Agent specialist is delegated through the official task tool and cannot write even through inherited filesystem tools", async () => {
  const executor = new FakeToolCallingModel({ toolCalls: [[{ name: "task", args: { subagent_type: "game-design-director", description: "Inspect the saved game only. Attempted writes must not escape the read-only specialist." }, id: "delegate" }], []] });
  const specialistSystems: string[] = [];
  const planner = new FakeToolCallingModel({ toolCalls: [[{ name: "game_studio", args: {}, id: "read" }], [{ name: "write_file", args: { file_path: "/forbidden.txt", content: "must not be written" }, id: "attempt-write" }], []] });
  // The official fake drops instance callbacks when binding tools. Observe its
  // bound instance instead, without changing the real graph or agent behavior.
  const bindPlanner = planner.bindTools.bind(planner);
  planner.bindTools = tools => {
    const bound = bindPlanner(tools);
    assert.ok(bound instanceof FakeToolCallingModel, "the official test double must return its bound model");
    bound.callbacks = [{ handleChatModelStart: (_llm, messages) => { specialistSystems.push(messages.flat().filter(message => message.getType() === "system").map(message => message.text).join("\n")); } }];
    return bound;
  };
  const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor, planner, evaluator: executor } }));
  try {
    const run = await start(f.service, f.session.id, "delegate", { ...spec, runtime: "deep" });
    const finished = await done(f.service, run);
    assert.equal(finished.state, "completed", finished.error);
    assert.match(JSON.stringify(finished.result), /denied|permission|not permitted/i);
    assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM game_projects").get() as { n: number }).n, 0);
    assert.ok((f.store.db.prepare("SELECT count(*) AS n FROM operation_identities WHERE tool='game_studio'").get() as { n: number }).n >= 1);
    assert.deepEqual(await f.service.dispatch(reg, "host.poll", {}, "client"), []);
    assert.ok(specialistSystems.length > 0);
    for (const system of specialistSystems) assert.equal(system.split(gameProductionModule.guide).length - 1, 1, "specialist already has its static guide; root guidance must not duplicate it");
  } finally { await f.close(); }
});

test("shared-agent tools persist modular files and queue a real offline web build after exact approval", async () => {
  const { createWebGameAdapters } = await import("../packages/adapter-game-web/src/index");
  const { webFixture } = await import("./game-web-fixtures");
  const source = [...webFixture("phaser")];
  const steps = [
    [{ name: "game_create", args: { document: fixtureGameDocument() }, id: "create" }],
    ...source.map(([name, content], i) => [{ name: "game_write_file", args: { projectId: "pending", expectedRevision: i + 1, path: name, content, mime: "text/plain", encoding: "utf-8" }, id: `file-${i}` }]),
    [{ name: "game_build", args: { projectId: "pending", revision: source.length + 1 }, id: "build" }], [],
  ];
  const model = new FakeToolCallingModel({ toolCalls: steps });
  let buildId: string | undefined, projectId: string | undefined;
  const directory = await mkdtemp(path.join(tmpdir(), "agent-web-build-")), store = new Store(path.join(directory, "state.sqlite"));
  const service = new AgentService(store, directory, (request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator: model },
    gameProduction: { ...context.gameProduction!, invoke: async (name, input, callId) => {
      const value = await context.gameProduction!.invoke(name, input, callId) as { id?: string };
      if (name === "game_create") { projectId = value.id; for (const step of steps) for (const call of step) if ("projectId" in call.args) call.args.projectId = projectId!; }
      if (name === "game_build") buildId = value.id;
      return value;
    } } }), {}, { gameAdapters: createWebGameAdapters(path.resolve("packages/adapter-game-web/runtimes")) });
  try {
    const session = store.createSession(reg, "Real build");
    const run = await start(service, session.id, "web-build");
    let approvals = 0;
    for (let i = 0; i < 400; i++) {
      const requests = await service.dispatch(reg, "host.poll", {}, "client") as { id: string; kind: string; payload: { tool: string } }[];
      for (const request of requests) {
        assert.equal(request.kind, "approval"); assert.equal(request.payload.tool, "game_build"); approvals++;
        await service.dispatch(reg, "approvals.respond", { id: request.id, value: true }, "client");
        service.disconnect("client");
      }
      const current = store.run(reg, run.id);
      if (["completed", "failed", "awaiting_reconciliation"].includes(current.state)) break;
      await tick();
    }
    assert.equal(store.run(reg, run.id).state, "completed", store.run(reg, run.id).error);
    assert.equal(approvals, 1);
    assert.ok(buildId); assert.ok(projectId);
    let job: { state: string; error?: string } | undefined;
    for (let i = 0; i < 400; i++) {
      job = await service.dispatch(reg, "games.production.get", { id: buildId }, "client") as typeof job;
      if (job!.state !== "running" && job!.state !== "queued") break;
      await tick();
    }
    assert.equal(job!.state, "completed", job!.error);
    assert.equal((await service.dispatch(reg, "games.projects.get", { id: projectId }, "client") as GameProject).revision, source.length + 1);
    const receiptCount = (store.db.prepare("SELECT count(*) AS n FROM receipts WHERE run=? AND status='completed'").get(run.id) as { n: number }).n;
    assert.equal(receiptCount, source.length + 2, "every effect has exactly one durable graph operation receipt");
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});

test("the editor's real workspace completion gate accepts a saved game revision without fabricating a host filesystem diff", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const model = new FakeToolCallingModel({ toolCalls: [[{ name: "game_create", args: { document: fixtureGameDocument() }, id: "create" }], []] });
    let checks = 0;
    const evaluator = Object.assign(new FakeToolCallingModel(), { withStructuredOutput: () => ({ invoke: async (messages: {content: unknown}[]) => {
      if (checks++ === 0) {
        const context = messages.map(message => String(message.content)).join("\n");
        assert.match(context, /availableToolNames/);
        assert.match(context, /game_studio/);
        assert.match(context, /game_build/);
        assert.match(context, /execution blockers/);
        return { outcome: "game_project_change", objective: "Persist the game design", reason: "A bounded design change", requiredEvidence: "none", acceptanceCriteria: ["A new design revision is saved"] };
      }
      return { verdict: "satisfied", reason: "A real saved game project revision exists" };
    } }) });
    const f = await fixture((request, context) => executeGraph(request, { ...context, models: { executor: model, planner: model, evaluator } }));
    try {
      const run = await start(f.service, f.session.id, `workspace-game-${runtime}`, { ...spec, runtime, workspace: {
        threadId: "editor-game", assistantMessageId: "assistant", responseLanguage: "pt-BR", finalReview: "off", memoryText: "", maxConversationCharacters: 48000,
      } });
      const finished = await done(f.service, run);
      assert.equal(finished.state, "completed", finished.error);
      const result = finished.result as { completionOutcome: string; changes: unknown[]; gameProduction: GameCompletionEvidence };
      assert.equal(result.completionOutcome, "complete");
      assert.deepEqual(result.changes, []);
      assert.equal(result.gameProduction.changes.length, 1);
      assert.equal(result.gameProduction.projects[0]!.ready, false);
    } finally { await f.close(); }
  }
});

test("linking an existing game is isolated and cannot replace the target during an active conversation run", async () => {
  let continueRun!: () => void;
  const wait = new Promise<void>((resolve) => { continueRun = resolve; });
  const f = await fixture(async () => { await wait; return { text: "Stopped waiting" }; });
  try {
    const p = await f.service.dispatch(reg, "games.projects.create", { requestId: "existing", document: fixtureGameDocument() }, "client") as GameProject;
    assert.equal((await f.service.dispatch(reg, "games.projects.select", { sessionId: f.session.id, projectId: p.id }, "client") as GameProject).id, p.id);
    const other = { ...reg, profile: "other" };
    await assert.rejects(f.service.dispatch(other, "games.projects.select", { sessionId: f.session.id, projectId: p.id }, "client"), /not found/);
    const run = await start(f.service, f.session.id, "active");
    await assert.rejects(f.service.dispatch(reg, "games.projects.select", { sessionId: f.session.id, projectId: p.id }, "client"), /active conversation/);
    continueRun(); await done(f.service, run);
  } finally { continueRun(); await f.close(); }
});
