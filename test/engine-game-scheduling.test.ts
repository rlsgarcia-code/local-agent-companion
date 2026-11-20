import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Registration } from "../packages/contracts/src/index";
import type { GameProject } from "../packages/contracts/src/games";
import type { GameProductionBudget, GameProductionJob, GameProductionResources, GameProductionCapabilities } from "../packages/contracts/src/game-production";
import { GameProductionFailure, GameProductionUncertain, type GameProductionAdapter, type GameValidationCollector, type GameAssetProcessor } from "../packages/game-production/src/index";
import { createLocalGameAssetProcessor } from "../packages/adapter-game-assets/src/index";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { fixtureGameDocument } from "./game-fixtures";

const reg: Registration = { id: "schedule-mac", product: "companion-mac", profile: "parent", workspace: "", providers: ["ollama"], hostTools: [] };
const editor: Registration = { ...reg, id: "schedule-editor", product: "companion-vscode", profile: "editor" };
const toolchain = { id: "schedule-fixture", version: "1", sha256: "a".repeat(64) };
const resources: GameProductionResources = { memoryMiB: 4, cpuSlots: 1, exclusiveGroups: [] };
const budget: GameProductionBudget = { memoryMiB: 8, cpuSlots: 4, maxConcurrent: 2, maxQueued: 8 };
const output = () => ({ entrypoint: "index.html", files: [{ path: "index.html", mime: "text/html", data: Buffer.from("<title>Scheduling fixture</title>") }] });
const adapter = (patch: Partial<GameProductionAdapter> = {}): GameProductionAdapter => ({ id: "schedule-build", engine: "phaser", products: ["companion-mac", "companion-vscode"], authority: "workspace", toolchain,
  resources, probe: async () => ({ available: true }), build: async () => output(), ...patch });
const call = <T>(s: AgentService, method: string, args: unknown = {}, r = reg) => s.dispatch(r, method, args, "fixture") as Promise<T>;
type Options = NonNullable<ConstructorParameters<typeof AgentService>[4]>;
async function fixture(options: Options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "game-scheduling-")), file = path.join(directory, "state.sqlite");
  const service = new AgentService(new Store(file), directory, undefined, {}, { gameResourceBudget: budget, gameAdapters: [adapter()], ...options });
  return { directory, file, service, async close() { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
async function project(s: AgentService, id: string, r = reg, engine: GameProductionJob["engine"] = "phaser"): Promise<GameProject> {
  return call(s, "games.projects.create", { requestId: id, document: { ...fixtureGameDocument(), engine } }, r);
}
const start = (s: AgentService, p: GameProject, id: string, r = reg) => call<GameProductionJob>(s, "games.builds.start", { requestId: id, projectId: p.id, revision: 1 }, r);
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 1000; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error("Scheduling fixture did not reach the expected state.");
}
async function state(s: AgentService, job: GameProductionJob, expected: string, r = reg) {
  await until(async () => (await call<GameProductionJob>(s, "games.production.get", { id: job.id }, r)).state === expected);
}
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function abortable(signal: AbortSignal) { return new Promise<never>((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); if (signal.aborted) reject(signal.reason); }); }

test("media reserves external quota before resource waiting and an unknown queued cancellation requires original inspection",async()=>{
  const held=gate(),charged=new Set<string>();let processed=0,cancelled=0,inspected=0;
  const base=createLocalGameAssetProcessor();
  const processor:GameAssetProcessor={...base,resources,admission:{reserve:async({job})=>{charged.add(job.id);},cancel:async()=>{cancelled++;throw new GameProductionUncertain('Original cancellation acknowledgement lost.');}},
    process:async ctx=>{processed++;return base.process(ctx);},reconcile:async()=>{inspected++;return {state:'missing',detail:'Original media reservation fenced.'};}};
  const f=await fixture({gameAdapters:[adapter({build:async()=>{await held.promise;return output();}})],gameAssetProcessors:[processor],gameResourceBudget:{...budget,maxConcurrent:1}});
  try{
    const p=await project(f.service,'build'),q=await project(f.service,'media');
    const build=await start(f.service,p,'running');await state(f.service,build,'running');
    const args={requestId:'assets',projectId:q.id,revision:1,spec:{processorId:processor.id,target:{id:'sound',role:'Tone',placeholder:true},operation:{type:'audio.render',output:'assets/tone.wav',durationMs:100,notes:[{waveform:'sine',frequency:440,startMs:0,durationMs:100,gain:0.1}]}}};
    const asset=await call<GameProductionJob>(f.service,'games.assets.process',args);await state(f.service,asset,'queued');
    assert.ok(charged.has(asset.id));assert.equal(processed,0);
    await call(f.service,'games.production.cancel',{id:asset.id});await state(f.service,asset,'awaiting_reconciliation');
    assert.equal(cancelled,1);assert.equal(charged.size,1);assert.equal(processed,0);
    assert.equal((await call<GameProductionJob>(f.service,'games.assets.process',args)).id,asset.id);
    assert.equal((await call<GameProductionJob>(f.service,'games.production.reconcile',{id:asset.id})).state,'failed');
    assert.equal(inspected,1);assert.equal(processed,0);assert.equal(charged.size,1);
    held.resolve();await state(f.service,build,'completed');
  }finally{held.resolve();await f.close();}
});

