import * as path from "node:path";
import type { AgentClient, HostResponses } from "@companion/client-sdk";
import { COMPANION_RELEASE_PUBLIC_KEY, ensureEngine } from "@companion/client-sdk/bootstrap";
import {
  AgentError,
  DEFAULT_WEB_RESEARCH_CONFIGURATION,
  engineCapabilities,
  errors,
  type EngineInfo,
  type EngineUpdateStatus,
  type ModelCatalog,
  type ModelJob,
  type ModelOptimizationProfile,
  type ModelSelectionMode,
  type OllamaRecommendationPlan,
  type OllamaRoleConfiguration,
  type Run,
  type RunState,
  type Session,
  type WebResearchConfiguration,
} from "@companion/client-sdk/contracts";
import type {
  DesktopActivity,
  DesktopMessage,
  DesktopChange,
  DesktopDockerStatus,
  DesktopExecutionStep,
  DesktopOllamaStatus,
  DesktopRuntimeRunOptions,
  DesktopRuntimeRunResult,
  PullProgress,
} from "./contracts";

type RuntimeOptions = DesktopRuntimeRunOptions;
export type RecoverableDesktopRun = {
  run: Run;
  profile: "desktop";
  threadId: string;
  assistantMessageId: string;
  request: string;
};
export type DesktopRecoveryHandler = {
  callbacks: RuntimeOptions["callbacks"];
  openPreview: RuntimeOptions["openPreview"];
  complete: (result: { message: DesktopMessage; changes: DesktopChange[] }) => Promise<void>;
};
export type DesktopModelConfiguration = {
  revision: number;
  provider: "ollama" | "openai";
  endpoint: string;
  credentialRef?: string;
  selectionMode: ModelSelectionMode;
  optimizationProfile: ModelOptimizationProfile;
  webResearch: WebResearchConfiguration;
  roles: OllamaRoleConfiguration;
};

