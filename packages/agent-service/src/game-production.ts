import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";
import { gameFilePath, gameFileTreeConflict } from "../../contracts/src/games";
import { gameArtifact, gameBuildRequest, gameValidationRequest, gameObservation, gameToolchain,
  gameProductionTerminal, type GameArtifact, type GameObservation, type GameProductionJob, type GameValidationReport, type GameProductionBudget,
} from "../../contracts/src/game-production";
import type { GameBlobAccess, GameProductionAdapter, GameValidationCollector, ProducedGameArtifact, ProductionAccess, CollectedGameObservation, GameAssetProcessor, ProcessedGameAsset } from "../../game-production/src/index";
import { gameAssetProcessRequest, gameAssetApplyRequest } from "../../contracts/src/game-assets";
import {gameLibraryQuery,gameLibraryPage} from "../../contracts/src/game-library";
import { GameAssetResults } from "./game-asset-results";
import { GameProductionFailure, GameProductionUncertain } from "../../game-production/src/index";
import { assessGameQuality } from "../../game-design/src/quality";
import { namespace } from "./security";
import type { Store } from "./store";
import type { GameProjects } from "./game-projects";
import { GameResources } from "./game-resources";
import { checkGameBrowserRecipe, gameBrowserRecipeSizeCheck, gameBrowserRecipeFailureMessage } from "../../contracts/src/game-browser-tests";

type Row = { value: string };
type Tasks = { controller: AbortController; promise: Promise<void> };
const adapterIdentity = z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/);