test("media with external admission cannot be installed without an original-result inspector",async()=>{
  const base=createLocalGameAssetProcessor(),store=new Store(":memory:");
  try{assert.throws(()=>new AgentService(store,tmpdir(),undefined,{}, {gameAssetProcessors:[{...base,reconcile:undefined,admission:{reserve:async()=>{},cancel:async()=>{}}}]}),/inspection/i);}
  finally{store.close();}
});

test("external quota is reserved durably before resource waiting; queued cancellation keeps its debit without a compiler call", async () => {
  const first=gate(),charged=new Set<string>(),closed=new Set<string>(),built:string[]=[],disposed:string[]=[];
  let f!:Awaited<ReturnType<typeof fixture>>;
  const a=adapter({admission:{reserve:async({job})=>{
    const row=f.service.store.db.prepare('SELECT value FROM game_production_jobs WHERE id=?').get(job.id) as {value:string};
    assert.equal(JSON.parse(row.value).state,'admitting');assert.equal(JSON.parse(row.value).admission,'pending');charged.add(job.id);
  },cancel:async({job})=>{closed.add(job.id);}},build:async({job,signal})=>{
    assert.ok(charged.has(job.id));assert.equal(job.admission,'reserved');built.push(job.id);
    if(built.length===1)await Promise.race([first.promise,abortable(signal)]);return output();
  },reconcile:async()=>({state:'missing',detail:'Fixture original reservation closed.'}),dispose:async({job})=>{disposed.push(job.id);}});
  f=await fixture({gameAdapters:[a],gameResourceBudget:{...budget,maxConcurrent:1}});
  try{
    const p=await project(f.service,'a'),q=await project(f.service,'b',editor);
    const running=await start(f.service,p,'a');await until(()=>built.length===1);
    const waiting=await start(f.service,q,'b',editor);await state(f.service,waiting,'queued',editor);
    assert.ok(charged.has(waiting.id));assert.deepEqual(built,[running.id]);
    await call(f.service,'games.production.cancel',{id:waiting.id},editor);await state(f.service,waiting,'cancelled',editor);
    assert.ok(charged.has(waiting.id)&&closed.has(waiting.id));assert.ok(!disposed.includes(waiting.id));
    assert.equal((await start(f.service,q,'b',editor)).state,'cancelled');assert.equal(charged.size,2);
    const events=await call<{events:{job:GameProductionJob}[]}>(f.service,'games.production.events',{projectId:q.id},editor);
    assert.ok(events.events.some(({job})=>job.state==='admitting'));assert.ok(!events.events.some(({job})=>job.state==='running'));
    first.resolve();await state(f.service,running,'completed');assert.equal(charged.size,2);
  }finally{first.resolve();await f.close();}
});

test("an unknown pre-queue reservation holds resources until original inspection, never retries reserve", async()=>{
  let reserves=0,builds=0,inspections=0;
  const a=adapter({admission:{reserve:async()=>{reserves++;throw new Error('Fixture reserve acknowledgement lost.');},cancel:async()=>{}},
    build:async()=>{builds++;return output();},reconcile:async()=>{inspections++;return {state:'missing',detail:'Original reservation fenced; no repeated admission.'};}});
  const f=await fixture({gameAdapters:[a,adapter({id:'unrelated',engine:'babylon',build:async()=>{builds++;return output();}})],gameResourceBudget:{...budget,maxConcurrent:1}});
  try{
    const p=await project(f.service,'a'),unknown=await start(f.service,p,'a');await state(f.service,unknown,'awaiting_reconciliation');
    const waiting=await start(f.service,await project(f.service,'b',reg,'babylon'),'b');assert.equal(waiting.state,'queued');assert.equal(builds,0);
    assert.equal((await start(f.service,p,'a')).id,unknown.id);assert.equal(reserves,1);
    await call(f.service,'games.production.reconcile',{id:unknown.id});await state(f.service,waiting,'completed');
    assert.equal(reserves,1);assert.equal(inspections,1);assert.equal(builds,1);
  }finally{await f.close();}
});

