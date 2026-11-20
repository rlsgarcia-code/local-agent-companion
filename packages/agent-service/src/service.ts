import {contextWorkingBudget,type ModelContextWindows} from '../../contracts/src/model-context';
import { createHash, randomUUID } from "node:crypto";
import type { InstalledAdapter, InstalledToolInvocation, InstalledToolReconciliation } from "../../agent-core/src/installed-adapter";
import { AsyncLocalStorage } from "node:async_hooks";
import { contentHash, canonical } from "../../contracts/src/identity";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {
  executeGraph,
  validateProvider,
  type ExecutionContext,
} from "../../agent-core/src/index";
import {
  AgentError,
  ENGINE_VERSION,
  engineCapabilities,
  errors,
  identifier,
  installedToolInspection,
  NODE_VERSION,
  PROTOCOL_VERSION,
  negotiate,
  runSpec,
  modelAssistance,
  providerSpec,
  terminalStates,
  type Registration,
  type EngineUpdateBlockers,
  type Run,
  type RunSpec,
  type SessionSnapshot,
  type ToolSpec,
} from "../../contracts/src/index";
import { namespace } from "./security";
import { Store } from "./store";
import { Transfers } from "./transfers";
import { Goals } from "./goals";
import { workspaceToolResult } from "../../contracts/src/workspace-receipts";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { assistModel } from "../../agent-core/src/model-assistance";
import { ProviderModels } from "../../agent-core/src/provider-models";
import { ModelTransportError } from "../../agent-core/src/model-failure";
import { message } from "../../contracts/src/index";
import { WorkspaceProcesses } from "./workspace-processes";
import { CredentialVault } from "./credentials";
import { ProductMemory } from "./memory";
import { Models } from "./models";
import { SemanticProjectMemory } from "../../agent-core/src/semantic-memory";
import { memoryRead, memoryWrite } from "../../contracts/src/memory";
import { goalCreate, goalEdit, goalRecord, goalEvaluation } from "../../contracts/src/goals";
import { transferBegin, transferAppend, sessionImport, TRANSFER_CHUNK_BYTES } from "../../contracts/src/transfers";
import { OllamaDesktopRuntime } from "../../agent-core/src/desktop-runtime";
import { desktopRunSpec } from "../../contracts/src/desktop";
import { GameProjects } from "./game-projects";
import { gameProjectCreate, gameProjectRead, gameProjectList, gameRevisionRead, gameRevisionsList,
  gameRevisionCommit, gameMutationInspect, gameEventsRead, gameFileRead, gameProjectImport } from "../../contracts/src/games";
import { convertLegacyGameDesign } from "../../game-design/src/project";
import { GameProduction } from "./game-production";
import { GamePlaytests } from "./game-playtests";
import { gamePlaytestCreate, gamePlaytestRecord, gamePlaytestWithdraw,gamePlaytestCorrect } from "../../contracts/src/game-playtests";
import { GameWorkflows } from "./game-workflows";
import { gameWorkflowRead, gameWorkflowAdvance, gameWorkflowContinue, gameWorkflowReopen, gameWorkflowEvents, type GameWorkflowPolicy } from "../../contracts/src/game-workflow";
import type { GameProductionAdapter, GameValidationCollector, GameBlobAccess, GameAssetProcessor } from "../../game-production/src/index";
import { gameAssetProcessRequest, gameAssetApplyRequest } from "../../contracts/src/game-assets";
import { GameAgentTools, GAME_AGENT_TOOLS, gameAgentDefinition } from "./game-agent-tools";
import type { GameAgentPort } from "../../agent-core/src/game-production-profile";
import { InferenceBudgets } from "./inference-budgets";
import type { InferenceBudgetPort } from "../../agent-core/src/inference-budget";
import type { InferenceBudgetPolicy, InferenceBudgetScope } from "../../contracts/src/inference-budget";
import { gameBuildRequest, gameValidationRequest, gameProductionRead, gameProductionList, gameProductionEvents, gameArtifactFileRead, type GameProductionBudget } from "../../contracts/src/game-production";

type DesktopSpec = { profile: "desktop"; spec: z.infer<typeof desktopRunSpec> };
type DurableSpec = RunSpec | DesktopSpec;