export class OllamaDesktopRuntime {
  constructor(
    private readonly installation: {
      bundleDirectory: string;
      development: boolean;
      onRunState?: (state: RunState | undefined) => void;
      ensureClient?: typeof ensureEngine;
    },
  ) {}
  private client?: AgentClient;
  private readonly clients = new Map<string, Promise<AgentClient>>();
  private active?: { id: string; client: AgentClient };
  private detached = false;
  private preparing = false;
  private cancelRequested = false;
  private currentState?: RunState;
  private downloadJob?: string;
  private recommendationJob?: string;
  get state(): RunState | undefined { return this.currentState; }
  private setState(state: RunState | undefined): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.installation.onRunState?.(state);
  }
  get running(): boolean {
    return this.preparing || Boolean(this.active);
  }
  private async connect(workspace = "", activation: "idle" | "stop-managed" = "idle"): Promise<AgentClient> {
    if (activation === "stop-managed") this.clients.delete(workspace);
    let pending = this.clients.get(workspace);
    if (!pending) {
      pending = this.connectRegisteredClient(workspace, activation);
      this.clients.set(workspace, pending);
      pending.catch(() => this.clients.delete(workspace));
    }
    this.client = await pending;
    if (!this.client.connected) {
      this.clients.delete(workspace);
      return this.connect(workspace, activation);
    }
    return this.client;
  }
  private async connectRegisteredClient(workspace: string, activation: "idle" | "stop-managed"): Promise<AgentClient> {
    try {
      const client = await this.provision(workspace, activation, ["ollama", "openai"]);
      await this.assertSdkCompatibility(client);
      return client;
    } catch (error) {
      if (!(error instanceof AgentError) || error.code !== errors.forbidden) throw error;
      // Engines predating hosted-provider support cannot authenticate the new
      // Mac registration, so they cannot report or activate their prepared
      // update. A previously enrolled Ollama-only Mac identity may perform
      // that lifecycle transition, but it never gains OpenAI authority.
      const compatibilityClient = await this.provision(workspace, activation, ["ollama"]);
      compatibilityClient.close();
      const client = await this.provision(workspace, activation, ["ollama", "openai"]);
      await this.assertSdkCompatibility(client);
      return client;
    }
  }
  private async assertSdkCompatibility(client: AgentClient): Promise<EngineInfo> {
    const info = await client.engineInfo();
    const missing = engineCapabilities.filter((capability) => !info.capabilities.includes(capability));
    if (missing.length) {
      client.close();
      throw new Error(`O aplicativo Mac requer uma atualização do Companion (${missing.join(", ")}).`);
    }
    return info;
  }
  private provision(
    workspace: string,
    activation: "idle" | "stop-managed",
    providers: Array<"ollama" | "openai">,
  ): Promise<AgentClient> {
    const { ensureClient, ...installation } = this.installation;
    return (ensureClient ?? ensureEngine)({
      ...installation,
      product: "companion-mac",
      profile: "default",
      workspace,
      providers,
      hostTools: [],
      activation,
      publicKey: installation.development ? undefined : COMPANION_RELEASE_PUBLIC_KEY,
    });
  }
  async activatePreparedUpdate(workspace = ""): Promise<void> {
    const client = await this.connect(workspace, "stop-managed");
    if (!client.connected) throw new Error("The updated Companion engine did not reconnect.");
  }
  async engineStatus(): Promise<EngineUpdateStatus & { version: string }> {
    const client = await this.connect();
    const [info, status] = await Promise.all([
      client.engineInfo(),
      client.call<EngineUpdateStatus>("engine.updateStatus"),
    ]);
    return { ...status, version: info.version };
  }
  async workspaceStatus(workspace = ""): Promise<{ busy: boolean; runId?: string; state?: RunState }> {
    return (await this.connect(workspace)).call("workspace.status");
  }
  async restartEngine(workspace = ""): Promise<void> {
    const client = await this.connect(workspace);
    const status = await client.call<EngineUpdateStatus>("engine.updateStatus");
    if (status.blockers.activeRuns || status.blockers.modelOperations || status.blockers.desktopResources)
      throw new Error("Finalize execuções, operações de modelo e trabalhos do aplicativo antes de reiniciar o motor.");
    const result = await client.call<{ accepted: boolean; reason?: string }>("engine.stopManagedResourcesForUpdate");
    if (!result.accepted) throw new Error(result.reason ?? "O motor ainda possui trabalho protegido.");
    for (let wait = 0; wait < 100 && client.connected; wait++) await new Promise((resolve) => setTimeout(resolve, 50));
    if (client.connected) throw new Error("O motor não encerrou no tempo esperado.");
    for (const pending of this.clients.values()) void pending.then((value) => value.close(), () => undefined);
    this.clients.clear();
    await this.connect(workspace);
  }
  cancel(): void {
    if (this.running) this.cancelRequested = true;
    void this.active?.client.call("runs.cancel", { id: this.active.id });
  }
  cancelDownload(): void {
    void this.connect().then(async (client) => {
      const id = this.downloadJob ?? (await client.call<ModelJob[]>("models.jobs")).find((job) => job.kind === "download" && ["running", "cancelling"].includes(job.state))?.id;
      if (id) await client.call("models.cancel", { id });
    });
  }
  dispose(): void {
    this.detached = true;
    for (const client of this.clients.values())
      void client.then((c) => c.close());
    this.clients.clear();
  }
  async ollamaStatus(): Promise<DesktopOllamaStatus> {
    return (await this.connect()).call("models.list");
  }
  async modelRoles(initial?: OllamaRoleConfiguration): Promise<OllamaRoleConfiguration | undefined> {
    return (await this.modelConfiguration(initial))?.roles;
  }
  async configureModelRoles(roles: OllamaRoleConfiguration): Promise<void> {
    const client = await this.connect();
    const previous = await client.call<DesktopModelConfiguration | null>("models.configuration");
    await client.call("models.configure", previous
      ? { ...previous, roles }
      : { revision: 0, provider: "ollama", endpoint: "http://127.0.0.1:11434/v1", selectionMode: "custom", optimizationProfile: "balanced", webResearch: DEFAULT_WEB_RESEARCH_CONFIGURATION, roles });
  }
  async modelConfiguration(initial?: OllamaRoleConfiguration): Promise<DesktopModelConfiguration | undefined> {
    const client = await this.connect();
    const saved = await client.call<DesktopModelConfiguration | null>("models.configuration");
    if (saved) return saved;
    if (!initial?.executor) return undefined;
    return client.call<DesktopModelConfiguration>("models.configure", {
      revision: 0, provider: "ollama", endpoint: "http://127.0.0.1:11434/v1",
      selectionMode: "custom", optimizationProfile: "balanced", webResearch: DEFAULT_WEB_RESEARCH_CONFIGURATION, roles: initial,
    });
  }
  async configureModels(input: Omit<DesktopModelConfiguration, "revision">): Promise<DesktopModelConfiguration> {
    const client = await this.connect();
    const previous = await client.call<DesktopModelConfiguration | null>("models.configuration");
    return client.call("models.configure", { ...input, revision: previous?.revision ?? 0 });
  }
  async leaseCredential(reference: string, value: string, workspace = ""): Promise<void> {
    await (await this.connect(workspace)).call("credentials.lease", { reference, value });
  }
  async delegateCredential(targetClientId: string, reference: string, value: string, workspace = ""): Promise<void> {
    await (await this.connect(workspace)).call("credentials.delegate", { targetClientId, reference, value });
  }
  async modelCatalog(provider: { kind: "ollama" | "openai"; endpoint: string; roles: OllamaRoleConfiguration; credentialRef?: string; authHeader: "authorization" }): Promise<ModelCatalog> {
    return (await this.connect()).modelCatalog(provider);
  }
  async recommendModels(input: { advisorModel?: string; publicCatalog?: unknown; installedDockerImages: string[]; optimizationProfile?: ModelOptimizationProfile }, signal: AbortSignal): Promise<OllamaRecommendationPlan> {
    signal.throwIfAborted(); const client = await this.connect();
    const job = await client.call<ModelJob>("models.recommend", { ...input, key: crypto.randomUUID() });
    this.recommendationJob = job.id;
    const abort = () => { void this.connect().then((c) => c.call("models.cancel", { id: job.id })); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try { return (await this.observeModelJob(job.id)).result as OllamaRecommendationPlan; }
    finally { signal.removeEventListener("abort", abort); this.recommendationJob = undefined; }
  }
  async cancelRecommendation(): Promise<void> {
    const client = await this.connect();
    const id = this.recommendationJob ?? (await client.call<ModelJob[]>("models.jobs")).find((job) => job.kind === "recommendation" && ["running", "cancelling"].includes(job.state))?.id;
    if (id) await client.call("models.cancel", { id });
  }
  async recoverModelJobs(progress: (value: PullProgress) => void, recommendation: (value: OllamaRecommendationPlan) => Promise<void>): Promise<void> {
    const jobs = await (await this.connect()).call<ModelJob[]>("models.jobs");
    const latest = jobs.find((job) => job.kind === "recommendation");
    await Promise.all(jobs.filter((job) => ["running", "cancelling"].includes(job.state) || job.id === latest?.id && job.state === "completed").map(async (job) => {
      if (job.kind === "download") this.downloadJob = job.id;
      else this.recommendationJob = job.id;
      try {
        const result = await this.observeModelJob(job.id, job.kind === "download" ? progress : undefined);
        if (job.kind === "recommendation") await recommendation(result.result as OllamaRecommendationPlan);
      } finally {
        if (job.kind === "download") this.downloadJob = undefined; else this.recommendationJob = undefined;
      }
    }));
  }
  private async observeModelJob(id: string, progress?: (value: PullProgress) => void): Promise<ModelJob> {
    let previous = "";
    while (!this.detached) {
      const client = await this.connect();
      const job = await client.call<ModelJob>("models.job", { id });
      const serialized = JSON.stringify(job.progress);
      if (job.progress && serialized !== previous) { progress?.(job.progress); previous = serialized; }
      if (job.state === "completed") return job;
      if (["failed", "cancelled", "interrupted"].includes(job.state)) throw new Error(job.error || `Model job ${job.state}.`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Interface closed; the model job remains with the engine.");
  }
  async dockerStatus(): Promise<DesktopDockerStatus> {
    return (await this.connect()).call("desktop.dockerStatus");
  }
  async configureDockerSandbox(enabled: boolean): Promise<void> {
    await (await this.connect()).call("desktop.configureDocker", { enabled });
  }
  async invokeAdvisor(
    model: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const client = await this.connect();
    const abort = () => {
      void client.call("desktop.cancelAdvisor");
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      return await client.call("desktop.advisor", { model, prompt }, 610_000);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async pullModel(
    model: string,
    onProgress: (progress: PullProgress) => void,
  ): Promise<void> {
    const client = await this.connect();
    const job = await client.call<ModelJob>("models.download", { model, key: crypto.randomUUID() });
    this.downloadJob = job.id;
    try { await this.observeModelJob(job.id, onProgress); }
    finally { this.downloadJob = undefined; }
  }
  async run(options: DesktopRuntimeRunOptions): Promise<DesktopRuntimeRunResult> {
    if (this.running) throw new Error("A run is already active.");
    this.preparing = true;
    this.cancelRequested = false;
    try {
      let client = await this.connect(options.workspacePath);
      const key = `desktop:${options.thread.id}`;
      const existing = (await client.call<Session[]>("sessions.list")).find(
        (session) => session.importedFrom === key,
      );
      const session =
        existing ??
        (await client.importSession(key, { thread: options.thread }));
      const { callbacks, openPreview, execution: _execution, ...provided } = options;
      const spec = { ...provided, workspacePath: client.options.credential.registration.workspace };
      if (this.cancelRequested) throw new Error("Run cancelled before admission.");
      let run: Run | undefined;
      for (let attempt = 0; !run; attempt++) {
        try { run = await client.startRun(session.id, options.assistantMessageId, spec, "desktop"); }
        catch (error) {
          if (error instanceof AgentError && error.code !== errors.unavailable || attempt >= 2 || this.detached) throw error;
          // Lost acknowledgements retry the exact admission key, never a new run.
          client = await this.connect(options.workspacePath);
        }
      }
      this.active = { id: run.id, client };
      if (this.cancelRequested) await client.call("runs.cancel", { id: run.id });
      const result = await this.observe(client, run, session.id, callbacks, openPreview);
      if (result.state !== "completed")
        throw new Error(result.error || "Execution did not complete.");
      return result.result as {
        message: DesktopMessage;
        changes: DesktopChange[];
      };
    } finally {
      this.preparing = false;
      this.active = undefined;
      this.setState(undefined);
    }
  }
  private observe(
    client: AgentClient, run: Run, sessionId: string,
    callbacks: RuntimeOptions["callbacks"], openPreview: RuntimeOptions["openPreview"],
  ): Promise<Run> {
    this.setState(run.state);
    return this.observeWithReconnect(client, run, sessionId, callbacks, openPreview);
  }
  private async observeWithReconnect(
    client: AgentClient, run: Run, sessionId: string,
    callbacks: RuntimeOptions["callbacks"], openPreview: RuntimeOptions["openPreview"],
  ): Promise<Run> {
    let cursor = 0;
    const hostResponses: HostResponses = new Map();
    for (let attempt = 0; ; attempt++) {
      try { return await client.waitForRun(
      run.id,
      sessionId,
        (event) => {
          const data = event.data as {
            messageId: string;
            delta: string;
            step: DesktopExecutionStep;
          };
          if (event.type === "run.state") this.setState((event.data as { state: RunState }).state);
          if (event.type === "desktop.delta")
            callbacks.delta(data.messageId, data.delta);
          else if (event.type === "desktop.reset")
            callbacks.reset(data.messageId);
          else if (event.type === "desktop.step")
            callbacks.step(data.messageId, data.step);
          else if (event.type === "desktop.activity")
            callbacks.activity(event.data as DesktopActivity);
        },
        async (request) => {
          if (request.kind === "approval")
            return callbacks.approval(
              { ...(request.payload as Parameters<typeof callbacks.approval>[0]), id: request.id },
            );
          const preview = request.payload as { operation: string; url: string };
          if (preview.operation === "preview") {
            await openPreview(preview.url);
            return { opened: true };
          }
          throw new Error("Unknown desktop host request.");
        },
        undefined,
        { cursor, onCursor: (value) => { cursor = value; }, hostResponses, onState: (state) => this.setState(state) },
      );
      } catch (error) {
        if (this.detached || attempt >= 2 || !(error instanceof AgentError) || error.code !== errors.unavailable) throw error;
        this.setState("awaiting_host");
        client = await this.connect(client.options.credential.registration.workspace);
        this.active = { id: run.id, client };
        const current = await client.call<Run>("runs.get", { id: run.id });
        if (current.state === "awaiting_host" || current.state === "awaiting_approval")
          await client.call("runs.resume", { id: run.id });
      }
    }
  }

  async recover(
    workspace: string,
    handler: (run: RecoverableDesktopRun) => DesktopRecoveryHandler | undefined,
  ): Promise<void> {
    if (this.running) return;
    this.preparing = true;
    try {
      const client = await this.connect(workspace);
      const sessions = await client.call<Session[]>("sessions.list");
      for (const session of sessions) {
        const runs = await client.call<Run[]>("runs.list", { sessionId: session.id });
        for (const run of [...runs].reverse()) {
          if (this.detached) return;
          const description = await client.call<RecoverableDesktopRun | { profile: "generic" }>("runs.describe", { id: run.id });
          if (description.profile !== "desktop") continue;
          const projection = handler(description);
          if (!projection) continue;
          this.active = { id: run.id, client };
          if (run.state === "awaiting_host" || run.state === "awaiting_approval")
            await client.call("runs.resume", { id: run.id });
          const result = await this.observe(client, run, session.id, projection.callbacks, projection.openPreview);
          if (result.state === "completed")
            await projection.complete(result.result as { message: DesktopMessage; changes: DesktopChange[] });
          else await projection.complete({ message: {
            id: description.assistantMessageId, role: "assistant", text: result.error || "A execução foi interrompida.",
            createdAt: result.updatedAt, status: "failed",
          }, changes: [] });
          this.active = undefined;
        }
      }
    } finally {
      this.preparing = false;
      this.active = undefined;
      this.setState(undefined);
    }
  }
}