test("a confirmed admission refusal before reservation is terminal without another authority call",async()=>{
  let reserves=0,cancels=0,builds=0;
  const a=adapter({admission:{reserve:async()=>{reserves++;throw new GameProductionFailure('Fixture project has no authorized allocation.');},
    cancel:async()=>{cancels++;throw new Error('No authority available for an unnecessary second call.');}},
    build:async()=>{builds++;return output();},reconcile:async()=>{throw new Error('No unknown effect to inspect.');}});
  const f=await fixture({gameAdapters:[a]});
  try{
    const p=await project(f.service,'a'),job=await start(f.service,p,'a');await state(f.service,job,'failed');
    assert.equal((await start(f.service,p,'a')).state,'failed');assert.equal(reserves,1);assert.equal(cancels,0);assert.equal(builds,0);
    const next=await start(f.service,p,'explicit-new-request');await state(f.service,next,'failed');assert.equal(reserves,2);
  }finally{await f.close();}
});

test("a lost queued cancellation acknowledgement requires reconciliation instead of freeing its admission",async()=>{
  let builds=0,cancels=0;
  const reserve=gate();
  const a=adapter({admission:{reserve:async({signal})=>Promise.race([reserve.promise,abortable(signal)]),cancel:async()=>{cancels++;throw new GameProductionUncertain('Fixture close acknowledgement lost.');}},
    build:async()=>{builds++;return output();},reconcile:async()=>({state:'missing',detail:'Original cancellation confirmed.'})});
  const f=await fixture({gameAdapters:[a]});
  try{
    const job=await start(f.service,await project(f.service,'a'),'a');await state(f.service,job,'admitting');
    await call(f.service,'games.production.cancel',{id:job.id});await state(f.service,job,'awaiting_reconciliation');
    assert.equal(builds,0);assert.equal(cancels,1);
    await assert.rejects(call(f.service,'games.production.cancel',{id:job.id}),/Inspect/);
    await call(f.service,'games.production.reconcile',{id:job.id});await state(f.service,job,'failed');assert.equal(builds,0);
  }finally{reserve.resolve();await f.close();}
});

test("restart preserves both pending and reserved external admissions for inspection without replay",async()=>{
  for(const pending of [true,false]){
    const held=gate();let reserves=0,builds=0,inspected=0;
    const a=adapter({admission:{reserve:async({signal})=>{reserves++;if(pending)await Promise.race([held.promise,abortable(signal)]);},cancel:async()=>{}},
      build:async({signal})=>{builds++;return abortable(signal);},reconcile:async()=>{inspected++;return {state:'missing',detail:'Original fixture receipt closed.'};}});
    const f=await fixture({gameAdapters:[a],gameResourceBudget:{...budget,maxConcurrent:1}});let restarted:AgentService|undefined;
    try{
      if(!pending){await start(f.service,await project(f.service,'running'),'running');await until(()=>builds===1);}
      const p=await project(f.service,'queued'),job=await start(f.service,p,'queued');await state(f.service,job,pending?'admitting':'queued');
      const originalReserves=reserves,originalBuilds=builds,snapshot=path.join(f.directory,'admission-crash.sqlite');await f.service.store.db.backup(snapshot);
      restarted=new AgentService(new Store(snapshot),f.directory,undefined,{}, {gameAdapters:[a],gameResourceBudget:{...budget,maxConcurrent:1}});
      assert.equal((await call<GameProductionJob>(restarted,'games.production.get',{id:job.id})).state,'awaiting_reconciliation');
      assert.equal((await start(restarted,p,'queued')).id,job.id);
      await call(restarted,'games.production.reconcile',{id:job.id});assert.equal(reserves,originalReserves);assert.equal(builds,originalBuilds);assert.equal(inspected,1);
    }finally{held.resolve();await restarted?.close();await f.close();}
  }
});

test("pending external admission counts toward queue capacity and cannot be selected by client fields",async()=>{
  const held=gate();let calls=0;
  const a=adapter({admission:{reserve:async({signal})=>{calls++;await Promise.race([held.promise,abortable(signal)]);},cancel:async()=>{}},
    reconcile:async()=>({state:'missing',detail:'Original admission closed.'})});
  const f=await fixture({gameAdapters:[a],gameResourceBudget:{...budget,maxQueued:1}});
  try{
    const job=await start(f.service,await project(f.service,'a'),'a');await state(f.service,job,'admitting');
    const p=await project(f.service,'b');await assert.rejects(start(f.service,p,'b'),/queue is full/);assert.equal(calls,1);
    await assert.rejects(call(f.service,'games.builds.start',{requestId:'forged',projectId:p.id,revision:1,admission:'reserved'}));
    await call(f.service,'games.production.cancel',{id:job.id});await state(f.service,job,'cancelled');assert.equal(calls,1);
  }finally{held.resolve();await f.close();}
});