type Pending = {
  reg: Registration;
  run: string;
  session: string;
  kind: "approval" | "tool";
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  delivered?: string;
  payload: unknown;
};
export type GraphExecutor = (
  spec: RunSpec,
  context: ExecutionContext,
) => Promise<unknown>;
export class AgentService {
  private readonly running = new Map<string, AbortController>();
  private readonly runningTasks = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, Pending>();
  private readonly workspaceProcesses=new WorkspaceProcesses();
  private readonly credentials = new CredentialVault();
  private readonly checkpointers = new Map<string, SqliteSaver>();
  private readonly operationScope = new AsyncLocalStorage<string>();
  private closed = false;
  private closing?: Promise<void>;
  private quiescing = false;
  private recovered = false;
  private readonly transfers: Transfers;
  private readonly goals: Goals;
  private readonly memory: ProductMemory;
  private readonly models: Models;
  private readonly games: GameProjects;
  private readonly gameProduction: GameProduction;
  private readonly gamePlaytests: GamePlaytests;
  private readonly gameWorkflows: GameWorkflows;
  private readonly gameAgent: GameAgentTools;
  private readonly inferenceBudgets: InferenceBudgets;
  private readonly contextWorkingBudget?:import('../../contracts/src/model-context').ContextWorkingBudget;
  private readonly desktopRuntimes = new Map<string, OllamaDesktopRuntime>();
  private readonly semanticMemory = new Map<string, SemanticProjectMemory>();
  private readonly modelTasks = new Map<string, {controller:AbortController;promise:Promise<unknown>}>();
  private readonly toolInspections = new Map<string, {controller:AbortController;promise:Promise<InstalledToolReconciliation>}>();
  private readonly advisors = new Map<string, AbortController>();
  constructor(
    readonly store: Store,
    readonly directory: string,
    private readonly executor: GraphExecutor = executeGraph,
    private readonly buildInfo: {
      commit?: string;
      target?: string;
      manifestSha256?: string;
    } = {},
    private readonly options: { deferRecovery?: boolean; adapter?: InstalledAdapter; resourceDirectory?: string;
      gameAdapters?: readonly GameProductionAdapter[]; gameCollectors?: readonly GameValidationCollector[]; gameAssetProcessors?: readonly GameAssetProcessor[];
      gameResourceBudget?: GameProductionBudget; gameWorkflowPolicy?: GameWorkflowPolicy; inferenceBudgetPolicy?: InferenceBudgetPolicy;
      contextWorkingBudget?:import('../../contracts/src/model-context').ContextWorkingBudget } = {},
  ) {
    this.transfers = new Transfers(store);
    this.goals = new Goals(store);
    this.memory = new ProductMemory(store);
    this.models = new Models(store, directory);
    this.games = new GameProjects(store, (reg, file) => {
      const transfer = this.transfers.get(reg, file.transferId);
      if (!transfer.committed || transfer.sha256 !== file.sha256 || transfer.size !== file.size ||
          (transfer.mime !== "application/octet-stream" && transfer.mime !== file.mime))
        throw new AgentError(errors.invalid, "Game file requires a verified blob with matching size, SHA-256 and media type.");
    });
    const gameBlobs: GameBlobAccess = {
      read: (reg, file) => {
        const transfer = this.transfers.get(reg, file.transferId);
        if (transfer.sha256 !== file.sha256 || transfer.size !== file.size) throw new AgentError(errors.invalid, "Game blob differs from the pinned file reference.");
        return this.transfers.bytes(reg, file.transferId);
      },
      store: (reg, files) => files.map((file) => {
        const data = Buffer.from(file.data);
        if (this.secrets(reg).some((secret) => data.includes(Buffer.from(secret)) || data.includes(Buffer.from(JSON.stringify(secret).slice(1, -1)))))
          throw new AgentError(errors.forbidden, "Provider credentials cannot be embedded in game artifacts.");
        const sha256 = createHash("sha256").update(data).digest("hex");
        const transfer = this.transfers.begin(reg, transferBegin.parse({ key: `game-artifact:${sha256}`, size: data.length, sha256, mime: "application/octet-stream" }));
        for (let offset = transfer.received; offset < data.length; offset += TRANSFER_CHUNK_BYTES)
          this.transfers.append(reg, transfer.id, offset, data.subarray(offset, offset + TRANSFER_CHUNK_BYTES));
        this.transfers.commit(reg, transfer.id);
        return { path: file.path, mime: file.mime, sha256, size: data.length, transferId: transfer.id };
      }),
    };
    this.gameWorkflows = new GameWorkflows(store, this.games, (reg, id) => this.gameProduction.quality(reg, id), options.gameWorkflowPolicy);
    this.gameProduction = new GameProduction(store, this.games, gameBlobs, [...(options.gameAdapters ?? []),...(options.adapter?.gameAdapters ?? [])], [...(options.gameCollectors ?? []),...(options.adapter?.gameValidationCollectors ?? [])], (reg, value) => this.protect(reg, value), [...(options.gameAssetProcessors ?? []),...(options.adapter?.gameAssetProcessors ?? [])], options.gameResourceBudget, (reg, job) => { if (reg.product !== "kidos") this.gameWorkflows.reserve(reg, job); });
    this.gamePlaytests = new GamePlaytests(store, this.games, this.gameProduction);
    this.gameAgent = new GameAgentTools(store, this.games, this.gameProduction, gameBlobs, this.gameWorkflows);
    this.inferenceBudgets = new InferenceBudgets(store, options.inferenceBudgetPolicy);
    this.contextWorkingBudget=options.contextWorkingBudget===undefined?undefined:contextWorkingBudget.parse(options.contextWorkingBudget);
    store.encodeEvent = (reg, data) => {
      const safe = this.protect(reg, data);
      return Buffer.byteLength(JSON.stringify(safe)) <= 512 * 1024 ? safe
        : { kind: "agent-event-transfer", ...this.persistTransfer(reg, "event", safe) };
    };
    if (!options.deferRecovery) this.recover();
  }
  recover(): void {
    if (this.recovered) return;
    this.store.recover();
    this.models.recover();
    this.gameProduction.recover();
    this.inferenceBudgets.recover();
    this.recovered = true;
  }
  private checkpoint(reg: Registration): SqliteSaver {
    const ns = namespace(reg);
    let saver = this.checkpointers.get(ns);
    if (!saver) {
      const directory = path.join(this.directory, "namespaces", ns);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite"));
      const official = saver.serde;
      saver.serde = {
        dumpsTyped: async (value: unknown) => {
          const [format, encoded] = await official.dumpsTyped(value);
          if (format === "json") {
            const safe = this.protect(reg, JSON.parse(new TextDecoder().decode(encoded)));
            return [format, new TextEncoder().encode(JSON.stringify(safe))];
          }
          for (const secret of this.secrets(reg))
            if (Buffer.from(encoded).includes(Buffer.from(secret)))
              throw new AgentError(errors.forbidden, "A credential cannot be persisted in binary graph state.");
          return [format, encoded];
        },
        loadsTyped: (format, encoded) => official.loadsTyped(format, encoded),
      };
      if (process.platform !== "win32")
        chmodSync(path.join(directory, "graph.sqlite"), 0o600);
      this.checkpointers.set(ns, saver);
    }
    return saver;
  }
  private desktop(reg: Registration): OllamaDesktopRuntime {
    if (reg.product !== "companion-mac")
      throw new AgentError(
        errors.forbidden,
        "Desktop adapter belongs to the Mac product.",
      );
    const ns = namespace(reg);
    let runtime = this.desktopRuntimes.get(ns);
    if (!runtime) {
      runtime = new OllamaDesktopRuntime(this.checkpoint(reg));
      this.desktopRuntimes.set(ns, runtime);
    }
    return runtime;
  }
  private emit(
    reg: Registration,
    session: string,
    run: string,
    type: string,
    data: unknown,
  ): void {
    if (this.closed) return;
    // Leased secrets must not reach event/history persistence, even through provider errors.
    this.store.append(reg, session, type, this.protect(reg, data), run);
  }
  private protect<T>(reg: Registration, value: T, additionalSecrets: string[] = []): T {
    const secrets = [...this.secrets(reg),...additionalSecrets].flatMap((secret) =>
      secret ? [secret, JSON.stringify(secret).slice(1, -1)] : [],
    );
    return JSON.parse(
      JSON.stringify(value ?? null, (_key, item) =>
        typeof item === "string"
          ? secrets.reduce(
              (text, secret) =>
                text.split(secret).join("[credential redacted]"),
              item,
            )
          : item,
      ),
    ) as T;
  }
  private secrets(reg: Registration): string[] { return this.credentials.secrets(reg); }
  private gameInput<T>(reg: Registration, input: unknown, schema: z.ZodType<T>): T {
    const envelope = z.object({ requestTransferId: identifier }).strict().safeParse(input);
    const request = envelope.success ? this.transfers.json(reg, envelope.data.requestTransferId) : input;
    this.assertToolArguments(reg, request);
    return schema.parse(request);
  }
  private assertToolArguments(reg: Registration, input: unknown): void {
    const encoded = JSON.stringify(input ?? null);
    if (this.secrets(reg).some((secret) => encoded.includes(JSON.stringify(secret).slice(1, -1))))
      throw new AgentError(errors.forbidden, "Provider credentials cannot be passed as tool arguments. Use an approved host credential reference.");
  }
  private validateRun(reg: Registration, spec: DurableSpec): void {
    if ("profile" in spec) {
      if (reg.product !== "companion-mac" || spec.spec.workspacePath !== reg.workspace)
        throw new AgentError(errors.forbidden, "Desktop profile does not match this installed client.");
      if (spec.spec.provider) validateProvider(reg, spec.spec.provider);
      return;
    }
    validateProvider(reg, spec.provider);
    if (reg.product === "kidos") this.options.adapter?.validate(reg, spec);
    for (const definition of spec.tools) {
      if (gameAgentDefinition(definition.name) || definition.host === "service-game")
        throw new AgentError(errors.forbidden, "Game tools come from the installed service catalog, not client declarations.");
      const installed = reg.toolCatalog?.find((tool) => tool.name === definition.name);
      if (!installed || canonical(installed) !== canonical(definition))
        throw new AgentError(errors.forbidden, "Tool definition must match the installed adapter catalog.");
    }
  }
  private engineUpdateBlockers(): EngineUpdateBlockers {
    const row = this.store.db.prepare(
      "SELECT COUNT(*) AS count FROM runs WHERE state NOT IN ('completed','failed','cancelled')",
    ).get() as { count: number };
    return {
      activeRuns: Math.max(Number(row.count) || 0, this.running.size),
      ...(this.gameProduction.busy ? { gameOperations: 1 } : {}),
      ...(this.toolInspections.size ? { toolInspections: this.toolInspections.size } : {}),
      managedProcesses: this.workspaceProcesses.runningCount,
      modelOperations: this.advisors.size + this.modelTasks.size + (this.models.busy ? 1 : 0),
      desktopResources: [...this.desktopRuntimes.values()].filter((runtime) => runtime.hasActiveResources).length,
    };
  }
  private readRun(reg: Registration, id: string): Run {
    const run = this.store.run(reg, id);
    if(!this.running.has(id)&&!terminalStates.has(run.state)&&this.hasPendingInference(reg,run))
      return {...run,state:"awaiting_reconciliation",waitingFor:"protected-inference",error:"Uma chamada de IA anterior ainda precisa de confirmação pela autoridade."};
    if (run.state === "running" && !this.running.has(id)) {
      const unknown = this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1").get(id);
      return { ...run, state: unknown ? "awaiting_reconciliation" : "awaiting_host",
        error: "The coordinator stopped before saving the final state. Reconnect or reconcile the saved operation receipts." };
    }
    return run;
  }
  private runSummary(reg: Registration, id: string): Run {
    const { result, ...run } = this.readRun(reg, id);
    return { ...run, resultAvailable: result !== undefined };
  }
  async dispatch(
    reg: Registration,
    method: string,
    params: unknown,
    connection: string,
  ): Promise<unknown> {
    if (this.closed) throw new AgentError(errors.unavailable, "The local engine is stopping; reconnect before continuing.");
    if (this.quiescing && !["engine.info","engine.updateStatus","engine.resumeAfterUpdate","engine.shutdownIfIdle","engine.quiesceIfIdle","engine.stopManagedResourcesForUpdate","workspace.status","sessions.list","sessions.export","transfers.get","transfers.read"].includes(method))
      throw new AgentError(errors.unavailable, "Engine is activating a prepared update. Reconnect with the updated client.");
    if(process.platform === "linux" && existsSync("/usr/share/kidos/engine-activation.json") &&
      ["runs.start","desktop.start","runs.resume","engine.resumeAfterUpdate","games.builds.start","games.validation.start","games.production.reconcile"].includes(method))
      throw new AgentError(errors.unavailable,"A verified machine update is activating. Existing work was preserved; reconnect after it completes.");
    // Scope comes exclusively from the authenticated immutable registration.
    if (method.startsWith("games.workflows.") && reg.product === "kidos") throw new AgentError(errors.forbidden, "KidOS production stages and budgets require their protected Core integration.");
    const p = params ?? {};
    switch (method) {
      case "inference.budgets.get": {
        if (reg.product === "kidos") throw new AgentError(errors.forbidden, "KidOS inference policy requires its protected adapter integration.");
        const { sessionId } = z.object({ sessionId: identifier }).strict().parse(p);
        return this.inferenceBudgets.snapshot(reg, this.inferenceScopes(reg, sessionId));
      }
      case "inference.inspect": {
        const {runId}=z.object({runId:identifier}).strict().parse(p);
        if(reg.product!=="kidos"||!this.options.adapter?.reconcileInference)
          throw new AgentError(errors.forbidden,"Protected inference requires its installed inspection adapter.");
        const run=this.store.run(reg,runId);
        if(this.running.has(runId)||!["awaiting_reconciliation","awaiting_host"].includes(run.state))
          throw new AgentError(errors.conflict,"Wait until this provider execution has stopped before inspecting it.");
        const key=`inference:${namespace(reg)}:${runId}`;let inspection=this.toolInspections.get(key);
        if(!inspection){
          const controller=new AbortController();
          const promise=Promise.resolve().then(()=>this.options.adapter!.reconcileInference!(reg,this.installedInferenceContext(reg,run),controller.signal))
            .then(value=>z.union([z.object({state:z.literal("known"),result:z.unknown()}).strict(),z.object({state:z.literal("unknown")}).strict(),z.object({state:z.literal("unsupported")}).strict()]).parse(value))
            .finally(()=>this.toolInspections.delete(key));
          inspection={controller,promise};this.toolInspections.set(key,inspection);
        }
        const result=await inspection.promise;
        if(this.closed)throw new AgentError(errors.reconciliation,"The service stopped; preserve the original provider receipt.");
        const unknown=result.state!=="known"||this.hasPendingInference(reg,run)||Boolean(this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1").get(runId));
        const cancelled=this.store.receipt(reg,`private:${runId}:protected-inference-cancel`)?.value===true;
        this.store.updateRun(reg,runId,unknown?"awaiting_reconciliation":cancelled?"cancelled":"awaiting_host");
        return this.readRun(reg,runId);
      }
      case "games.workflows.get": {
        const request = gameWorkflowRead.parse(p);
        return this.persistTransfer(reg, "game-workflow", this.gameWorkflows.snapshot(reg, request.projectId));
      }
      case "games.workflows.advance": return this.gameWorkflows.advance(reg, this.gameInput(reg, p, gameWorkflowAdvance));
      case "games.workflows.continue": return this.gameWorkflows.continue(reg, this.gameInput(reg, p, gameWorkflowContinue));
      case "games.workflows.reopen": return this.gameWorkflows.reopen(reg, this.gameInput(reg, p, gameWorkflowReopen));
      case "games.workflows.events": {
        const request = gameWorkflowEvents.parse(p);
        return this.persistTransfer(reg, "game-workflow-events", this.gameWorkflows.events(reg, request.projectId, request.cursor, request.limit, request.until));
      }
      case "games.production.capabilities":
        z.object({}).strict().parse(p);
        return this.gameProduction.capabilities(reg);
      case "games.projects.linked": {
        const { sessionId } = z.object({ sessionId: identifier }).strict().parse(p);
        return this.gameAgent.linked(reg, sessionId);
      }
      case "games.projects.select": {
        const { sessionId, projectId } = z.object({ sessionId: identifier, projectId: identifier }).strict().parse(p);
        if (this.store.runs(reg, sessionId).some((run) => !terminalStates.has(run.state)))
          throw new AgentError(errors.conflict, "Wait for the active conversation run before changing its game project.");
        return this.gameAgent.select(reg, sessionId, projectId);
      }
      case "games.builds.start":
        return this.gameProduction.startBuild(reg, this.gameInput(reg, p, gameBuildRequest));
      case "games.assets.process":
        return this.gameProduction.startAssets(reg, this.gameInput(reg,p,gameAssetProcessRequest));
      case 'games.assets.inspect':
        if(reg.product==='kidos')throw new AgentError(errors.forbidden,'Asset request inspection requires its protected KidOS integration.');
        return this.gameProduction.inspectAssetRequest(reg,this.gameInput(reg,p,gameAssetProcessRequest));
      case "games.assets.libraries":
        return this.gameProduction.libraries(reg,p);
      case "games.assets.apply":
        return this.gameProduction.applyAssets(reg,this.gameInput(reg,p,gameAssetApplyRequest));
      case "games.assets.result":
        return this.persistTransfer(reg,"game-asset-result",this.gameProduction.assetResults.get(reg,gameProductionRead.parse(p).id));
      case "games.assets.file": {
        const request=z.object({jobId:identifier,path:gameFileRead.shape.path}).strict().parse(p),result=this.gameProduction.assetResults.get(reg,request.jobId);
        const file=result.files.find((item)=>item.path===request.path);if(!file)throw new AgentError(errors.missing,"File does not belong to this processed asset result.");
        return this.transfers.get(reg,file.transferId);
      }
      case "games.validation.start":
        return this.gameProduction.startValidation(reg, this.gameInput(reg, p, gameValidationRequest));
      case "games.production.get":
        return this.gameProduction.job(reg, gameProductionRead.parse(p).id);
      case "games.production.cancel":
        return this.gameProduction.cancel(reg, gameProductionRead.parse(p).id);
      case "games.production.reconcile":
        return this.gameProduction.reconcile(reg, gameProductionRead.parse(p).id);
      case "games.production.list": {
        const request = gameProductionList.parse(p);
        return this.gameProduction.list(reg, request.projectId, request.cursor, request.limit,request.order);
      }
      case "games.production.events": {
        const request = gameProductionEvents.parse(p);
        return this.gameProduction.events(reg, request.projectId, request.cursor, request.limit);
      }
      case "games.builds.artifact": {
        const { id } = gameProductionRead.parse(p);
        return this.persistTransfer(reg, `game-artifact:${id}`, this.gameProduction.artifact(reg, id));
      }
      case "games.builds.file": {
        const request = gameArtifactFileRead.parse(p);
        const artifact = this.gameProduction.artifact(reg, request.buildId);
        const file = artifact.files.find((file) => file.path === request.path);
        if (!file) throw new AgentError(errors.missing, "File does not belong to this build artifact.");
        return this.transfers.get(reg, file.transferId);
      }
      case "games.validation.reports": {
        const { id } = gameProductionRead.parse(p);
        return this.persistTransfer(reg, `game-reports:${id}`, this.gameProduction.reports(reg, id));
      }
      case "games.validation.file": {
        const { reportId, path } = z.object({ reportId: identifier, path: gameFileRead.shape.path }).strict().parse(p);
        const file = this.gameProduction.reportFile(reg, reportId, path);
        return this.transfers.get(reg, file.transferId);
      }
      case "games.quality.get": {
        const request = gameRevisionRead.parse(p);
        return this.persistTransfer(reg, `game-quality:${request.projectId}`, this.gameProduction.quality(reg, request.projectId, request.revision));
      }
      case "games.playtests.create": return this.gamePlaytests.create(reg, this.gameInput(reg, p, gamePlaytestCreate));
      case "games.playtests.record": return this.gamePlaytests.record(reg, this.gameInput(reg, p, gamePlaytestRecord));
      case "games.playtests.withdraw": return this.gamePlaytests.withdraw(reg, this.gameInput(reg, p, gamePlaytestWithdraw));
      case "games.playtests.correct": return this.gamePlaytests.correct(reg,this.gameInput(reg,p,gamePlaytestCorrect));
      case "games.playtests.corrections": return this.gamePlaytests.corrections(reg,p);
      case "games.playtests.read": return this.gamePlaytests.read(reg, p);
      case "games.playtests.list": return this.gamePlaytests.list(reg, p);
      case "games.playtests.inspect": return this.gamePlaytests.inspect(reg, p);
      case "games.playtests.export": return this.persistTransfer(reg, "operator-playtest-study", this.gamePlaytests.export(reg, p));
      case "games.projects.create": return this.store.db.transaction(() => {
        const project = this.games.create(reg, this.gameInput(reg, p, gameProjectCreate));
        if (reg.product !== "kidos") this.gameWorkflows.ensure(reg, project.id); return project;
      })();
      case "games.projects.list": {
        const request = gameProjectList.parse(p);
        return this.games.list(reg, request.cursor, request.limit);
      }
      case "games.projects.get":
        return this.games.get(reg, gameProjectRead.parse(p).id);
      case "games.projects.snapshot": {
        const { id } = gameProjectRead.parse(p);
        return this.persistTransfer(reg, `game-snapshot:${id}`, this.games.snapshot(reg, id));
      }
      case "games.revisions.get": {
        const request = gameRevisionRead.parse(p);
        return this.persistTransfer(reg, `game-revision:${request.projectId}`, this.games.revision(reg, request.projectId, request.revision));
      }
      case "games.revisions.list": {
        const request = gameRevisionsList.parse(p);
        return this.games.revisions(reg, request.projectId, request.cursor, request.limit,request.order);
      }
      case "games.revisions.compare": return this.games.compare(reg,p);
      case "games.revisions.compareFile": return this.games.compareFile(reg,p,file=>this.transfers.bytes(reg,file.transferId));
      case "games.revisions.commit":
        return this.games.commit(reg, this.gameInput(reg, p, gameRevisionCommit));
      case "games.mutations.inspect":
        return this.games.inspectMutation(reg, gameMutationInspect.parse(p));
      case "games.events.read": {
        const request = gameEventsRead.parse(p);
        return this.games.events(reg, request.projectId, request.cursor, request.limit);
      }
      case "games.files.get": {
        const request = gameFileRead.parse(p);
        const revision = this.games.revision(reg, request.projectId, request.revision);
        const file = revision.document.files.find((file) => file.path === request.path);
        if (!file) throw new AgentError(errors.missing, "Game file not found in the selected revision.");
        return this.transfers.get(reg, file.transferId);
      }
      case "games.projects.export": {
        const { id } = gameProjectRead.parse(p);
        return this.persistTransfer(reg, `game-export:${id}`, this.games.export(reg, id));
      }
      case "games.projects.import": {
        const request = this.gameInput(reg, p, gameProjectImport);
        const archive = this.transfers.json(reg, request.transferId);
        this.assertToolArguments(reg, archive);
        return this.games.import(reg, request.requestId, archive, request.blobs);
      }
      case "games.design.convertLegacy": {
        const request = this.gameInput(reg, p, z.object({ design: z.unknown() }).strict());
        return this.persistTransfer(reg, "game-legacy-design", convertLegacyGameDesign(request.design));
      }
      case "models.assist": {
        if (reg.product === "kidos") throw new AgentError(errors.forbidden,"KidOS inference requires its protected adapter.");
        const envelope = z.union([modelAssistance,z.object({transferId:identifier}).strict()]).parse(p);
        const request = "transferId" in envelope ? modelAssistance.parse(this.transfers.json(reg,envelope.transferId)) : envelope;
        validateProvider(reg, request.provider);
        if (request.purpose === "advisor" && request.provider.kind !== "ollama")
          throw new AgentError(errors.forbidden,"The local setup advisor requires Ollama.");
        const images = request.purpose === "catalog" ? request.images.map(id=>this.transfers.image(reg,id)) : [];
        const operation = randomUUID(), controller = new AbortController();
        const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(request.purpose === "connection" || request.purpose === "embedding" ? 25_000 : 95_000)]);
        const credential = request.provider.credentialRef ? this.credentials.acquire(reg,request.provider.credentialRef,operation) : undefined;
        if (request.provider.credentialRef && !credential) throw new AgentError(errors.unavailable,"Reconnect the credential host before model assistance.");
        const promise = assistModel(request,credential,signal,images);
        this.modelTasks.set(operation,{controller,promise});
        try {
          return this.protect(reg,await promise,credential?[credential]:[]);
        } catch(error) {
          const detail = this.protect(reg,error instanceof Error ? error.message : "Model assistance failed.",credential?[credential]:[]);
          throw new AgentError(errors.unavailable,detail);
        } finally {
          this.credentials.release(operation);this.modelTasks.delete(operation);
        }
      }
      case "models.invoke": {
        const v=z.object({runId:identifier,role:z.literal("vision"),messages:z.array(message).min(1).max(10)}).strict().parse(p);
        const run=this.store.run(reg,v.runId);
        const spec=this.store.receipt(reg,`spec:${run.id}`)?.value as DurableSpec|undefined;
        const signal=this.running.get(run.id)?.signal;
        if(reg.product!=="companion-vscode"||!spec||"profile" in spec||!spec.workspace||!signal||terminalStates.has(run.state))
          throw new AgentError(errors.forbidden,"Visual inspection requires an active editor run.");
        const credential=this.credentials.forRun(reg,run.id);
        if(spec.provider.credentialRef&&!credential)throw new AgentError(errors.unavailable,"Reconnect the credential host before visual inspection.");
        const models=new ProviderModels(spec.provider,credential,signal);
        try {
          const messages=await Promise.all(v.messages.map(async row=>{
            const content=typeof row.content === "string"?row.content:await Promise.all(row.content.map(async block=>{
              if(block.type === "text")return block;
              const image=this.transfers.image(reg,block.attachmentId);
              return {type:"image_url" as const,image_url:{url:`data:${image.mime};base64,${image.data}`,detail:block.detail}};
            }));
            return row.role === "user"?new HumanMessage({content}):row.role === "assistant"?new AIMessage({content}):new SystemMessage({content});
          }));
          const answer=await models.model("vision",false,{requiresTools:false}).invoke(messages,{signal});
          return this.protect(reg,answer.text);
        } finally {await models.close();}
      }
      case "models.catalog": {
        if (reg.product === "kidos") throw new AgentError(errors.forbidden, "KidOS model discovery belongs to its system authority.");
        const v = z.object({ provider: providerSpec }).strict().parse(p);
        validateProvider(reg, v.provider);
        const operation = randomUUID();
        const credential = v.provider.credentialRef ? this.credentials.acquire(reg, v.provider.credentialRef, operation) : undefined;
        if (v.provider.credentialRef && !credential) throw new AgentError(errors.unavailable, "Reconnect the credential host before refreshing models.");
        const controller = new AbortController();
        const models = new ProviderModels(v.provider, credential, AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]));
        try {
          const aliases = await models.listModels();
          return { provider: v.provider.kind, models: aliases, loadedAt: Date.now() };
        } finally {
          await models.close();
          this.credentials.release(operation);
        }
      }
      case "models.list":
      case "models.testConnection":
        z.object({}).strict().parse(p);
        return this.models.status(reg);
      case "models.configuration":
        z.object({}).strict().parse(p);
        return this.models.configuration(reg);
      case "models.configure":
        return this.models.configure(reg, p);
      case "models.download":
        return this.models.pull(reg, p);
      case "models.recommend":
        return this.models.recommend(reg, p);
      case "models.jobs":
        z.object({}).strict().parse(p);
        return this.models.list(reg);
      case "models.job":
        return this.models.get(reg, z.object({ id: identifier }).strict().parse(p).id);
      case "models.cancel":
        return this.models.cancel(reg, z.object({ id: identifier }).strict().parse(p).id);
      case "desktop.ollamaStatus":
        return this.desktop(reg).ollamaStatus();
      case "desktop.dockerStatus":
        return this.desktop(reg).dockerStatus();
      case "desktop.configureDocker": {
        const v = z.object({ enabled: z.boolean() }).strict().parse(p);
        await this.desktop(reg).configureDockerSandbox(v.enabled);
        return { accepted: true };
      }
      case "desktop.advisor": {
        const v = z
          .object({
            model: z.string().max(200),
            prompt: z.string().max(100_000),
          })
          .strict()
          .parse(p);
        if (this.advisors.has(reg.id))
          throw new AgentError(
            errors.conflict,
            "A recommendation is already active.",
          );
        const controller = new AbortController();
        this.advisors.set(reg.id, controller);
        try {
          return await this.desktop(reg).invokeAdvisor(
            v.model,
            v.prompt,
            AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]),
          );
        } finally {
          this.advisors.delete(reg.id);
        }
      }
      case "desktop.cancelAdvisor":
        this.advisors.get(reg.id)?.abort();
        return { accepted: true };
      case "desktop.pull": {
        const v = z
          .object({ model: z.string().max(200), sessionId: identifier })
          .strict()
          .parse(p);
        this.store.session(reg, v.sessionId);
        void this.desktop(reg)
          .pullModel(v.model, (progress) =>
            this.store.append(reg, v.sessionId, "model.pull", progress),
          )
          .catch(() =>
            this.store.append(reg, v.sessionId, "model.pull", {
              model: v.model,
              line: "Download failed.",
              done: true,
              error: "Download failed.",
            }),
          );
        return { accepted: true };
      }
      case "desktop.cancelDownload":
        this.desktop(reg).cancelDownload();
        return { accepted: true };
      case "desktop.cancel":
        this.desktop(reg).cancel();
        return { accepted: true };
      case "desktop.start": {
        const v = z
          .object({
            sessionId: identifier,
            key: identifier,
            spec: desktopRunSpec.optional(),
            specTransferId: identifier.optional(),
          })
          .strict()
          .parse(p);
        if (Boolean(v.spec) === Boolean(v.specTransferId)) throw new AgentError(errors.invalid, "Provide exactly one run specification.");
        const desktopSpec = v.spec ?? desktopRunSpec.parse(this.transfers.json(reg, v.specTransferId!));
        if (desktopSpec.workspacePath !== reg.workspace)
          throw new AgentError(
            errors.forbidden,
            "Workspace must match the installed client registration.",
          );
        this.desktop(reg);
        const spec: DesktopSpec = { profile: "desktop", spec: this.protect(reg, desktopSpec) };
        const created = this.store.db.transaction(()=>{
          const admitted=this.store.start(reg,v.sessionId,v.key,spec);
          if(admitted.created){const windows=this.models.configuration(reg)?.contextWindows;if(windows&&Object.keys(windows).length)this.store.saveReceipt(reg,admitted.run.id,`private:${admitted.run.id}:model-context-windows`,"configuration",windows);this.captureContextWorkingBudget(reg,admitted.run);}
          return admitted;
        })();
        if (created.created) this.start(reg, created.run, spec);
        return this.store.run(reg, created.run.id);
      }
      case "engine.info":
        return {
          version: ENGINE_VERSION,
          protocol: PROTOCOL_VERSION,
          node: process.versions.node,
          requiredNode: NODE_VERSION,
          ...(reg.product!=="kidos"?{contextWorkingBudget:this.contextWorkingBudget??null}:{}),
          product: reg.product,
          quiescing:this.quiescing,
          build: this.buildInfo,
          capabilities: [
            ...engineCapabilities,
            "sessions",
            "runs",
            "events",
            "approvals",
            "goals",
            "sqlite-checkpoints",
            "model-context-window-v1",
            "chunked-transfers",
            "durable-approvals",
            "bound-tool-receipts",
            "installed-tool-invocation-v1",
            "installed-tool-inspection-v1",
            ...(reg.product==="kidos"&&this.options.adapter?.reconcileInference?["installed-inference-inspection-v1"]:[]),
            "ollama-model-jobs",
            "model-assistance",
            "public-session-snapshots",
            "game-projects-v2",
            "game-mutation-inspection-v1",
            "game-revision-comparison-v1",
            "game-file-comparison-v1",
            ...(reg.product!=="kidos"?["game-visual-opinion-v1"]:[]),
            ...(reg.product!=="kidos"?["game-png-lossless-v1","game-audio-analysis-v1","game-asset-request-inspection-v1","game-web-delivery-v1"]:[]),
            ...(reg.product !== "kidos" ? ["game-file-text-edits-v1"] : []),
            ...(reg.product !== "kidos" ? ["game-source-text-pages-v1"] : []),
            ...(reg.product !== "kidos" ? ["game-validation-reports-v1"] : []),
            ...(reg.product !== "kidos" ? ["game-playtest-studies-v1"] : []),
            ...(reg.product !== "kidos" ? ["game-playtest-studio-v1"] : []),
            ...(reg.product !== "kidos" ? ["game-playtest-corrections-v1"] : []),
            "game-production-jobs",
            "game-asset-libraries",
            "game-production-resource-queue",
            "game-production-workflows",
            "shared-inference-budgets",
            ...(reg.product!=="kidos"?["request-sized-inference-reservations-v1"]:[]),
            ...(reg.product !== "kidos" ? ["owner-inference-limits-v1","context-working-budget-v1"] : []),
          ],
        };
      case "engine.resumeAfterUpdate":
        z.object({}).strict().parse(p);this.quiescing=false;return {accepted:true};
      case "workspace.status":
        z.object({}).strict().parse(p);return this.store.workspaceStatus(reg.workspace);
      case "engine.updateStatus": {
        z.object({}).strict().parse(p);
        const blockers = this.engineUpdateBlockers();
        return { ready: Object.values(blockers).every((count) => count === 0), quiescing: this.quiescing, blockers };
      }
      case "engine.stopManagedResourcesForUpdate": {
        z.object({}).strict().parse(p);
        if (reg.product === "kidos") throw new AgentError(errors.forbidden, "KidOS updates remain under system authority.");
        const blockers = this.engineUpdateBlockers();
        if (blockers.activeRuns || blockers.modelOperations || blockers.desktopResources || blockers.gameOperations || blockers.toolInspections)
          return { accepted: false, blockers, reason: "Finish active runs, model operations and desktop work before activating the update." };
        await this.workspaceProcesses.close();
        const remaining = this.engineUpdateBlockers();
        this.quiescing = true;
        return { accepted: true, blockers: remaining };
      }
      case "engine.quiesceIfIdle":
      case "engine.shutdownIfIdle": {
        z.object({}).strict().parse(p);
        const blockers = this.engineUpdateBlockers();
        if (Object.values(blockers).some((count) => count > 0))
          return { accepted: false, blockers, reason: "Work is active. The prepared update will wait without cancelling it." };
        this.quiescing = true;
        return { accepted: true, blockers };
      }
      case "engine.negotiate": {
        const v = z.object({ protocol: z.string() }).strict().parse(p);
        negotiate(v.protocol);
        return { protocol: PROTOCOL_VERSION };
      }
      case "sessions.create":
        return this.store.createSession(
          reg,
          z
            .object({ title: z.string().max(300) })
            .strict()
            .parse(p).title,
        );
      case "sessions.list":
        z.object({}).strict().parse(p);
        return this.store.sessions(reg);
      case "sessions.get":
        return this.store.session(
          reg,
          z.object({ id: identifier }).strict().parse(p).id,
        );
      case "sessions.snapshot": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        // Capture domain, public activity and outstanding work before releasing
        // the database read view. Transfer downloads can then overlap new work
        // without moving this snapshot's replay cursor.
        return this.store.db.transaction(() => {
          const recent = this.store.snapshot(reg, id);
          const runs = (this.store.db.prepare("SELECT id FROM runs WHERE namespace=? AND session=? ORDER BY rowid")
            .all(namespace(reg), id) as { id: string }[]).map((run) => this.runSummary(reg, run.id));
          const approvals = this.store.db.prepare(`SELECT receipts.id,receipts.run,receipts.value FROM receipts
            JOIN runs ON runs.id=receipts.run WHERE receipts.namespace=? AND runs.session=?
            AND receipts.id LIKE 'wait:%' AND receipts.status='waiting'
            AND runs.state NOT IN ('completed','cancelled','failed') ORDER BY receipts.rowid`)
            .all(namespace(reg), id) as { id: string; run: string; value: string }[];
          const unknown = this.store.db.prepare(`SELECT receipts.id,receipts.run,operation_identities.tool FROM receipts
            JOIN runs ON runs.id=receipts.run JOIN operation_identities ON operation_identities.id=receipts.id
            WHERE receipts.namespace=? AND runs.session=? AND receipts.status='started' ORDER BY receipts.rowid`)
            .all(namespace(reg), id) as { id: string; run: string; tool: string }[];
          const snapshot: SessionSnapshot = {
            schema: 1, ...recent, runs,
            domain: this.store.exportDomain(reg, id, (transfer) => this.transfers.json(reg, transfer)),
            pendingApprovals: approvals.map((row) => {
              const requestId = row.id.slice(5), pending = this.pending.get(requestId);
              return { id: requestId, runId: row.run, payload: JSON.parse(row.value),
                actionable: pending?.reg.id === reg.id && pending.kind === "approval" };
            }),
            reconciliation: unknown.map((row) => ({ runId: row.run, operationId: row.id,
              callId: row.id.slice(row.run.length + 1), tool: row.tool })),
          };
          return this.persistTransfer(reg, `snapshot:${id}`, this.protect(reg, snapshot));
        })();
      }
      case "transfers.begin":
        return this.transfers.begin(reg, transferBegin.parse(p));
      case "transfers.get":
        return this.transfers.get(reg, z.object({ id: identifier }).strict().parse(p).id);
      case "transfers.append": {
        const v = transferAppend.parse(p);
        return this.transfers.append(reg, v.id, v.offset, Buffer.from(v.data, "base64"));
      }
      case "transfers.commit":
        return this.transfers.commit(reg, z.object({ id: identifier }).strict().parse(p).id);
      case "transfers.read": {
        const v = z.object({ id: identifier, offset: z.number().int().nonnegative() }).strict().parse(p);
        return this.transfers.read(reg, v.id, v.offset);
      }
      case "sessions.import": {
        const v = sessionImport.parse(p);
        const domain = "transferId" in v ? this.transfers.json(reg, v.transferId) : v.domain;
        return this.store.importDomain(reg, v.key, this.protect(reg, domain));
      }
      case "sessions.fork": {
        const v = z.object({ id: identifier, key: identifier, throughRunId: identifier.optional() }).strict().parse(p);
        const domain = this.store.exportDomain(reg, v.id, (transfer) => this.transfers.json(reg, transfer), v.throughRunId);
        return this.store.importDomain(reg, v.key, { ...(domain as object), forkedFrom: { sessionId: v.id, runId: v.throughRunId } });
      }
      case "sessions.export": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const domain = this.store.exportDomain(reg, id, (transfer) => this.transfers.json(reg, transfer));
        const receipts = this.store.db.prepare(`SELECT receipts.id,receipts.run,receipts.status,receipts.binding,receipts.value,operation_identities.kind,operation_identities.tool
          FROM receipts JOIN runs ON runs.id=receipts.run JOIN operation_identities ON operation_identities.id=receipts.id
          WHERE receipts.namespace=? AND runs.session=? ORDER BY receipts.rowid`).all(namespace(reg), id) as {
            id: string; run: string; status: string; binding: string; value: string; kind: string; tool: string;
          }[];
        // Domain backup includes post-migration work and immutable effect history.
        // These records are audit data, never executable approvals or checkpoints.
        const productState = {
          schema: 1, product: reg.product, profile: reg.profile, workspace: reg.workspace,
          goals: this.goals.list(reg).filter((goal) => goal.threadId === id),
          memory: this.memory.list(reg).map((entry) => this.memory.get(reg, entry.key)),
          modelConfiguration: reg.product !== "kidos" ? this.models.configuration(reg) : null,
          operations: receipts.map(({ value, ...receipt }) => ({ ...receipt, result: JSON.parse(value), historicalOnly: true })),
        };
        return this.persistTransfer(reg, `export:${id}`, this.protect(reg, { ...(domain as object), productState }));
      }

      case "events.read": {
        const v = z
          .object({
            sessionId: identifier,
            cursor: z.number().int().nonnegative().default(0),
          })
          .strict()
          .parse(p);
        return this.store.events(reg, v.sessionId, v.cursor);
      }
      case "events.snapshot": {
        const v = z.object({ sessionId: identifier }).strict().parse(p);
        const snapshot = this.store.snapshot(reg, v.sessionId);
        return { ...snapshot, runs: snapshot.runs.map((run) => this.runSummary(reg, run.id)) };
      }
      case "credentials.lease": {
        const v = z
          .object({
            reference: identifier,
            value: z.string().min(1).max(16384),
          })
          .strict()
          .parse(p);
        this.credentials.grant(reg, v.reference, v.value);
        return { accepted: true };
      }
      case "credentials.delegate": {
        const v = z.object({
          targetClientId: identifier,
          reference: identifier,
          value: z.string().min(1).max(16384),
        }).strict().parse(p);
        if (reg.product !== "companion-mac")
          throw new AgentError(errors.forbidden, "Only the trusted Mac credential host can delegate provider access.");
        const target = this.store.clientRegistration(v.targetClientId);
        const authorizedTarget = target && (
          target.product === "companion-app" ||
          target.product === "companion-mac" && namespace(target) === namespace(reg)
        );
        if (!authorizedTarget)
          throw new AgentError(errors.forbidden, "Credential delegation target is not an authorized Companion interface.");
        if (!target.providers.includes("openai"))
          throw new AgentError(errors.forbidden, "Credential delegation target is not authorized for OpenAI.");
        this.credentials.grant(target, v.reference, v.value);
        return { accepted: true, targetClientId: target.id };
      }
      case "runs.start": {
        const v = z
          .object({ sessionId: identifier, key: identifier, spec: runSpec.optional(), specTransferId: identifier.optional() })
          .strict()
          .parse(p);
        if (Boolean(v.spec) === Boolean(v.specTransferId)) throw new AgentError(errors.invalid, "Provide exactly one run specification.");
        const spec = this.protect(reg, v.spec ?? runSpec.parse(this.transfers.json(reg, v.specTransferId!)));
        this.validateRun(reg, spec);
        const created = this.store.db.transaction(() => {
          const admitted = this.store.start(reg, v.sessionId, v.key, spec);
          if(admitted.created)this.captureContextWorkingBudget(reg,admitted.run);
          if(admitted.created&&reg.product==="kidos")this.store.saveReceipt(reg,admitted.run.id,`private:${admitted.run.id}:inference-project-id`,"configuration",this.gameAgent.linked(reg,v.sessionId)?.id??null);
          if (admitted.created && spec.goalId) this.goals.begin(reg, spec.goalId, v.sessionId, admitted.run.id);
          if (admitted.created) this.store.append(reg, v.sessionId, "message.user",
            [...spec.messages].reverse().find((message) => message.role === "user") ?? null, admitted.run.id);
          return admitted;
        })();
        if (created.created) {
          this.start(reg, created.run, spec);
        }
        return this.store.run(reg, created.run.id);
      }
      case "runs.get":
        return this.readRun(
          reg,
          z.object({ id: identifier }).strict().parse(p).id,
        );
      case "runs.describe": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const run = this.readRun(reg, id);
        const spec = this.store.receipt(reg, `spec:${id}`)?.value as DurableSpec | undefined;
        return { run, ...(spec && "profile" in spec ? {
          profile: spec.profile,
          threadId: spec.spec.thread.id,
          assistantMessageId: spec.spec.assistantMessageId,
          request: spec.spec.request,
        } : spec?.workspace ? { profile:"workspace",threadId:spec.workspace.threadId,assistantMessageId:spec.workspace.assistantMessageId,tools:spec.tools,runtime:spec.runtime,mode:spec.mode,goalId:spec.goalId } : { profile: "generic" }) };
      }
      case "runs.find": {
        const v = z.object({ sessionId: identifier, key: identifier }).strict().parse(p);
        const run = this.store.findRun(reg, v.sessionId, v.key);
        return run ? this.runSummary(reg, run.id) : null;
      }
      case "runs.list":
        return this.store.runs(
          reg,
          z.object({ sessionId: identifier }).strict().parse(p).sessionId,
        ).map((run) => this.runSummary(reg, run.id));
      case "runs.cancel": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const run = this.store.run(reg, id);
        if (terminalStates.has(run.state)) return run;
        if(reg.product==="kidos"&&this.options.adapter?.hasPendingInference)
          this.installedInferenceContext(reg,run).memo.put("protected-inference-cancel",true);
        if (this.running.has(id)) this.store.updateRun(reg, id, "cancelling");
        this.running.get(id)?.abort(new Error("Cancelled by user."));
        for (const [key, wait] of this.pending)
          if (wait.run === id) {
            const callId = (wait.payload as { callId?: string }).callId;
            if (wait.kind === "tool" && !wait.delivered && callId) {
              const receipt = this.store.receipt(reg, `${id}:${callId}`);
              if (receipt) this.store.saveReceipt(reg, id, `${id}:${callId}`, "not_dispatched", receipt.value, receipt.binding);
            }
            wait.reject(new Error("Cancelled by user."));
            this.pending.delete(key);
          }
        if (!this.running.has(id)) {
          const unknown = this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1").get(id)||this.hasPendingInference(reg,run);
          this.store.updateRun(reg, id, unknown ? "awaiting_reconciliation" : "cancelled");
        }
        return this.store.run(reg, id);
      }
      case "runs.cancelUnknown": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        if (reg.product === "kidos")
          throw new AgentError(errors.forbidden, "Protected unknown effects must be reconciled by the installed KidOS authority.");
        const current = this.store.run(reg, id);
        if (current.state === "cancelled") return current;
        if (current.state !== "awaiting_reconciliation")
          throw new AgentError(errors.conflict, "The run is not awaiting reconciliation.");
        const controller = this.running.get(id);
        if (controller) {
          controller.abort(new Error("Cancelled by user with an unconfirmed operation result."));
          await this.runningTasks.get(id);
        }
        return this.store.cancelUnknownRun(reg, id);
      }
      case "runs.resume": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const run = this.store.run(reg, id);
        if (terminalStates.has(run.state)) return run;
        if (run.state === "awaiting_reconciliation")
          throw new AgentError(
            errors.reconciliation,
            "Reconcile the unknown tool effect before continuing.",
          );
        const spec = this.store.receipt(reg, `spec:${id}`)?.value as DurableSpec | undefined;
        if (!spec)
          throw new AgentError(
            errors.unavailable,
            "Run configuration is unavailable.",
          );
        this.validateRun(reg, spec);
        if (run.state === "cancelling")
          throw new AgentError(errors.conflict, "Cancellation is still being confirmed.");
        if (this.running.has(id)) {
          const waits = [...this.pending.values()].filter((wait) => wait.run === id);
          for (const wait of waits) wait.delivered = undefined;
          if (waits.length || run.state === "running") return run;
          await this.runningTasks.get(id);
          const latest = this.store.run(reg, id);
          if (terminalStates.has(latest.state)) return latest;
        }
        this.launch(reg, run, spec);
        return this.store.run(reg, id);
      }
      case "host.approval.create": {
        const v = z.object({ parentId: identifier, request: z.object({ prompt:z.string().max(2000),action:z.string().max(200),target:z.string().max(2000),explanation:z.string().max(10000),risk:z.enum(["standard","sensitive","destructive"]) }).strict() }).strict().parse(p);
        const parent = this.pending.get(v.parentId);
        const payload = parent?.payload as { callId?: string; tool?: string } | undefined;
        if (reg.product !== "companion-vscode" || !parent || parent.reg.id !== reg.id || parent.kind !== "tool" || parent.delivered !== connection || !payload?.callId)
          throw new AgentError(errors.forbidden, "Approval must belong to this dispatched editor operation.");
        const definition = reg.toolCatalog?.find((tool) => tool.name === payload.tool);
        if (!definition?.host || !["vscode-host","vscode-backend","vscode-mcp"].includes(definition.host))
          throw new AgentError(errors.forbidden, "This adapter cannot delegate approval authority.");
        const operation = `${parent.run}:${payload.callId}`;
        const binding = contentHash({ kind: "approval", payload: v.request, operation });
        const id = contentHash({ run: parent.run, binding });
        if (!this.pending.has(id) && this.store.receipt(reg, `wait:${id}`)?.status !== "answered")
          void this.operationScope.run(operation, () => this.wait(reg, this.store.run(reg, parent.run), "approval", v.request)).catch(() => {});
        return { id };
      }
      case "host.approval.get": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const receipt = this.store.receipt(reg, `wait:${id}`);
        if (!receipt || !["answered","waiting"].includes(receipt.status)) throw new AgentError(errors.missing, "Approval not found.");
        return { state: receipt.status, ...(receipt.status === "answered" ? { value: receipt.value } : {}) };
      }
      case "host.poll": {
        z.object({}).strict().parse(p);
        return [...this.pending.entries()]
          .filter(
            ([, w]) =>
              w.reg.id === reg.id && namespace(w.reg) === namespace(reg) &&
              (!w.delivered || w.delivered === connection),
          )
          .map(([id, w]) => {
            w.delivered = connection;
            return { id, runId: w.run, kind: w.kind, payload: w.payload };
          });
      }
      case "host.respond":
      case "approvals.respond": {
        const v = z
          .object({ id: identifier, value: z.unknown() })
          .strict()
          .parse(p);
        const wait = this.pending.get(v.id);
        if (!wait) {
          const previous = this.store.receipt(reg, `wait:${v.id}`);
          if (previous?.status === "answered") {
            if (canonical(previous.value) !== canonical(this.protect(reg, v.value)))
              throw new AgentError(errors.conflict, "This approval already has a different decision.");
            return { accepted: true };
          }
        }
        if (!wait || wait.reg.id !== reg.id || namespace(wait.reg) !== namespace(reg) || wait.delivered !== connection)
          throw new AgentError(
            errors.forbidden,
            "Request does not belong to this client connection.",
          );
        if (method === "approvals.respond" && wait.kind !== "approval")
          throw new AgentError(errors.invalid, "Not an approval request.");
        if (wait.kind === "approval" && typeof v.value !== "boolean")
          throw new AgentError(errors.invalid, "Approval decisions must be boolean.");
        if(wait.kind === "tool" && reg.product === "companion-vscode") {
          const spec=this.store.receipt(reg,`spec:${wait.run}`)?.value as DurableSpec|undefined;
          if(spec && !("profile" in spec) && spec.workspace)workspaceToolResult.parse(v.value);
        }
        const prior = this.store.receipt(reg, `wait:${v.id}`);
        if (prior) this.store.saveReceipt(reg, wait.run, `wait:${v.id}`, "answered", this.protect(reg, v.value), prior.binding);
        this.pending.delete(v.id);
        wait.resolve(v.value);
        return { accepted: true };
      }
      case "host.failed": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const wait = this.pending.get(id);
        const payload = wait?.payload as { callId?: string; tool?: string } | undefined;
        if (!wait || wait.reg.id !== reg.id || wait.delivered !== connection || wait.kind !== "tool" || !payload?.callId)
          throw new AgentError(errors.forbidden, "No dispatched tool belongs to this client connection.");
        this.pending.delete(id);
        const definition = reg.toolCatalog?.find((tool) => tool.name === payload.tool);
        if (definition?.effect === "read") wait.resolve({ error: true, code: "host_read_failed" });
        else wait.reject(new AgentError(errors.reconciliation, "Host tool failed without an acknowledged result."));
        return { accepted: true };
      }
      case "tools.inspect":
      case "tools.reconcile": {
        const inspectionOnly = method === "tools.inspect";
        const v = inspectionOnly ? { ...installedToolInspection.parse(p), result: undefined } : z
          .object({
            runId: identifier,
            callId: identifier,
            result: z.unknown(),
          })
          .strict()
          .parse(p);
        const run = this.readRun(reg, v.runId);
        if (
          run.state !== "awaiting_reconciliation" ||
          this.store.receipt(reg, `${v.runId}:${v.callId}`)?.status !==
            "started"
        )
          throw new AgentError(
            errors.conflict,
            "No unknown result to reconcile.",
          );
        if (inspectionOnly && (reg.product !== "kidos" || !this.options.adapter?.reconcileTool))
          throw new AgentError(errors.forbidden, "No installed authority can inspect this operation.");
        let result = v.result;
        if (reg.product === "kidos" && this.options.adapter?.reconcileTool) {
          const identity = this.store.db.prepare("SELECT tool FROM operation_identities WHERE id=?").get(`${v.runId}:${v.callId}`) as {tool:string} | undefined;
          const definition = reg.toolCatalog?.find(tool => tool.name === identity?.tool);
          if (!definition) throw new AgentError(errors.forbidden, "The original installed tool is not in this registration.");
          const inspected = await this.inspectInstalledTool(reg, run, definition, v.callId);
          if (this.closed) throw new AgentError(errors.reconciliation, "Service stopping; the unknown operation remains reserved.");
          if (this.store.receipt(reg, `${v.runId}:${v.callId}`)?.status !== "started")
            throw new AgentError(errors.conflict, "The original operation was already reconciled.");
          if (inspected.state === "unknown") throw new AgentError(errors.reconciliation, "The protected Core has not confirmed the original operation.");
          if (inspectionOnly && inspected.state === "unsupported") throw new AgentError(errors.reconciliation, "The installed authority does not support inspection of this tool.");
          if (inspected.state === "known") result = inspected.result;
          // Older tools keep their explicit manual-intervention path only
          // when the signed adapter declares inspection unsupported.
        }
        this.store.saveReceipt(
          reg,
          v.runId,
          `${v.runId}:${v.callId}`,
          "reconciled",
          this.protect(reg, result),
          this.store.receipt(reg, `${v.runId}:${v.callId}`)?.binding,
        );
        const remaining = this.store.db
          .prepare(
            "SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1",
          )
          .get(v.runId);
        return this.store.updateRun(
          reg,
          v.runId,
          remaining ? "awaiting_reconciliation" : "awaiting_host",
        );
      }
      case "memory.list":
        z.object({}).strict().parse(p);
        return this.memory.list(reg);
      case "memory.get":
        return this.memory.get(reg, memoryRead.parse(p).key) ?? null;
      case "memory.put":
        return this.memory.put(reg, this.protect(reg, memoryWrite.parse(p)));
      case "goals.list":
        z.object({}).strict().parse(p);
        return this.goals.list(reg);
      case "goals.get":
      case "goals.progress":
        return this.goals.get(reg, z.object({ id: identifier }).strict().parse(p).id);
      case "goals.create":
        return this.goals.create(reg, goalCreate.parse(p));
      case "goals.edit":
        return this.goals.edit(reg, goalEdit.parse(p));
      case "goals.activate":
      case "goals.continue":
      case "goals.pause":
      case "goals.cancel": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const action = method.slice("goals.".length) as "activate" | "continue" | "pause" | "cancel";
        const goal = this.goals.transition(reg, id, action);
        if (action === "cancel" && goal.lastRunId)
          await this.dispatch(reg, "runs.cancel", { id: goal.lastRunId }, connection);
        return goal;
      }
      case "goals.put": {
        const v = z.object({ id: identifier, value: goalRecord }).strict().parse(p);
        if (v.id !== v.value.id) throw new AgentError(errors.invalid, "Imported goal identity does not match its record.");
        const existing=this.goals.list(reg).find(goal=>goal.id===v.id);
        if(existing){if(canonical(existing)!==canonical(this.protect(reg,v.value)))throw new AgentError(errors.conflict,"Legacy goal was already imported. Use versioned goal operations to edit it.");return existing;}
        return this.goals.save(reg, this.protect(reg, v.value));
      }
      default:
        throw new AgentError(-32601, "Method not found.");
    }
  }
  private persistTransfer(reg: Registration, key: string, value: unknown) {
    const data = Buffer.from(JSON.stringify(value));
    const sha256 = createHash("sha256").update(data).digest("hex");
    const transfer = this.transfers.begin(reg, transferBegin.parse({ key: `${key}:${sha256.slice(0, 32)}`, size: data.length, sha256, mime: "application/json" }));
    for (let offset = transfer.received; offset < data.length; offset += TRANSFER_CHUNK_BYTES)
      this.transfers.append(reg, transfer.id, offset, data.subarray(offset, offset + TRANSFER_CHUNK_BYTES));
    return this.transfers.commit(reg, transfer.id);
  }
  private start(reg: Registration, run: Run, spec: DurableSpec): void {
    this.launch(reg, run, spec);
  }
  private launch(reg: Registration, run: Run, spec: DurableSpec): void {
    const provider = "profile" in spec ? spec.spec.provider : spec.provider;
    const credential = provider?.credentialRef
      ? this.credentials.acquire(reg, provider.credentialRef, run.id)
      : undefined;
    if (provider?.credentialRef && !credential) {
      this.store.updateRun(reg, run.id, "awaiting_credentials");
      return;
    }
    const controller = new AbortController();
    this.running.set(run.id, controller);
    this.store.updateRun(reg, run.id, "running");
    const reconciliations = Object.fromEntries(
      (this.store.db.prepare("SELECT id,value FROM receipts WHERE namespace=? AND run=? AND status='reconciled'")
        .all(namespace(reg), run.id) as { id: string; value: string }[])
        .map((row) => [row.id.slice(run.id.length + 1), JSON.parse(row.value)]),
    );
    const requireCheckpoint = Boolean(this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status IN ('started','completed','reconciled') LIMIT 1").get(run.id));
    let execute: Promise<unknown>;
    try { execute = "profile" in spec
      ? this.desktop(reg).run({
          ...spec.spec,
          modelContextWindows:(this.store.receipt(reg,`private:${run.id}:model-context-windows`)?.value as ModelContextWindows|undefined)??{},
          contextWorkingBudget:this.runContextWorkingBudget(reg,run),
          ...(provider ? { provider, credential } : {}),
          execution: {
            threadId: run.id,
            signal: controller.signal,
            reconciliations,
            requireCheckpoint,
            operation: (id, tool, args, perform) => gameAgentDefinition(tool) ? perform() : this.operation(reg, run, id, tool, args, perform),
          },
          gameProduction: this.gamePort(reg, run, spec.spec.mode),
          inferenceBudget: this.inferencePort(reg, run, controller.signal),
          openPreview: async (url) => { await this.wait(reg, run, "tool", { operation: "preview", url }); },
          callbacks: {
            approval: async (request) => (await this.wait(reg, run, "approval", request)) === true,
            activity: (value) => this.emit(reg, run.sessionId, run.id, "desktop.activity", value),
            delta: (messageId, delta) => this.emit(reg, run.sessionId, run.id, "desktop.delta", { messageId, delta }),
            step: (messageId, step) => this.emit(reg, run.sessionId, run.id, "desktop.step", { messageId, step }),
            reset: (messageId) => this.emit(reg, run.sessionId, run.id, "desktop.reset", { messageId }),
          },
        })
      : (reg.product === "kidos" && this.options.adapter ? this.options.adapter.execute.bind(this.options.adapter) : this.executor)(spec, {
          registration: reg,
          contextWorkingBudget:this.runContextWorkingBudget(reg,run),
          gameProduction: reg.product === "kidos" ? undefined : this.gamePort(reg, run, spec.mode),
          inferenceBudget: reg.product === "kidos" ? undefined : this.inferencePort(reg, run, controller.signal),
          inferenceProjectId:reg.product==="kidos"?(this.store.receipt(reg,`private:${run.id}:inference-project-id`)?.value as string|null|undefined)??undefined:undefined,
          threadId: run.id,
          checkpointer: this.checkpoint(reg),
          signal: controller.signal,
          credential,
          reconciliations,
          requireCheckpoint,
          memo: {
            get: (key) => this.store.receipt(reg, `private:${run.id}:${key}`)?.value,
            put: (key, value) => this.store.saveReceipt(reg, run.id, `private:${run.id}:${key}`, "configuration", this.protect(reg, value)),
          },
          ...(spec.goalId ? { goal: this.goals.get(reg, spec.goalId), evidence: () =>
            (this.store.db.prepare("SELECT r.id,r.status,r.value,coalesce(i.kind,'note') AS kind FROM receipts r LEFT JOIN operation_identities i ON i.id=r.id WHERE r.namespace=? AND r.run=? AND r.status IN ('completed','reconciled')")
              .all(namespace(reg), run.id) as { id: string; status: string; value: string; kind: NonNullable<ToolSpec['evidenceKind']> }[])
              .map((row) => ({ operationId: row.id, status: row.status, kind: row.kind, result: JSON.parse(row.value) })) } : {}),
          recallMemory: async (options) => {
            if (reg.product !== "companion-vscode" || !this.options.resourceDirectory)
              throw new AgentError(errors.unavailable, "The installed semantic-memory adapter is unavailable.");
            const scope = namespace(reg);
            let memory = this.semanticMemory.get(scope);
            if (!memory) {
              memory = new SemanticProjectMemory({ workspaceId: reg.workspace,
                storageRoot: path.join(this.directory, "namespaces", scope), launcher: path.join(this.options.resourceDirectory, "chroma", "server.cjs") });
              this.semanticMemory.set(scope, memory);
            }
            return memory.recall(options);
          },
          operationResults: () => (this.store.db.prepare(`SELECT r.id,i.tool,r.value FROM receipts r
            JOIN operation_identities i ON i.id=r.id WHERE r.namespace=? AND r.run=? AND r.status IN ('completed','reconciled') ORDER BY r.rowid`)
            .all(namespace(reg), run.id) as { id: string; tool: string; value: string }[])
            .map((row) => ({ ...row, value: JSON.parse(row.value) })),
          resolveAttachment: async (id) => this.transfers.image(reg, id),
          emit: (type, data) => this.emit(reg, run.sessionId, run.id, type, data),
          invokeTool: (definition, input, callId, state) => this.invokeTool(reg, run, spec, definition, input, callId, state),
        });
    } catch (error) { execute = Promise.reject(error); }
    const task = execute
      .then((result) => {
        if (!this.closed && !controller.signal.aborted && this.store.run(reg, run.id).state === "running") {
          this.store.db.transaction(() => {
            if (!("profile" in spec) && spec.goalId) {
              const evaluation = goalEvaluation.parse((result as { goalEvaluation?: unknown })?.goalEvaluation ?? {
                decision: "blocked", criteria: [], completedMilestones: [],
                reason: "The executor did not return a goal evidence evaluation. Saved work requires explicit continuation.",
              });
              this.goals.evaluate(reg, spec.goalId, run.id, evaluation);
            }
            this.store.updateRun(reg, run.id, "completed", {
              result: Buffer.byteLength(JSON.stringify(result)) > 512 * 1024
                ? { kind: "agent-result-transfer", ...this.persistTransfer(reg, `result:${run.id}`, this.protect(reg, result)) }
                : this.protect(reg, result),
            });
          })();
        }
      })
      .catch(async (error) => {
        if (this.closed || controller.signal.aborted) return;
        let message = error instanceof Error ? error.message : "Run failed.";
        for (const secret of this.secrets(reg))
          message = message.split(secret).join("[credential redacted]");
        const authenticationFailed =
          Boolean(provider?.credentialRef) &&
          [401, 403].includes(Number((error as { status?: number })?.status));
        // Preserve virtual work after a known failure without exposing or
        // importing executable checkpoint internals into the public domain.
        let partial: { files: unknown; paused: true } | undefined;
        try {
          const checkpoint = await this.checkpoint(reg).getTuple({ configurable: { thread_id: run.id } });
          const files = checkpoint?.checkpoint.channel_values.files;
          if (files && typeof files === "object") partial = { files: this.protect(reg, files), paused: true };
        } catch { /* The original checkpoint remains available for explicit repair. */ }
        if (this.closed || controller.signal.aborted) return;
        const state = this.store.run(reg, run.id).state;
        if (state === "awaiting_host" && error instanceof AgentError && error.code === errors.reconciliation &&
          !this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1").get(run.id))
          return; // A host reconciled the receipt while the interrupted graph was settling.
        if (error instanceof ModelTransportError)
          this.emit(reg, run.sessionId, run.id, "model.failure", error.failure);
        this.store.updateRun(
          reg,
          run.id,
          state === "awaiting_reconciliation" || (error instanceof AgentError && error.code === errors.reconciliation)
            ? "awaiting_reconciliation"
            : reg.product==="kidos"&&this.options.adapter?.reconcileInference&&error instanceof AgentError&&
              (error.data as {kind?:string}|undefined)?.kind==="protected-inference-wait"
              ? "awaiting_host"
            : authenticationFailed
              ? "awaiting_credentials"
              : "failed",
          { error: message, ...(reg.product==="kidos"&&error instanceof AgentError&&(error.data as {kind?:string}|undefined)?.kind==="protected-inference-wait"?{waitingFor:"protected-inference" as const}:{}),
            ...(partial ? { result: { kind: "agent-result-transfer", ...this.persistTransfer(reg, `partial:${run.id}`, partial) } } : {}) },
        );
      })
      .finally(() => {
        if (!this.closed && controller.signal.aborted) {
          const unknown = this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1").get(run.id)||this.hasPendingInference(reg,run);
          this.store.updateRun(reg, run.id, unknown ? "awaiting_reconciliation" : "cancelled");
        }
        this.running.delete(run.id);
        this.runningTasks.delete(run.id);
        this.credentials.release(run.id);
      });
    this.runningTasks.set(run.id, task);
    // A failed metadata write must never become an unhandled promise or start
    // another model/tool loop. readRun exposes the recoverable stopped state.
    void task.catch(() => {});
  }
  private captureContextWorkingBudget(reg:Registration,run:Run):void{
    if(reg.product!=="kidos"&&this.contextWorkingBudget)this.store.saveReceipt(reg,run.id,`private:${run.id}:context-working-budget`,"configuration",this.contextWorkingBudget);
  }
  private runContextWorkingBudget(reg:Registration,run:Run){
    if(reg.product==="kidos")return undefined;
    const value=this.store.receipt(reg,`private:${run.id}:context-working-budget`)?.value;
    return value===undefined?undefined:contextWorkingBudget.parse(value);
  }
  private inferenceScopes(reg: Registration, sessionId: string): InferenceBudgetScope[] {
    const project = this.gameAgent.linked(reg, sessionId), workflow = project ? this.gameWorkflows.get(reg, project.id) : null;
    return [{ kind: "namespace" }, ...(project && workflow?.state === "active" ? [{ kind: "game-stage" as const, projectId: project.id, workflowId: workflow.id, stage: workflow.stage }] : [])];
  }
  private installedInferenceContext(reg:Registration,run:Run){
    return {threadId:run.id,memo:{get:(key:string)=>this.store.receipt(reg,`private:${run.id}:${key}`)?.value,
      put:(key:string,value:unknown)=>this.store.saveReceipt(reg,run.id,`private:${run.id}:${key}`,"configuration",this.protect(reg,value))}};
  }
  private hasPendingInference(reg:Registration,run:Run):boolean{
    if(reg.product!=="kidos"||!this.options.adapter?.hasPendingInference)return false;
    try{return this.options.adapter.hasPendingInference(reg,this.installedInferenceContext(reg,run))!==false;}catch{return true;}
  }
  private inferencePort(reg: Registration, run: Run, signal: AbortSignal): InferenceBudgetPort {
    const starts = new Map<string, {minimum:number;pending:Promise<void>}>();
    const decisions = new Map<string, Promise<unknown>>();
    const begin = async (callId: string,minimumReservationTokens?:number) => {
        for (;;) {
          signal.throwIfAborted();
          const state = this.inferenceBudgets.begin(reg, run.id, callId, this.inferenceScopes(reg, run.sessionId),minimumReservationTokens);
          if (!state) return;
          const blocked = state.budgets.filter((value) => value.exhausted);
          if (blocked.some((value) => !value.canContinue)) throw new AgentError(errors.forbidden, minimumReservationTokens===undefined?"The installed inference budget is exhausted. Progress is saved; administrative policy review is required.":
            'The installed inference budget is exhausted for this model request. Its estimated reservation exceeds the remaining allocation. Progress is saved; administrative policy review is required.');
          const decision = { budgets: blocked }, key = contentHash(blocked.map((value) => ({ scope: value.scope, blocks: value.blocks, version: value.version, policy: value.policy,...(value.nextReservationTokens===undefined?{}:{nextReservationTokens:value.nextReservationTokens}) })));
          const allocation = blocked.map((value) => `${value.scope.kind === "namespace" ? "Ambiente compartilhado" : "Etapa do jogo"}: mais ${value.policy.callsPerBlock} chamadas aos modelos e ${value.policy.tokensPerBlock} tokens de alocação.`).join("\n");
          const requestEstimate=minimumReservationTokens===undefined?'':`\nReserva estimada desta chamada: ${Math.max(...blocked.map(value=>value.nextReservationTokens??value.reservedTokensPerCall))} tokens. É uma estimativa local; o uso real é informado pelo provedor.`;
          let decisionPromise = decisions.get(key);
          if (!decisionPromise) {
            decisionPromise = this.wait(reg, run, "approval", { kind: "command", tool: "inference_budget", callId: `inference-budget:${key}`,
            title: "Autorizar continuação do uso da IA?", detail: `O limite compartilhado foi atingido. O progresso está salvo.\n${allocation}${requestEstimate}`,
            confirmLabel: "Autorizar continuação", prompt: "Autorizar mais um bloco de uso da IA?", action: "Autorizar continuação", target: "Produção compartilhada",
              explanation: `Ferramentas e permissões continuam com os mesmos limites.\n${allocation}${requestEstimate}`, risk: "standard", budget: decision });
            decisions.set(key, decisionPromise);
          }
          const approved = await decisionPromise;
          signal.throwIfAborted();
          if (approved !== true) throw new AgentError(errors.forbidden, "Inference continuation was declined. Saved projects and checkpoints were preserved.");
          this.inferenceBudgets.grant(reg, `inference:${run.id}:${key}`, decision);
        }
    };
    return {
      begin: (callId,minimumReservationTokens) => {
        const minimum=minimumReservationTokens??0,old = starts.get(callId);
        if (old){if(old.minimum!==minimum)return Promise.reject(new AgentError(errors.conflict,'Model invocation identity changed its request reservation.'));return old.pending;}
        const pending = begin(callId,minimumReservationTokens); starts.set(callId, {minimum,pending}); return pending;
      },
      finish: (callId, usage) => { this.inferenceBudgets.finish(reg, run.id, callId, usage); starts.delete(callId); },
    };
  }
  private gamePort(reg: Registration, run: Run, mode: "plan" | "review" | "execute"): GameAgentPort {
    if (reg.product === "kidos") throw new AgentError(errors.forbidden, "KidOS cannot use workspace game tools.");
    return { catalog: GAME_AGENT_TOOLS, evidence: () => this.gameAgent.evidence(reg, run.id, run.sessionId),
      currentProject: () => {
        const project = this.gameAgent.linked(reg, run.sessionId);
        if (!project) return null;
        const revision = this.games.revision(reg, project.id, project.revision);
        return { projectId: project.id, engine: revision.document.engine, revision: revision.revision,
          sourceHash: revision.contentHash, fileCount: revision.document.files.length,
          assetCount: revision.document.assets.length, hasDesign: revision.document.design !== null };
      },
      reportInputRejection: value => this.emit(reg, run.sessionId, run.id, "game.tool_rejected", value), invoke: async (name, input, callId, reviewer) => {
      const definition = gameAgentDefinition(name);
      if (!definition) throw new AgentError(errors.forbidden, "Unknown installed game tool.");
      if (mode === "plan" && definition.effect !== "read") throw new AgentError(errors.forbidden, "Plan mode cannot mutate games.");
      const prepared = this.gameAgent.prepare(name, input);
      this.assertToolArguments(reg, prepared);
      return this.operation(reg, run, callId, name, prepared, async () => {
        try { this.gameAgent.preflight(reg, name, prepared); }
        catch (error) {
          if (error instanceof AgentError) return { ok: false, rejectedBeforeExternalDispatch: true,
            error: { code: error.code, message: this.protect(reg, error.message) } };
          throw error;
        }
        if (definition.effect !== "read" && (mode === "review" || definition.effect === "external")) {
          const approved = await this.wait(reg, run, "approval", { tool: name, input: prepared, callId,
            kind: definition.effect === "external" ? "command" : "file", title: `Autorizar ${name}?`,
            detail: JSON.stringify(prepared).slice(0, 3000), confirmLabel: "Autorizar",
            prompt: `Autorizar ${name} neste projeto de jogo?`, action: "Autorizar", target: reg.workspace || "Projeto de jogo",
            explanation: JSON.stringify(prepared).slice(0, 3000), risk: "standard" });
          if (approved !== true) return { denied: true };
        }
        try {
          const key = `game-agent:${contentHash({ run: run.id, callId })}`;
          const result = name==="game_review_image"
            ? reviewer ? await reviewer(this.gameAgent.reviewImage(reg,run.sessionId,prepared))
              : {ok:false,error:{code:errors.unavailable,message:"The private engine vision reviewer is unavailable."}}
            : await this.gameAgent.invoke(reg, run.sessionId, key, name, prepared);
          const safe = this.protect(reg, this.gameAgent.bounded(result));
          this.emit(reg, run.sessionId, run.id, "game.activity", { tool: name, effect: definition.effect,
            project: this.gameAgent.linked(reg, run.sessionId), result: safe });
          return safe;
        } catch (error) {
          // Domain/schema failures acknowledge that the atomic mutation was rejected.
          // Unknown tool/SQLite failures still require the ordinary receipt reconciliation.
          if (error instanceof AgentError || error instanceof z.ZodError) return { ok: false,
            error: { code: error instanceof AgentError ? error.code : errors.invalid, message: this.protect(reg, error.message) } };
          throw error;
        }
      }, definition.evidenceKind);
    } };
  }
  private async invokeTool(
    reg: Registration,
    run: Run,
    spec: RunSpec,
    definition: ToolSpec,
    input: unknown,
    callId: string,
    graphState?: unknown,
  ): Promise<unknown> {
    if (reg.product === "kidos") {
      const adapter = this.options.adapter;
      if (!adapter) throw new AgentError(errors.forbidden, "KidOS system tools require the signed service-side Core adapter. UI tool callbacks cannot execute them.");
      const prepared = adapter.prepareTool(reg, definition, input, graphState);
      this.assertToolArguments(reg, prepared);
      if (spec.mode === "plan" && definition.effect !== "read") throw new AgentError(errors.forbidden, "Mutation denied in plan mode.");
      return this.operation(reg, run, callId, definition.name, prepared, () =>
        adapter.invokeTool(reg, definition, prepared, this.running.get(run.id)!.signal, this.installedInvocation(reg, run, callId)), definition.evidenceKind);
    }
    if(definition.host === "service-process") {
      const prepared=await this.workspaceProcesses.prepare(reg,definition,input);
      this.assertToolArguments(reg,prepared);
      if(spec.mode === "plan"&&definition.effect!=="read")throw new AgentError(errors.forbidden,"Mutation denied in plan mode.");
      if(definition.effect!=="read"){
        const approved=await this.operationScope.run(`${run.id}:${callId}`,()=>this.wait(reg,run,"approval",{tool:definition.name,input:prepared,callId}));
        if(approved!==true)return {denied:true};
      }
      return this.operation(reg,run,callId,definition.name,prepared,()=>this.workspaceProcesses.invoke(reg,run.id,definition,prepared,this.running.get(run.id)!.signal,event=>this.emit(reg,run.sessionId,run.id,"workspace.activity",event)),definition.evidenceKind);
    }
    this.assertToolArguments(reg, input);
    if (spec.mode === "plan" && definition.effect !== "read")
      throw new AgentError(errors.forbidden, "Mutation denied in plan mode.");
    if (
      definition.effect !== "read" &&
      !(reg.product === "companion-vscode" && definition.host && ["vscode-host","vscode-backend","vscode-mcp"].includes(definition.host)) &&
      (spec.mode !== "execute" || definition.effect === "external")
    ) {
      const approved = await this.wait(reg, run, "approval", {
        tool: definition.name,
        input,
        callId,
      });
      if (approved !== true) return { denied: true };
    }
    return this.operation(reg, run, callId, definition.name, input, () =>
      this.wait(reg, run, "tool", { tool: definition.name, input, callId }),
      definition.evidenceKind,
    );
  }
  private installedInvocation(reg: Registration, run: Run, callId: string): InstalledToolInvocation {
    return Object.freeze({ id: `engine-${contentHash({ namespace: namespace(reg), runId: run.id, callId })}`,
      runId: run.id, sessionId: run.sessionId });
  }
  private inspectInstalledTool(reg: Registration, run: Run, definition: ToolSpec, callId: string): Promise<InstalledToolReconciliation> {
    const invocation = this.installedInvocation(reg, run, callId), old = this.toolInspections.get(invocation.id);
    if (old) return old.promise;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.options.adapter!.reconcileTool!(reg, definition, invocation, controller.signal);
    })
      .then(value => z.union([
        z.object({state:z.literal("known"),result:z.unknown().refine(value => value !== undefined, "Missing installed-tool observation")}).strict(),
        z.object({state:z.literal("unknown")}).strict(),
        z.object({state:z.literal("unsupported")}).strict(),
      ]).parse(value) as InstalledToolReconciliation)
      .finally(() => { this.toolInspections.delete(invocation.id); });
    this.toolInspections.set(invocation.id, {controller, promise});
    return promise;
  }
  private async operation(
    reg: Registration, run: Run, callId: string, tool: string, input: unknown,
    perform: () => Promise<unknown>,
    evidenceKind: NonNullable<ToolSpec["evidenceKind"]> = "note",
  ): Promise<unknown> {
    this.assertToolArguments(reg, input);
    const id = `${run.id}:${callId}`;
    const binding = contentHash({ tool, input, workspace: reg.workspace });
    const prior = this.store.receipt(reg, id);
    if (prior && prior.binding !== binding)
      throw new AgentError(errors.conflict, "Operation identifier was used for different tool arguments or resource.");
    if (prior?.status === "completed" || prior?.status === "reconciled") return prior.value;
    if (prior?.status === "started") {
      this.store.updateRun(reg, run.id, "awaiting_reconciliation");
      throw new AgentError(errors.reconciliation, "Tool may have executed; reconcile its result before continuing.");
    }
    this.store.saveReceipt(reg, run.id, id, "started", { tool, inputHash: contentHash(input) }, binding);
    this.store.db.prepare("INSERT INTO operation_identities VALUES(?,?,?) ON CONFLICT(id) DO NOTHING").run(id, evidenceKind, tool);
    try {
      const result = await this.operationScope.run(id, perform);
      const safe = this.protect(reg, result);
      this.store.saveReceipt(reg, run.id, id, "completed", safe, binding);
      this.emit(reg, run.sessionId, run.id, "tool.receipt", { tool, callId, status: "completed" });
      return safe;
    } catch (error) {
      if (!this.closed && this.store.receipt(reg, id)?.status === "started") {
        try { this.store.updateRun(reg, run.id, "awaiting_reconciliation"); } catch { /* The durable started receipt still forbids repetition. */ }
        throw new AgentError(errors.reconciliation, "A tool stopped without an acknowledged result. Reconcile its effect before continuing.");
      }
      throw error;
    }
  }
  private wait(
    reg: Registration,
    run: Run,
    kind: Pending["kind"],
    payload: unknown,
  ): Promise<unknown> {
    const operation = this.operationScope.getStore();
    const normalized = { ...(payload as Record<string, unknown>) };
    delete normalized.id;
    const binding = contentHash({ kind, payload: normalized, operation });
    const id = kind === "approval" ? contentHash({ run: run.id, binding }) : randomUUID();
    const receipt = this.store.receipt(reg, `wait:${id}`);
    if (receipt?.binding !== undefined && receipt.binding !== binding)
      throw new AgentError(errors.conflict, "Approval request content changed.");
    if (receipt?.status === "answered") return Promise.resolve(receipt.value);
    if (kind === "approval") {
      this.store.saveReceipt(reg, run.id, `wait:${id}`, "waiting", this.protect(reg, normalized), binding);
      // This tool has not yet passed its own approval gate. Restart may safely
      // re-enter that gate, but must not repeat a tool with an unknown effect.
      if (operation) {
        const effect = this.store.receipt(reg, operation);
        if (effect) this.store.saveReceipt(reg, run.id, operation, "awaiting_approval", effect.value, effect.binding);
      }
    }
    this.store.updateRun(
      reg,
      run.id,
      kind === "approval" ? "awaiting_approval" : "awaiting_host",
    );
    this.emit(
      reg,
      run.sessionId,
      run.id,
      kind === "approval" ? "approval.requested" : "host.requested",
      { id, ...(payload as object) },
    );
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        reg,
        run: run.id,
        session: run.sessionId,
        kind,
        payload: this.protect(reg, payload),
        resolve: (value) => {
          if (operation && kind === "approval") {
            const effect = this.store.receipt(reg, operation);
            if (effect) this.store.saveReceipt(reg, run.id, operation, "started", effect.value, effect.binding);
          }
          const other = [...this.pending.values()].find((wait) => wait.run === run.id);
          this.store.updateRun(reg, run.id, other ? other.kind === "approval" ? "awaiting_approval" : "awaiting_host" : "running");
          resolve(value);
        },
        reject,
      });
    });
  }
  disconnect(connection: string): void {
    if (this.closed) return;
    for (const [id, wait] of this.pending) {
      if (wait.delivered !== connection) continue;
      const payload = wait.payload as { callId?: string };
      if (wait.kind === "tool" && payload.callId) {
        const effect = this.store.receipt(wait.reg, `${wait.run}:${payload.callId}`);
        const tool = wait.reg.toolCatalog?.find((tool) => tool.name === (wait.payload as {tool?:string}).tool);
        if (effect?.status === "awaiting_approval" || tool?.effect === "read") {
          wait.delivered = undefined;
          continue;
        }
        this.store.updateRun(wait.reg, wait.run, "awaiting_reconciliation", {
          error:
            "The host disconnected before acknowledging a tool result. Reconcile the effect before continuing.",
        });
        this.pending.delete(id);
        wait.reject(
          new AgentError(
            errors.reconciliation,
            "Unknown tool effect after host disconnection.",
          ),
        );
      } else wait.delivered = undefined;
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const task of this.modelTasks.values()) task.controller.abort();
    for (const task of this.toolInspections.values()) task.controller.abort();
    this.credentials.clear();
    for (const memory of this.semanticMemory.values()) memory.dispose();
    this.semanticMemory.clear();
    for (const controller of this.running.values()) controller.abort();
    for (const wait of this.pending.values())
      wait.reject(new Error("Service stopping."));
    this.pending.clear();
    const resources = [...this.desktopRuntimes.values()].map((runtime) => runtime.shutdown());
    resources.push(this.models.close(),this.workspaceProcesses.close(),this.gameProduction.close(),
      ...this.runningTasks.values(), ...[...this.modelTasks.values()].map(task=>task.promise.then(()=>{},()=>{})),
      ...[...this.toolInspections.values()].map(task=>task.promise.then(()=>{},()=>{})));
    for (const controller of this.advisors.values()) controller.abort();
    this.closing = Promise.allSettled(resources).then(() => {
      for (const saver of this.checkpointers.values()) saver.db.close();
      this.store.close();
    });
    return this.closing;
  }
}