/** One-shot production jobs around installed tools. Agent execution remains in Agent Core. */
export class GameProduction {
  private readonly tasks = new Map<string, Tasks>();
  private readonly inspections = new Map<string, { controller: AbortController; promise: Promise<GameProductionJob> }>();
  private closing = false;
  private closingTask?: Promise<void>;
  private readonly resources: GameResources;
  readonly assetResults: GameAssetResults;
  constructor(private readonly store: Store, private readonly projects: GameProjects,
    private readonly blobs: GameBlobAccess,
    private readonly adapters: readonly GameProductionAdapter[],
    private readonly collectors: readonly GameValidationCollector[],
    private readonly protect: <T>(reg: Registration, value: T) => T,
    private readonly assetProcessors: readonly GameAssetProcessor[] = [],
    resourceBudget?: GameProductionBudget,
    private readonly admission?: (reg: Registration, job: GameProductionJob) => void,
  ) {
    this.resources = new GameResources(resourceBudget);
    for (const item of [...adapters, ...collectors, ...assetProcessors]) {
      adapterIdentity.parse(item.id); gameToolchain.parse(item.toolchain);
      this.resources.requirements(item.resources);
      if (item.products.includes("kidos") && item.authority !== "kidos-core")
        throw new Error("KidOS game production must be mediated by its protected Core adapter.");
    }
    for (const adapter of [...adapters,...assetProcessors,...collectors]) if (adapter.admission && (typeof adapter.admission.reserve !== "function" ||
      typeof adapter.admission.cancel !== "function" || typeof adapter.reconcile !== "function"))
      throw new Error("External production admission requires reservation, cancellation and original-result inspection hooks.");
    if (collectors.some(collector => collector.testSuiteFormat !== undefined && collector.testSuiteFormat !== "browser-v1"))
      throw new Error("Unknown installed validation test-suite format.");
    if (collectors.some(collector => collector.products.includes("kidos") && !collector.admission))
      throw new Error("KidOS validation requires durable pre-queue admission and original-result inspection.");
    const productEngines=adapters.flatMap(item=>item.products.map(product=>`${product}:${item.engine}`));
    if (new Set(productEngines).size !== productEngines.length ||
        new Set([...adapters, ...collectors, ...assetProcessors].map((item) => item.id)).size !== adapters.length + collectors.length + assetProcessors.length)
      throw new Error("Game production adapters must have unique identities and one active toolchain per engine and product.");
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS game_production_jobs(id TEXT PRIMARY KEY,namespace TEXT NOT NULL,project TEXT NOT NULL REFERENCES game_projects(id),request_key TEXT NOT NULL,binding TEXT NOT NULL,state TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(namespace,request_key));
      CREATE UNIQUE INDEX IF NOT EXISTS game_one_active_production ON game_production_jobs(project) WHERE state NOT IN ('completed','cancelled','failed');
      CREATE TABLE IF NOT EXISTS game_artifacts(id TEXT PRIMARY KEY,namespace TEXT NOT NULL,job TEXT NOT NULL UNIQUE REFERENCES game_production_jobs(id),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_artifact_files(artifact TEXT NOT NULL REFERENCES game_artifacts(id),transfer TEXT NOT NULL REFERENCES transfers(id),path TEXT NOT NULL,PRIMARY KEY(artifact,path));
      CREATE TABLE IF NOT EXISTS game_validation_reports(id TEXT PRIMARY KEY,namespace TEXT NOT NULL,build TEXT NOT NULL REFERENCES game_production_jobs(id),value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS game_reports_namespace_build ON game_validation_reports(namespace,build);
      CREATE TABLE IF NOT EXISTS game_report_files(report TEXT NOT NULL REFERENCES game_validation_reports(id),transfer TEXT NOT NULL REFERENCES transfers(id),path TEXT NOT NULL,PRIMARY KEY(report,path));
      CREATE TABLE IF NOT EXISTS game_production_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,namespace TEXT NOT NULL,project TEXT NOT NULL,job TEXT NOT NULL,value TEXT NOT NULL);
    `);
    this.assetResults = new GameAssetResults(store, projects, blobs);
  }
  get busy(): boolean {
    return this.tasks.size > 0 || this.inspections.size > 0 || Boolean(this.store.db.prepare("SELECT id FROM game_production_jobs WHERE state NOT IN ('completed','cancelled','failed') LIMIT 1").get());
  }
  async capabilities(reg: Registration) {
    const adapters = await Promise.all(this.adapters.filter((adapter) => adapter.products.includes(reg.product)).map(async (adapter) => {
      try {
        const result = await adapter.probe(reg), resources = this.resources.requirements(adapter.resources);
        const reason = this.resources.unavailable(resources) ?? result.reason;
        return { id: adapter.id, engine: adapter.engine, toolchain: adapter.toolchain, resources, available: result.available && !this.resources.unavailable(resources),
          ...(adapter.projectGuide ? { projectGuide: adapter.projectGuide.slice(0, 4000) } : {}),
          ...(reason ? { reason: this.protect(reg, reason) } : {}) };
      }
      catch (error) { return { id: adapter.id, engine: adapter.engine, toolchain: adapter.toolchain, available: false,
        reason: this.protect(reg, error instanceof Error ? error.message : "Toolchain probe failed.") }; }
    }));
    const collectors = await Promise.all(this.collectors.filter((collector) => collector.products.includes(reg.product)).map(async (collector) => {
      let result: { available: boolean; reason?: string };
      try { result = collector.probe ? await collector.probe(reg) : { available: true }; }
      catch { result = { available: false, reason: "The installed collector probe failed." }; }
      const resources = this.resources.requirements(collector.resources), reason = this.resources.unavailable(resources) ?? result.reason;
      return { id: collector.id, engines: collector.engines, categories: collector.categories, toolchain: collector.toolchain, resources,
        ...(collector.projectGuide ? { projectGuide: collector.projectGuide.slice(0, 4000) } : {}),
        available: result.available && !this.resources.unavailable(resources), ...(reason ? { reason: this.protect(reg, reason) } : {}) };
    }));
    const assetProcessors = await Promise.all(this.assetProcessors.filter((processor)=>processor.products.includes(reg.product)).map(async(processor)=>{
      try {const result=await processor.probe(reg),resources=this.resources.requirements(processor.resources),reason=this.resources.unavailable(resources)??result.reason;return {id:processor.id,operations:processor.operations,toolchain:processor.toolchain,resources,available:result.available&&!this.resources.unavailable(resources),...(processor.projectGuide?{projectGuide:processor.projectGuide}:{}),...(reason?{reason:this.protect(reg,reason)}:{})};}
      catch {return {id:processor.id,operations:processor.operations,toolchain:processor.toolchain,available:false,reason:"The installed asset processor probe failed."};}
    }));
    return { adapters, collectors, resourceBudget: { ...this.resources.budget }, ...(assetProcessors.length?{assetProcessors}: {}) };
  }
  async libraries(reg:Registration,input:unknown){
    const query=gameLibraryQuery.parse(input),processor=this.assetProcessors.find(item=>item.id===query.processorId);
    if(!processor?.libraries)throw new AgentError(errors.unavailable,"No qualified library catalog is installed for this processor.");
    this.authorize(reg,processor);
    return gameLibraryPage.parse(await processor.libraries(query));
  }
  recover(): void {
    for (const row of this.store.db.prepare("SELECT namespace,value FROM game_production_jobs WHERE state NOT IN ('completed','cancelled','failed')").all() as (Row & { namespace: string })[]) {
      const job = JSON.parse(row.value) as GameProductionJob;
      if (this.tasks.has(job.id)) continue;
      job.state = job.state === "queued" && !job.admission ? "failed" : "awaiting_reconciliation";
      delete job.waitingReason;
      if (job.state === "awaiting_reconciliation") this.resources.hold(job.id, job.resources);
      job.error = job.state === "failed" ? "The coordinator stopped before this job started. Request a new job explicitly."
        : "The coordinator stopped before acknowledging this operation. Inspect its result before repeating it.";
      job.updatedAt = Date.now();
      this.store.db.transaction(() => { this.write(job); this.event(row.namespace, job); })();
    }
  }
  private authorize(reg: Registration, adapter: { products: readonly Registration["product"][]; authority: string }): void {
    if (!adapter.products.includes(reg.product) || (reg.product === "kidos" && adapter.authority !== "kidos-core"))
      throw new AgentError(errors.forbidden, "This game adapter is not authorized for the authenticated product.");
  }
  private previous(reg: Registration, key: string, input: unknown): GameProductionJob | undefined {
    const row = this.store.db.prepare("SELECT binding,value FROM game_production_jobs WHERE namespace=? AND request_key=?")
      .get(namespace(reg), key) as (Row & { binding: string }) | undefined;
    if (!row) return undefined;
    if (row.binding !== contentHash(input)) throw new AgentError(errors.conflict, "Game production identity was used for different content.");
    return JSON.parse(row.value) as GameProductionJob;
  }
  job(reg: Registration, id: string): GameProductionJob {
    const row = this.store.db.prepare("SELECT value FROM game_production_jobs WHERE namespace=? AND id=?").get(namespace(reg), id) as Row | undefined;
    if (!row) throw new AgentError(errors.missing, "Game production job not found in this namespace.");
    return JSON.parse(row.value) as GameProductionJob;
  }
  list(reg: Registration, projectId: string, cursor = 0, limit = 30,order:"asc"|"desc"="asc") {
    this.projects.get(reg, projectId);
    const descending=order==="desc";
    const rows = this.store.db.prepare(`SELECT rowid,value FROM game_production_jobs WHERE namespace=? AND project=? AND rowid${descending?"<":">"}? ORDER BY rowid ${descending?"DESC":"ASC"} LIMIT ?`)
      .all(namespace(reg), projectId,descending?(cursor||Number.MAX_SAFE_INTEGER):cursor, limit + 1) as (Row & { rowid: number })[];
    return { jobs: rows.slice(0, limit).map((row) => JSON.parse(row.value) as GameProductionJob),
      cursor: rows.slice(0, limit).at(-1)?.rowid ?? cursor, hasMore: rows.length > limit };
  }
  artifact(reg: Registration, buildId: string): GameArtifact {
    this.job(reg, buildId);
    const row = this.store.db.prepare("SELECT value FROM game_artifacts WHERE namespace=? AND job=?").get(namespace(reg), buildId) as Row | undefined;
    if (!row) throw new AgentError(errors.missing, "This build has no acknowledged artifact.");
    return gameArtifact.parse(JSON.parse(row.value));
  }
  events(reg: Registration, projectId: string, cursor = 0, limit = 100) {
    this.projects.get(reg, projectId);
    const rows = this.store.db.prepare("SELECT sequence,value FROM game_production_events WHERE namespace=? AND project=? AND sequence>? ORDER BY sequence LIMIT ?")
      .all(namespace(reg), projectId, cursor, limit + 1) as (Row & { sequence: number })[];
    const events = rows.slice(0, limit).map((row) => ({ sequence: row.sequence, job: JSON.parse(row.value) as GameProductionJob }));
    return { events, cursor: events.at(-1)?.sequence ?? cursor, hasMore: rows.length > limit };
  }
  private event(ns: string, job: GameProductionJob): void {
    this.store.db.prepare("INSERT INTO game_production_events(namespace,project,job,value) VALUES(?,?,?,?)").run(ns, job.projectId, job.id, JSON.stringify(job));
  }
  private write(job: GameProductionJob): void {
    this.store.db.prepare("UPDATE game_production_jobs SET state=?,value=? WHERE id=?").run(job.state, JSON.stringify(job), job.id);
  }
  private update(reg: Registration, job: GameProductionJob, state: GameProductionJob["state"], extras: Partial<GameProductionJob> = {}): GameProductionJob {
    const next = { ...job, ...extras, state, updatedAt: Date.now() };
    // The previous interruption stays in immutable events, not in the current
    // successfully recovered state shown by clients.
    if(state==="completed"){delete next.error;delete next.waitingReason;}
    this.store.db.transaction(() => { this.write(next); this.event(namespace(reg), next); })();
    return next;
  }
  private admit(reg: Registration, key: string, input: unknown, job: Omit<GameProductionJob, "id" | "state" | "createdAt" | "updatedAt">, externalAdmission = false): { job: GameProductionJob; created: boolean } {
    if (this.closing) throw new AgentError(errors.unavailable, "Game production is stopping.");
    return this.store.db.transaction(() => {
      const previous = this.previous(reg, key, input);
      if (previous) return { job: previous, created: false };
      if (this.store.db.prepare("SELECT id FROM game_production_jobs WHERE project=? AND state NOT IN ('completed','cancelled','failed')").get(job.projectId))
        throw new AgentError(errors.conflict, "This project has active or unreconciled production work.");
      const resources = this.resources.requirements(job.resources), reason = this.resources.unavailable(resources);
      if (reason) throw new AgentError(errors.unavailable, reason);
      const queued = this.store.db.prepare("SELECT count(*) AS n FROM game_production_jobs WHERE state IN ('admitting','queued')").get() as { n: number };
      if (queued.n >= this.resources.budget.maxQueued) throw new AgentError(errors.unavailable, "The production queue is full. Wait for pending work or cancel an owned queued job.");
      const created: GameProductionJob = { ...job, resources, ...(externalAdmission ? { admission: "pending" as const } : { waitingReason: "resources" as const }),
        id: randomUUID(), state: externalAdmission ? "admitting" : "queued", createdAt: Date.now(), updatedAt: Date.now() };
      this.admission?.(reg, created);
      this.store.db.prepare("INSERT INTO game_production_jobs VALUES(?,?,?,?,?,?,?)")
        .run(created.id, namespace(reg), created.projectId, key, contentHash(input), created.state, JSON.stringify(created));
      this.event(namespace(reg), created);
      return { job: created, created: true };
    }).immediate();
  }
  private source(reg: Registration, job: GameProductionJob, signal: AbortSignal): ProductionAccess {
    const revision = this.projects.revision(reg, job.projectId, job.revision);
    if (revision.contentHash !== job.sourceHash) throw new AgentError(errors.conflict, "The saved source revision no longer matches this production job.");
    return { registration: reg, job, document: revision.document, signal, readFile: async (name) => {
      signal.throwIfAborted();
      const file = revision.document.files.find((file) => file.path === name);
      if (!file) {
        // Report only a validated project-relative name, never an arbitrary
        // host path/value supplied by a faulty installed adapter.
        const requested = gameFilePath.safeParse(name);
        throw new AgentError(errors.missing, `Source file${requested.success ? ` ${JSON.stringify(requested.data)}` : ""} not present in the pinned game revision ${job.revision}.`);
      }
      return this.blobs.read(reg, file);
    } };
  }
  async startBuild(reg: Registration, input: unknown): Promise<GameProductionJob> {
    const request = gameBuildRequest.parse(input), binding = { kind: "build", request };
    const previous = this.previous(reg, request.requestId, binding);
    if (previous) return previous;
    const revision = this.projects.revision(reg, request.projectId, request.revision);
    if (!revision.document.design || revision.document.legacy?.reviewRequired)
      throw new AgentError(errors.conflict, "Persist and review the game design before starting production.");
    const adapter = this.adapters.find((item) => item.engine === revision.document.engine && item.products.includes(reg.product));
    if (!adapter) {
      if(this.adapters.some(item=>item.engine===revision.document.engine))
        throw new AgentError(errors.forbidden,"The installed production adapter is not authorized for this product.");
      throw new AgentError(errors.unavailable, "No qualified production adapter is installed for this engine.");
    }
    this.authorize(reg, adapter);
    const probe = await adapter.probe(reg);
    if (!probe.available) throw new AgentError(errors.unavailable, this.protect(reg, probe.reason || "The required toolchain is unavailable."));
    const admitted = this.admit(reg, request.requestId, binding, { kind: "build", projectId: request.projectId,
      revision: revision.revision, sourceHash: revision.contentHash, engine: revision.document.engine, adapterId: adapter.id, toolchain: adapter.toolchain, resources: adapter.resources }, Boolean(adapter.admission));
    if (admitted.created) this.schedule(reg, admitted.job, async (job, signal) => {
      const result = await adapter.build(this.source(reg, job, signal));
      signal.throwIfAborted();
      this.publishArtifact(reg, job, result);
    }, adapter.admission);
    return this.job(reg, admitted.job.id);
  }
  async startAssets(reg: Registration,input:unknown):Promise<GameProductionJob> {
    const request=gameAssetProcessRequest.parse(input),binding={kind:"assets",request},previous=this.previous(reg,request.requestId,binding);
    if(previous)return previous;
    const revision=this.projects.revision(reg,request.projectId,request.revision),processor=this.assetProcessors.find((item)=>item.id===request.spec.processorId);
    if(!processor || !processor.operations.includes(request.spec.operation.type))throw new AgentError(errors.unavailable,"No qualified processor is installed for this media operation.");
    this.authorize(reg,processor);this.assetResults.sources(revision.document,request.spec);
    const probe=await processor.probe(reg);if(!probe.available)throw new AgentError(errors.unavailable,this.protect(reg,probe.reason??"Asset processor is unavailable."));
    const admitted=this.admit(reg,request.requestId,binding,{kind:"assets",projectId:request.projectId,revision:request.revision,sourceHash:revision.contentHash,
      engine:revision.document.engine,adapterId:processor.id,toolchain:processor.toolchain,assetSpec:request.spec,resources:processor.resources},Boolean(processor.admission));
    if(admitted.created)this.schedule(reg,admitted.job,async(job,signal)=>{
      const context=this.source(reg,job,signal),result=await processor.process({...context,spec:job.assetSpec!});signal.throwIfAborted();this.publishAssets(reg,job,result);
    },processor.admission);
    return this.job(reg,admitted.job.id);
  }
  private publishAssets(reg:Registration,job:GameProductionJob,result:ProcessedGameAsset):void {
    this.store.db.transaction(()=>{const revision=this.projects.revision(reg,job.projectId,job.revision);
      this.assetResults.publish(reg,job,revision.document,{...result,info:this.protect(reg,result.info)});this.update(reg,job,"completed");})();
  }
  inspectAssetRequest(reg:Registration,input:unknown){
    const request=gameAssetProcessRequest.parse(input);this.projects.get(reg,request.projectId);
    const binding={kind:'assets',request},previous=this.previous(reg,request.requestId,binding);
    return {requestId:request.requestId,projectId:request.projectId,revision:request.revision,requestHash:contentHash(binding),
      ...(previous?{state:'acknowledged' as const,jobId:previous.id}:{state:'missing' as const})};
  }
  applyAssets(reg:Registration,input:unknown) {
    const request=gameAssetApplyRequest.parse(input),job=this.job(reg,request.jobId),processor=this.assetProcessors.find((item)=>item.id===job.adapterId);
    if(job.kind!=="assets"||job.state!=="completed")throw new AgentError(errors.conflict,"Only acknowledged media results may be applied.");
    if(!processor)throw new AgentError(errors.unavailable,"Restore the authorized media adapter before applying its candidate.");this.authorize(reg,processor);
    return this.assetResults.apply(reg,request);
  }
  private schedule(reg: Registration, saved: GameProductionJob, perform: (job: GameProductionJob, signal: AbortSignal) => Promise<void>, admission?: GameProductionAdapter["admission"]): void {
    const controller = new AbortController();
    let started = false, admissionStarted = false, admissionConfirmed = false;
    const promise = Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      if (admission) {
        const context = this.source(reg, saved, controller.signal);
        admissionStarted = true;
        await admission.reserve(context);
        admissionConfirmed = true;
        controller.signal.throwIfAborted();
        this.update(reg, this.job(reg, saved.id), "queued", { admission: "reserved", waitingReason: "resources" });
      }
      await this.resources.acquire(saved.id, saved.resources!, controller.signal);
      controller.signal.throwIfAborted();
      const job = this.update(reg, this.job(reg, saved.id), "running", { waitingReason: undefined });
      started = true;
      await perform(job, controller.signal);
    }).catch(async (caught: unknown) => {
      let error = caught;
      if (admissionStarted && !started && admission) {
        if (error instanceof GameProductionFailure && !admissionConfirmed) {
          // The installed port acknowledged a refusal without an unknown
          // admission. Do not require a second authority call to fail safely.
        } else if (controller.signal.aborted || error instanceof GameProductionFailure) {
          try { await admission.cancel(this.source(reg, this.job(reg, saved.id), new AbortController().signal)); }
          catch { error = new GameProductionUncertain("The original production admission could not be closed. Inspect it before repeating the job."); }
        } else error = new GameProductionUncertain(error instanceof Error ? error.message : "The production admission needs inspection.");
      }
      const current = this.job(reg, saved.id);
      const cancelled = controller.signal.aborted && (error === controller.signal.reason || error instanceof GameProductionFailure);
      if (!gameProductionTerminal.has(current.state)) this.update(reg, current,
        error instanceof GameProductionUncertain ? "awaiting_reconciliation" : !started ? (controller.signal.aborted ? "cancelled" : "failed") : cancelled ? "cancelled" : error instanceof GameProductionFailure ? "failed" : "awaiting_reconciliation", {
        error: this.protect(reg, error instanceof Error ? error.message : "Game production failed."),
        waitingReason: undefined,
      });
      if (this.job(reg, saved.id).state === "awaiting_reconciliation") this.resources.hold(saved.id, saved.resources);
    }).finally(async () => {
      const current = this.job(reg, saved.id);
      if (started && current.kind === "build" && gameProductionTerminal.has(current.state)) {
        // Receipt/candidate cleanup cannot undo a committed artifact or retry an effect.
        try { await this.adapters.find((item) => item.id === current.adapterId)?.dispose?.(this.source(reg, current, new AbortController().signal)); } catch { /* Retain the cache for administrative cleanup. */ }
      }
      if (started && current.kind === "validate" && gameProductionTerminal.has(current.state)) {
        try { await this.collectors.find((item) => item.id === current.adapterId)?.dispose?.(this.validationContext(reg, current, new AbortController().signal)); } catch { /* Retain the candidate; never undo an acknowledged report. */ }
      }
      if (started && current.kind === "assets" && gameProductionTerminal.has(current.state)) {
        try { await this.assetProcessors.find((item) => item.id === current.adapterId)?.dispose?.({...this.source(reg,current,new AbortController().signal),spec:current.assetSpec!}); } catch { /* Preserve private recovery cache if cleanup cannot be verified. */ }
      }
      this.tasks.delete(saved.id);
      // An unknown external effect still consumes its reservation until inspection.
      if (gameProductionTerminal.has(this.job(reg, saved.id).state)) this.resources.release(saved.id);
    });
    this.tasks.set(saved.id, { controller, promise });
    void promise.catch(() => {});
  }
  private publishArtifact(reg: Registration, job: GameProductionJob, result: ProducedGameArtifact): void {
    gameFilePath.parse(result.entrypoint);
    if (!result.entrypoint.endsWith(".html") || !result.files.length || result.files.length > 20000)
      throw new AgentError(errors.invalid, "A web game requires an HTML entrypoint and a bounded complete artifact.");
    const names = new Set<string>(); let bytes = 0;
    for (const file of result.files) {
      gameFilePath.parse(file.path);
      if (!(file.data instanceof Uint8Array)) throw new AgentError(errors.invalid, "Produced game files must contain binary data.");
      bytes += file.data.byteLength;
      if (names.has(file.path.toLocaleLowerCase("en-US")) || bytes > 256 * 1024 * 1024)
        throw new AgentError(errors.invalid, "Produced game contains duplicate paths or exceeds its artifact limit.");
      names.add(file.path.toLocaleLowerCase("en-US"));
    }
    if (!result.files.some((file) => file.path === result.entrypoint)) throw new AgentError(errors.invalid, "The produced HTML entrypoint is missing.");
    const conflict = gameFileTreeConflict(result.files.map((file) => file.path));
    if (conflict) throw new AgentError(errors.invalid, conflict.message);
    this.store.db.transaction(() => {
      const files = this.blobs.store(reg, result.files);
      const artifact = gameArtifact.parse({ id: randomUUID(), jobId: job.id, projectId: job.projectId,
        revision: job.revision, sourceHash: job.sourceHash, engine: job.engine, adapterId: job.adapterId,
        toolchain: job.toolchain, entrypoint: result.entrypoint, files,
        artifactHash: contentHash({ sourceHash: job.sourceHash, engine: job.engine, toolchain: job.toolchain,
          entrypoint: result.entrypoint, files: files.map(({ transferId: _id, ...file }) => file) }), createdAt: Date.now() });
      this.store.db.prepare("INSERT INTO game_artifacts VALUES(?,?,?,?)").run(artifact.id, namespace(reg), job.id, JSON.stringify(artifact));
      for (const file of files) this.store.db.prepare("INSERT INTO game_artifact_files VALUES(?,?,?)").run(artifact.id, file.transferId, file.path);
      this.update(reg, job, "completed", { artifactId: artifact.id });
    })();
  }
  private validationContext(reg: Registration, job: GameProductionJob, signal: AbortSignal) {
    const source = this.source(reg, job, signal), artifact = this.artifact(reg, job.buildId!);
    return { ...source, artifact, readFile: async (name: string) => {
      signal.throwIfAborted();
      const file = artifact.files.find((file) => file.path === name);
      if (!file) throw new AgentError(errors.missing, "Validation file is not in the pinned build artifact.");
      return this.blobs.read(reg, file);
    } };
  }
  /** Read-only target check shared by consent preflight and actual admission.
   * It never invokes probe/admission/validate or acknowledges unknown effects. */
  preflightValidation(reg: Registration, request: Pick<z.infer<typeof gameValidationRequest>, "buildId" | "collectorId" | "testSuite">): void {
    this.validationTarget(reg, request);
  }
  private validationTarget(reg: Registration, request: Pick<z.infer<typeof gameValidationRequest>, "buildId" | "collectorId" | "testSuite">) {
    let build: GameProductionJob;
    try { build = this.job(reg, request.buildId); }
    catch (error) {
      if (error instanceof AgentError && error.code === errors.missing)
        throw new AgentError(errors.missing, "Build not found in this namespace. Read game_jobs for actual project build IDs; never invent an ID.");
      throw error;
    }
    if (build.kind !== "build" || build.state !== "completed") throw new AgentError(errors.conflict, "Validation requires an acknowledged completed build.");
    const artifact = this.artifact(reg, build.id);
    const collector = this.collectors.find((item) => item.id === request.collectorId && item.engines.includes(build.engine));
    if (!collector) throw new AgentError(errors.unavailable, "This validation collector is not installed for the selected engine.");
    this.authorize(reg, collector);
    if (collector.testSuiteFormat === "browser-v1") {
      const path = request.testSuite ?? "data/playtests.json", file = artifact.files.find(file => file.path === path);
      if (!file && request.testSuite) throw new AgentError(errors.missing, "The requested test suite is not packaged in this exact build. Build the revision containing it before validation.");
      // No explicit/default recipe means the collector may still observe boot.
      // Inspect immutable build bytes and that build's design, never the latest source.
      if (file) {
        const result = gameBrowserRecipeSizeCheck(file.size) ?? checkGameBrowserRecipe(this.blobs.read(reg, file),
          this.projects.revision(reg, build.projectId, build.revision).document.design?.playtests ?? []);
        if (!result.valid) throw new AgentError(errors.invalid, gameBrowserRecipeFailureMessage(result));
      }
    }
    return { build, collector };
  }
  async startValidation(reg: Registration, input: unknown): Promise<GameProductionJob> {
    const request = gameValidationRequest.parse(input), binding = { kind: "validate", request };
    const previous = this.previous(reg, request.requestId, binding);
    if (previous) return previous;
    const { build, collector } = this.validationTarget(reg, request);
    if (collector.probe) {
      const probe = await collector.probe(reg);
      if (!probe.available) throw new AgentError(errors.unavailable, this.protect(reg, probe.reason ?? "The installed collector is unavailable."));
    }
    const admitted = this.admit(reg, request.requestId, binding, { kind: "validate", projectId: build.projectId,
      revision: build.revision, sourceHash: build.sourceHash, engine: build.engine, adapterId: collector.id,
      toolchain: collector.toolchain, resources: collector.resources, buildId: build.id, ...(request.testSuite ? { testSuite: request.testSuite } : {}) }, Boolean(collector.admission));
    if (admitted.created) this.schedule(reg, admitted.job, async (job, signal) => {
      const result = await collector.validate(this.validationContext(reg, job, signal));
      signal.throwIfAborted(); this.publishReports(reg, job, collector, result);
    }, collector.admission ? {
      reserve: context => collector.admission!.reserve(this.validationContext(reg, context.job, context.signal)),
      cancel: context => collector.admission!.cancel(this.validationContext(reg, context.job, context.signal)),
    } : undefined);
    return this.job(reg, admitted.job.id);
  }
  private publishReports(reg: Registration, job: GameProductionJob, collector: GameValidationCollector, input: CollectedGameObservation[]): void {
    const observations = z.array(gameObservation).min(1).max(100).parse(this.protect(reg, input.map(({ evidenceFiles: _files, ...observation }) => observation)));
    if (observations.some((report) => !collector.categories.includes(report.category)))
      throw new AgentError(errors.forbidden, "Collector cannot certify a category outside its installed authority.");
    const artifact = this.artifact(reg, job.buildId!);
    let bytes = 0, count = 0;
    for (const observation of input) {
      const paths = new Set<string>();
      for (const file of observation.evidenceFiles ?? []) {
        gameFilePath.parse(file.path);
        if (!(file.data instanceof Uint8Array) || paths.has(file.path.toLocaleLowerCase("en-US"))) throw new AgentError(errors.invalid, "Collector evidence requires unique portable paths and binary file content.");
        paths.add(file.path.toLocaleLowerCase("en-US")); bytes += file.data.byteLength; count++;
        if (bytes > 256 * 1024 * 1024 || count > 2000) throw new AgentError(errors.invalid, "Collector evidence exceeded its bounded storage budget.");
      }
      const conflict = gameFileTreeConflict((observation.evidenceFiles ?? []).map((file) => file.path));
      if (conflict) throw new AgentError(errors.invalid, conflict.message);
    }
    this.store.db.transaction(() => {
      const reports = observations.map((report, index): GameValidationReport => ({ ...report, id: randomUUID(), jobId: job.id,
        buildId: artifact.jobId, projectId: job.projectId, revision: job.revision, sourceHash: job.sourceHash,
        artifactHash: artifact.artifactHash, collectorId: collector.id, toolchain: collector.toolchain, createdAt: Date.now(),
        ...(input[index]!.evidenceFiles?.length ? { evidence: this.blobs.store(reg, input[index]!.evidenceFiles!) } : {}) }));
      for (const report of reports) {
        this.store.db.prepare("INSERT INTO game_validation_reports VALUES(?,?,?,?)").run(report.id, namespace(reg), artifact.jobId, JSON.stringify(report));
        for (const file of report.evidence ?? []) this.store.db.prepare("INSERT INTO game_report_files VALUES(?,?,?)").run(report.id, file.transferId, file.path);
      }
      this.update(reg, job, "completed", { reportIds: reports.map((report) => report.id) });
    })();
  }
  report(reg: Registration, reportId: string): GameValidationReport {
    const row = this.store.db.prepare("SELECT value FROM game_validation_reports WHERE namespace=? AND id=?").get(namespace(reg), reportId) as Row | undefined;
    if (!row) throw new AgentError(errors.missing, "Validation report not found in this namespace.");
    return JSON.parse(row.value) as GameValidationReport;
  }
  reportFile(reg: Registration, reportId: string, path: string) {
    const report = this.report(reg, reportId);
    const file = report.evidence?.find((file) => file.path === path);
    if (!file) throw new AgentError(errors.missing, "Evidence file does not belong to this report.");
    return file;
  }
  reports(reg: Registration, buildId: string): GameValidationReport[] {
    this.job(reg, buildId);
    return (this.store.db.prepare("SELECT value FROM game_validation_reports WHERE namespace=? AND build=? ORDER BY rowid").all(namespace(reg), buildId) as Row[])
      .map((row) => JSON.parse(row.value) as GameValidationReport);
  }
  reportPage(reg: Registration, buildId: string, cursor: number, limit: number) {
    this.job(reg, buildId);
    const total = (this.store.db.prepare("SELECT count(*) AS n FROM game_validation_reports WHERE namespace=? AND build=?").get(namespace(reg), buildId) as { n: number }).n;
    const rows = this.store.db.prepare("SELECT value FROM game_validation_reports WHERE namespace=? AND build=? ORDER BY rowid LIMIT ? OFFSET ?").all(namespace(reg), buildId, limit, cursor) as Row[];
    return { reports: rows.map(row => JSON.parse(row.value) as GameValidationReport), total };
  }
  quality(reg: Registration, projectId: string, revisionNumber?: number) {
    const project = this.projects.get(reg, projectId), revision = this.projects.revision(reg, projectId, revisionNumber);
    const row = this.store.db.prepare("SELECT value FROM game_artifacts WHERE namespace=? AND json_extract(value,'$.projectId')=? AND json_extract(value,'$.revision')=? ORDER BY rowid DESC LIMIT 1")
      .get(namespace(reg), projectId, revision.revision) as Row | undefined;
    const artifact = row ? gameArtifact.parse(JSON.parse(row.value)) : null;
    const reports = artifact ? this.reports(reg, artifact.jobId).filter((report) =>
      this.collectors.some((collector) => collector.id === report.collectorId && contentHash(collector.toolchain) === contentHash(report.toolchain) &&
        collector.products.includes(reg.product) && collector.engines.includes(artifact.engine) && collector.categories.includes(report.category))) : [];
    return assessGameQuality(project, revision, artifact, reports);
  }
  cancel(reg: Registration, id: string): GameProductionJob {
    const job = this.job(reg, id);
    if (gameProductionTerminal.has(job.state)) return job;
    const task = this.tasks.get(id);
    if (!task || job.state === "awaiting_reconciliation") throw new AgentError(errors.reconciliation, "Inspect the interrupted operation before cancelling or repeating it.");
    const cancelling = this.update(reg, job, "cancelling", { waitingReason: undefined }); task.controller.abort();
    return cancelling;
  }
  reconcile(reg: Registration, id: string): Promise<GameProductionJob> {
    if (this.closing) return Promise.reject(new AgentError(errors.unavailable, "Game production is stopping."));
    const pending = this.inspections.get(id);
    if (pending) { this.job(reg, id); return pending.promise; }
    const controller = new AbortController();
    const promise = this.inspect(reg, id, controller.signal).finally(() => {
      this.inspections.delete(id);
      if (!this.tasks.has(id) && gameProductionTerminal.has(this.job(reg, id).state)) this.resources.release(id);
    });
    this.inspections.set(id, { controller, promise });
    return promise;
  }
  private async inspect(reg: Registration, id: string, signal: AbortSignal): Promise<GameProductionJob> {
    const job = this.job(reg, id);
    if (gameProductionTerminal.has(job.state)) return job;
    if (job.state !== "awaiting_reconciliation") throw new AgentError(errors.conflict, "Only interrupted unknown operations can be reconciled.");
    if (job.kind === "build") {
      const adapter = this.adapters.find((item) => item.id === job.adapterId && item.engine === job.engine && contentHash(item.toolchain) === contentHash(job.toolchain));
      if (!adapter?.reconcile) throw new AgentError(errors.unavailable, "Restore the original build inspector before reconciling this operation.");
      this.authorize(reg, adapter);
      const result = await adapter.reconcile(this.source(reg, job, signal));
      signal.throwIfAborted();
      if (result.state === "completed") this.publishArtifact(reg, job, result.result);
      else if (result.state === "missing") this.update(reg, job, "failed", { error: this.protect(reg, result.detail) });
      if (gameProductionTerminal.has(this.job(reg, id).state)) {
        try { await adapter.dispose?.(this.source(reg, this.job(reg, id), new AbortController().signal)); } catch { /* A committed result is not rolled back by cache cleanup. */ }
      }
    } else if(job.kind === "assets") {
      const processor=this.assetProcessors.find((item)=>item.id===job.adapterId&&contentHash(item.toolchain)===contentHash(job.toolchain));
      if(!processor?.reconcile)throw new AgentError(errors.unavailable,"Restore the original media inspector before reconciling this operation.");
      this.authorize(reg,processor);
      const result=await processor.reconcile({...this.source(reg,job,signal),spec:job.assetSpec!});signal.throwIfAborted();
      if(result.state==="completed")this.publishAssets(reg,job,result.result);
      else if(result.state==="missing")this.update(reg,job,"failed",{error:this.protect(reg,result.detail)});
      if(gameProductionTerminal.has(this.job(reg,id).state))try{await processor.dispose?.({...this.source(reg,this.job(reg,id),new AbortController().signal),spec:job.assetSpec!});}catch{ /* Terminal result remains committed; retain cache for explicit maintenance. */ }
    } else {
      const collector = this.collectors.find((item) => item.id === job.adapterId && item.engines.includes(job.engine) && contentHash(item.toolchain) === contentHash(job.toolchain));
      if (!collector?.reconcile) throw new AgentError(errors.unavailable, "Restore the original observation inspector before reconciling this operation.");
      this.authorize(reg, collector);
      const result = await collector.reconcile(this.validationContext(reg, job, signal));
      signal.throwIfAborted();
      if (result.state === "completed") this.publishReports(reg, job, collector, result.result);
      else if (result.state === "missing") this.update(reg, job, "failed", { error: this.protect(reg, result.detail) });
      if (gameProductionTerminal.has(this.job(reg, id).state)) {
        try { await collector.dispose?.(this.validationContext(reg, this.job(reg, id), new AbortController().signal)); } catch { /* Retain only this operation's cache for later maintenance. */ }
      }
    }
    return this.job(reg, id);
  }
  close(): Promise<void> {
    if (this.closingTask) return this.closingTask;
    this.closing = true;
    for (const [id, task] of this.tasks) {
      const row = this.store.db.prepare("SELECT value FROM game_production_jobs WHERE id=?").get(id) as Row;
      const job = JSON.parse(row.value) as GameProductionJob;
      if (!gameProductionTerminal.has(job.state)) {
        const next = { ...job, state: "cancelling" as const, updatedAt: Date.now() }; this.write(next);
      }
      task.controller.abort();
    }
    for (const inspection of this.inspections.values()) inspection.controller.abort();
    this.closingTask = Promise.allSettled([...this.tasks.values()].map((task) => task.promise).concat(
      [...this.inspections.values()].map((inspection) => inspection.promise.then(() => {})),
    )).then(() => {});
    return this.closingTask;
  }
}