test("one user queue spans products, keeps FIFO and cancels waiting work without invoking or disposing its adapter", async () => {
  const first = gate(), entered: string[] = [], disposed: string[] = [];
  const f = await fixture({ gameResourceBudget: { ...budget, maxConcurrent: 1 }, gameAdapters: [adapter({
    build: async ({ job, signal }) => { entered.push(job.id); if (entered.length === 1) await Promise.race([first.promise, abortable(signal)]); return output(); },
    dispose: async ({ job }) => { disposed.push(job.id); },
  })] });
  try {
    const a = await project(f.service, "a"), b = await project(f.service, "b", editor), c = await project(f.service, "c"), d = await project(f.service, "d");
    const running = await start(f.service, a, "a"); await until(() => entered.length === 1);
    const waiting = await start(f.service, b, "b", editor), cancelled = await start(f.service, c, "c"), last = await start(f.service, d, "d");
    assert.equal(waiting.state, "queued"); assert.equal(waiting.waitingReason, "resources"); assert.deepEqual(waiting.resources, resources);
    assert.equal((await call<{ accepted: boolean }>(f.service, "engine.quiesceIfIdle")).accepted, false);
    await assert.rejects(call(f.service, "games.production.cancel", { id: waiting.id }), /not found/);
    await call(f.service, "games.production.cancel", { id: cancelled.id }); await state(f.service, cancelled, "cancelled");
    assert.equal((await start(f.service, c, "c")).state, "cancelled", "replay must not requeue a cancelled operation");
    assert.deepEqual(entered, [running.id]); assert.ok(!disposed.includes(cancelled.id));
    first.resolve(); await state(f.service, waiting, "completed", editor); await state(f.service, last, "completed");
    assert.deepEqual(entered, [running.id, waiting.id, last.id]); assert.ok(!disposed.includes(cancelled.id));
    const events = await call<{ events: { job: GameProductionJob }[] }>(f.service, "games.production.events", { projectId: c.id });
    assert.ok(!events.events.some((event) => event.job.state === "running"));
    assert.equal((await call<GameProductionJob>(f.service, "games.production.get", { id: waiting.id }, editor)).waitingReason, undefined);
  } finally { first.resolve(); await f.close(); }
});

test("memory and CPU estimates independently bound parallel jobs even when concurrent slots are available", async () => {
  for (const [policy, cost] of [
    [{ ...budget, memoryMiB: 6, maxConcurrent: 4 }, resources],
    [{ ...budget, memoryMiB: 100, cpuSlots: 3, maxConcurrent: 4 }, { ...resources, cpuSlots: 2 }],
  ] as const) {
    const release = gate(); let active = 0, peak = 0, starts = 0;
    const f = await fixture({ gameResourceBudget: policy, gameAdapters: [adapter({ resources: cost, build: async ({ signal }) => {
      active++; starts++; peak = Math.max(peak, active);
      try { if (starts === 1) await Promise.race([release.promise, abortable(signal)]); return output(); } finally { active--; }
    } })] });
    try {
      const a = await start(f.service, await project(f.service, "a"), "a"); await until(() => starts === 1);
      const b = await start(f.service, await project(f.service, "b"), "b"); assert.equal(b.state, "queued");
      assert.equal(starts, 1); release.resolve(); await state(f.service, a, "completed"); await state(f.service, b, "completed"); assert.equal(peak, 1);
    } finally { release.resolve(); await f.close(); }
  }
});

test("available resources permit bounded parallelism; an older large build is not bypassed by smaller new jobs", async () => {
  const release = gate(), big = gate(), small = gate(); const entered: string[] = [];
  const f = await fixture({ gameResourceBudget: { ...budget, memoryMiB: 6, maxConcurrent: 3 }, gameAdapters: [adapter({ build: async ({ job, signal }) => {
    entered.push(job.id); await Promise.race([entered.length === 1 ? release.promise : big.promise, abortable(signal)]); return output();
  } }), adapter({ id: "small-build", engine: "babylon", resources: { ...resources, memoryMiB: 1 }, build: async ({ job, signal }) => {
    entered.push(job.id); await Promise.race([small.promise, abortable(signal)]); return output();
  } })] });
  try {
    const a = await start(f.service, await project(f.service, "a"), "a"); await until(() => entered.length === 1);
    const b = await start(f.service, await project(f.service, "b"), "b");
    const c = await start(f.service, await project(f.service, "c", reg, "babylon"), "c");
    assert.equal(b.state, "queued"); assert.equal(c.state, "queued"); assert.deepEqual(entered, [a.id]);
    release.resolve(); await until(() => entered.length === 3);
    assert.deepEqual(entered, [a.id, b.id, c.id]);
    assert.equal((await call<GameProductionJob>(f.service, "games.production.get", { id: b.id })).state, "running");
    assert.equal((await call<GameProductionJob>(f.service, "games.production.get", { id: c.id })).state, "running");
    big.resolve(); small.resolve(); await state(f.service, b, "completed"); await state(f.service, c, "completed");
  } finally { release.resolve(); big.resolve(); small.resolve(); await f.close(); }
});

test("builds, validation and asset processing share reservations and release known failures", async () => {
  const release = gate(), entered: string[] = [];
  const validation: GameValidationCollector = { id: "schedule-inspect", engines: ["phaser"], products: ["companion-mac"], authority: "workspace", toolchain,
    resources, categories: ["runtime"], validate: async ({ signal }) => { entered.push("validate"); await Promise.race([release.promise, abortable(signal)]); throw new GameProductionFailure("Known observation failure"); } };
  const media: GameAssetProcessor = { id: "schedule-media", products: ["companion-mac"], authority: "workspace", toolchain, resources, operations: ["audio.render"],
    probe: async () => ({ available: true }), process: async () => { entered.push("assets"); throw new GameProductionFailure("Known codec failure"); } };
  const f = await fixture({ gameResourceBudget: { ...budget, maxConcurrent: 1 }, gameCollectors: [validation], gameAssetProcessors: [media], gameAdapters: [adapter({ build: async () => { entered.push("build"); return output(); } })] });
  try {
    const p = await project(f.service, "a"), build = await start(f.service, p, "a"); await state(f.service, build, "completed");
    const inspect = await call<GameProductionJob>(f.service, "games.validation.start", { requestId: "v", buildId: build.id, collectorId: validation.id }); await until(() => entered.length === 2);
    const assets = await call<GameProductionJob>(f.service, "games.assets.process", { requestId: "m", projectId: (await project(f.service, "b")).id, revision: 1,
      spec: { processorId: media.id, target: { id: "tone", role: "Fixture tone" }, operation: { type: "audio.render", output: "assets/tone.wav", durationMs: 100, notes: [{ waveform: "sine", frequency: 440, startMs: 0, durationMs: 100, gain: 0.1 }] } } });
    const waiting = await start(f.service, await project(f.service, "c"), "c");
    assert.equal(assets.state, "queued"); assert.equal(waiting.state, "queued"); assert.deepEqual(entered, ["build", "validate"]);
    release.resolve(); await state(f.service, inspect, "failed"); await state(f.service, assets, "failed"); await state(f.service, waiting, "completed");
    assert.deepEqual(entered, ["build", "validate", "assets", "build"]);
  } finally { release.resolve(); await f.close(); }
});

test("unknown effects retain resources across a crash snapshot and a smaller budget until original inspection", async () => {
  let starts = 0, inspected = 0, smallStarts = 0;
  const a = adapter({ build: async () => { starts++; throw new Error("Acknowledgment was lost"); }, reconcile: async () => {
    inspected++;
    if (inspected === 1) return { state: "running" };
    if (inspected === 2) throw new Error("Inspector temporarily unavailable");
    return { state: "missing", detail: "Original operation stopped; no acknowledged candidate." };
  } });
  const f = await fixture({ gameResourceBudget: { ...budget, maxConcurrent: 1 }, gameAdapters: [a] }); let restarted: AgentService | undefined;
  try {
    const original = await start(f.service, await project(f.service, "a"), "a"); await state(f.service, original, "awaiting_reconciliation");
    const waiting = await start(f.service, await project(f.service, "b"), "b"); assert.equal(waiting.state, "queued"); assert.equal(starts, 1);
    assert.equal((await call<GameProductionJob>(f.service, "games.production.reconcile", { id: original.id })).state, "awaiting_reconciliation");
    await assert.rejects(call(f.service, "games.production.reconcile", { id: original.id }), /Inspector temporarily unavailable/);
    assert.equal((await call<GameProductionJob>(f.service, "games.production.get", { id: waiting.id })).state, "queued"); assert.equal(starts, 1);
    const snapshot = path.join(f.directory, "crash.sqlite"); await f.service.store.db.backup(snapshot);
    await f.service.close();
    restarted = new AgentService(new Store(snapshot), f.directory, undefined, {}, { gameAdapters: [a, adapter({ id: "small-recovery", engine: "babylon", resources: { ...resources, memoryMiB: 1 },
      build: async () => { smallStarts++; return output(); } })], gameResourceBudget: { ...budget, memoryMiB: 2 } });
    assert.equal((await call<GameProductionJob>(restarted, "games.production.get", { id: waiting.id })).state, "failed");
    await assert.rejects(start(restarted, await project(restarted, "too-large"), "too-large"), /more scheduling resources/);
    const fitsNewBudget = await start(restarted, await project(restarted, "small", reg, "babylon"), "small");
    assert.equal(fitsNewBudget.state, "queued", "the older unknown reservation exceeds the new budget and blocks even otherwise fitting work"); assert.equal(smallStarts, 0);
    await restarted.close();
    assert.equal(smallStarts, 0);
    restarted = new AgentService(new Store(snapshot), f.directory, undefined, {}, { gameAdapters: [a], gameResourceBudget: { ...budget, maxConcurrent: 1 } });
    const later = await start(restarted, await project(restarted, "c"), "c"); assert.equal(later.state, "queued"); assert.equal(starts, 1);
    await call(restarted, "games.production.reconcile", { id: original.id });
    await state(restarted, later, "awaiting_reconciliation"); assert.equal(starts, 2); assert.equal(inspected, 3);
  } finally { await restarted?.close(); await f.close(); }
});

test("queue admission is bounded and clients cannot select budgets, costs or priority", async () => {
  let starts = 0;
  const f = await fixture({ gameResourceBudget: { ...budget, maxConcurrent: 1, maxQueued: 1 }, gameAdapters: [adapter({ build: async ({ signal }) => { starts++; return abortable(signal); } })] });
  try {
    const p = await project(f.service, "a"), a = await start(f.service, p, "a"); await until(() => starts === 1);
    const b = await start(f.service, await project(f.service, "b"), "b"), c = await project(f.service, "c");
    await assert.rejects(start(f.service, c, "c"), /queue is full/);
    for (const field of [{ resources: { memoryMiB: 1, cpuSlots: 1, exclusiveGroups: [] } }, { priority: 1 }, { resourceBudget: budget }])
      await assert.rejects(call(f.service, "games.builds.start", { requestId: "forged", projectId: c.id, revision: 1, ...field }));
    const caps = await call<GameProductionCapabilities>(f.service, "games.production.capabilities"); assert.deepEqual(caps.resourceBudget, { ...budget, maxConcurrent: 1, maxQueued: 1 });
    await f.service.close();
    const rows = f.service.store.db.open;
    assert.equal(rows, false);
    const reopened = new AgentService(new Store(f.file), f.directory);
    try { assert.equal((await call<GameProductionJob>(reopened, "games.production.get", { id: a.id })).state, "cancelled"); assert.equal((await call<GameProductionJob>(reopened, "games.production.get", { id: b.id })).state, "cancelled"); assert.equal(starts, 1); }
    finally { await reopened.close(); }
  } finally { await f.close(); }
});

test("missing estimates reserve the full budget and oversize tools are unavailable before a job is admitted", async () => {
  const release = gate(); let starts = 0;
  const f = await fixture({ gameAdapters: [adapter({ resources: undefined, build: async ({ signal }) => { starts++; await Promise.race([release.promise, abortable(signal)]); return output(); } }), adapter({ id: "huge", engine: "babylon", resources: { ...resources, memoryMiB: 9 } })] });
  try {
    const caps = await call<GameProductionCapabilities>(f.service, "games.production.capabilities"); assert.equal(caps.adapters.find((item) => item.id === "huge")!.available, false);
    const a = await start(f.service, await project(f.service, "a"), "a"); await until(() => starts === 1);
    const b = await start(f.service, await project(f.service, "b"), "b"); assert.equal(b.state, "queued"); assert.equal(a.resources!.memoryMiB, budget.memoryMiB);
    await assert.rejects(start(f.service, await project(f.service, "c", reg, "babylon"), "c"), /more scheduling resources/);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_production_jobs").get() as { n: number }).n, 2);
    release.resolve(); await state(f.service, b, "completed");
  } finally { release.resolve(); await f.close(); }
});

test("real codec workers on different projects wait for their exclusive media reservation", async () => {
  const processor = createLocalGameAssetProcessor();
  const f = await fixture({ gameAdapters: [], gameAssetProcessors: [processor], gameResourceBudget: { memoryMiB: 4096, cpuSlots: 4, maxConcurrent: 4, maxQueued: 8 } });
  try {
    const projects = await Promise.all([project(f.service, "a"), project(f.service, "b")]);
    const jobs = await Promise.all(projects.map((p, i) => call<GameProductionJob>(f.service, "games.assets.process", { requestId: `audio-${i}`, projectId: p.id, revision: 1,
      spec: { processorId: processor.id, target: { id: "tone", role: "Synthetic scheduling fixture" }, operation: { type: "audio.render", output: "assets/tone.wav", durationMs: 1000,
        notes: [{ waveform: "sine", frequency: 440, startMs: 0, durationMs: 1000, gain: 0.2 }] } } })));
    assert.ok(jobs.some((job) => job.state === "queued"));
    for (const job of jobs) await state(f.service, job, "completed");
    const intervals = jobs.map((job) => {
      const events = f.service.store.db.prepare("SELECT sequence,value FROM game_production_events WHERE job=? ORDER BY sequence").all(job.id) as { sequence: number; value: string }[];
      return { start: events.find((event) => JSON.parse(event.value).state === "running")!.sequence, end: events.find((event) => JSON.parse(event.value).state === "completed")!.sequence };
    }).sort((a, b) => a.start - b.start);
    assert.ok(intervals[0]!.end < intervals[1]!.start, "media workers must not overlap despite free memory/CPU slots");
  } finally { await f.close(); }
});

const observedValidation = (patch: Partial<GameValidationCollector> = {}): GameValidationCollector => ({
  id: 'admitted-observation', engines: ['phaser'], products: ['companion-mac'], authority: 'workspace', toolchain,
  resources, categories: ['runtime'],
  validate: async () => [], ...patch,
});

test('validation reserves the pinned artifact before resource waiting and uncertain queued cancellation needs original inspection', async () => {
  const held = gate(), charged = new Set<string>(); let validates=0, cancels=0, inspections=0, disposed=0;
  let f!: Awaited<ReturnType<typeof fixture>>; let originalBuild!: GameProductionJob;
  const observation=observedValidation({admission:{
    reserve:async context=>{
      assert.equal(context.job.kind,'validate');assert.equal(context.job.buildId,originalBuild.id);
      assert.equal(context.artifact.jobId,originalBuild.id);
      assert.match(Buffer.from(await context.readFile('index.html')).toString(),/Scheduling fixture/);
      await assert.rejects(context.readFile('source-only.js'),/pinned build artifact/);
      const persisted=JSON.parse((f.service.store.db.prepare('SELECT value FROM game_production_jobs WHERE id=?').get(context.job.id) as {value:string}).value);
      assert.equal(persisted.state,'admitting');assert.equal(persisted.admission,'pending');charged.add(context.job.id);
    },cancel:async context=>{assert.ok(charged.has(context.job.id));assert.equal(context.artifact.jobId,originalBuild.id);cancels++;throw new GameProductionUncertain('Original validation cancellation acknowledgement lost.');}
  },validate:async()=>{validates++;return [];},reconcile:async context=>{
    assert.ok(charged.has(context.job.id));assert.equal(context.artifact.jobId,originalBuild.id);inspections++;
    return {state:'missing',detail:'Original observation reservation was fenced, without collecting or refunding.'};
  },dispose:async()=>{disposed++;}});
  f=await fixture({gameCollectors:[observation],gameAdapters:[adapter({build:async({job,signal})=>{
    if(job.projectId===blockingProject)await Promise.race([held.promise,abortable(signal)]);return output();
  }})],gameResourceBudget:{...budget,maxConcurrent:1}});
  let blockingProject='';
  try{
    const p=await project(f.service,'subject');originalBuild=await start(f.service,p,'build-subject');await state(f.service,originalBuild,'completed');
    blockingProject=(await project(f.service,'blocker')).id;
    const block=await call<GameProductionJob>(f.service,'games.builds.start',{requestId:'block',projectId:blockingProject,revision:1});await state(f.service,block,'running');
    const request={requestId:'inspect',buildId:originalBuild.id,collectorId:observation.id};
    const validation=await call<GameProductionJob>(f.service,'games.validation.start',request);await state(f.service,validation,'queued');
    assert.deepEqual([...charged],[validation.id]);assert.equal(validates,0);
    await assert.rejects(call(f.service,'games.validation.start',{...request,requestId:'forged',admission:'reserved'}));
    await call(f.service,'games.production.cancel',{id:validation.id});await state(f.service,validation,'awaiting_reconciliation');
    assert.equal(cancels,1);assert.equal(validates,0);assert.equal(disposed,0);
    assert.equal((await call<GameProductionJob>(f.service,'games.validation.start',request)).id,validation.id);
    await assert.rejects(call(f.service,'games.validation.start',{...request,requestId:'another'}),/unreconciled/);
    assert.equal((await call<GameProductionJob>(f.service,'games.production.reconcile',{id:validation.id})).state,'failed');
    assert.equal(inspections,1);assert.equal(charged.size,1);assert.equal(validates,0);
    held.resolve();await state(f.service,block,'completed');
  }finally{held.resolve();await f.close();}
});

test('lost validation reservation acknowledgement survives restart without collecting, re-admitting or accepting UI proof',async()=>{
  let admissions=0,validates=0,inspections=0;
  let originalJob='',originalArtifact='';
  const observation=observedValidation({admission:{reserve:async context=>{
    admissions++;originalJob=context.job.id;originalArtifact=context.artifact.artifactHash;
    throw new Error('External reservation committed but its acknowledgement was lost.');
  },cancel:async()=>{throw new GameProductionUncertain('Original reservation needs inspection.');}},validate:async()=>{validates++;return [];},
  reconcile:async context=>{assert.equal(context.job.id,originalJob);assert.equal(context.artifact.artifactHash,originalArtifact);assert.equal(context.job.admission,'pending');inspections++;return {state:'missing',detail:'Original reservation closed; no browser started.'};}});
  const f=await fixture({gameCollectors:[observation]});let restarted:AgentService|undefined;
  try{
    const p=await project(f.service,'subject'),build=await start(f.service,p,'build');await state(f.service,build,'completed');
    const request={requestId:'observe',buildId:build.id,collectorId:observation.id};
    const job=await call<GameProductionJob>(f.service,'games.validation.start',request);await state(f.service,job,'awaiting_reconciliation');
    assert.equal(admissions,1);assert.equal(validates,0);await f.service.close();
    restarted=new AgentService(new Store(f.file),f.directory,undefined,{}, {gameAdapters:[adapter()],gameCollectors:[observation],gameResourceBudget:budget});
    assert.equal((await call<GameProductionJob>(restarted,'games.validation.start',request)).id,job.id);
    await assert.rejects(call(restarted,'games.validation.start',{...request,requestId:'repeat'}),/unreconciled/);
    await assert.rejects(call(restarted,'games.production.reconcile',{id:job.id,proof:{completed:true}}));
    assert.equal((await call<GameProductionJob>(restarted,'games.production.reconcile',{id:job.id})).state,'failed');
    assert.equal(admissions,1);assert.equal(validates,0);assert.equal(inspections,1);
  }finally{await restarted?.close();await f.close();}
});

test('known validation budget refusal is terminal without cancellation or observation',async()=>{
  let admissions=0,cancels=0,validates=0;
  const observation=observedValidation({admission:{reserve:async()=>{admissions++;throw new GameProductionFailure('Project validation budget denied.');},cancel:async()=>{cancels++;}},
    validate:async()=>{validates++;return [];},reconcile:async()=>({state:'missing',detail:'Refused original request.'})});
  const f=await fixture({gameCollectors:[observation]});
  try{
    const p=await project(f.service,'subject'),build=await start(f.service,p,'build');await state(f.service,build,'completed');
    const request={requestId:'denied',buildId:build.id,collectorId:observation.id},job=await call<GameProductionJob>(f.service,'games.validation.start',request);
    await state(f.service,job,'failed');assert.equal((await call<GameProductionJob>(f.service,'games.validation.start',request)).id,job.id);
    assert.equal(admissions,1);assert.equal(cancels,0);assert.equal(validates,0);
  }finally{await f.close();}
});

test('KidOS observation ports require pre-queue admission and its original inspector even when supplied by the process owner',()=>{
  for(const variant of ['missing-admission','missing-reserve','missing-cancel','missing-inspector']){
    const store=new Store(':memory:');
    const observation=observedValidation({products:['kidos'],authority:'kidos-core',admission:variant==='missing-admission'?undefined:{
      reserve:variant==='missing-reserve'?undefined as any:async()=>{},cancel:variant==='missing-cancel'?undefined as any:async()=>{}},
      reconcile:variant==='missing-inspector'?undefined:async()=>({state:'missing',detail:'Original closed.'})});
    try{assert.throws(()=>new AgentService(store,tmpdir(),undefined,{}, {gameCollectors:[observation]}),/admission|inspection/i);}
    finally{store.close();}
  }
});
