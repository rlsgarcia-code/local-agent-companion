import { randomUUID } from "node:crypto";
import { z } from "zod";
import { OllamaModels } from "../../agent-core/src/ollama-models";
import { OLLAMA_CATALOG } from "../../agent-core/src/ollama-catalog";
import { detectMachineProfile, mergeOllamaCandidates, OllamaRecommendationEngine } from "../../agent-core/src/ollama-recommendation";
import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";
import { modelConfiguration, modelDownload, modelRecommendation, type ModelJob } from "../../contracts/src/models";
import { publicOllamaCatalogSchema } from "../../agent-core/src/ollama-recommendation";
import { namespace } from "./security";
import type { Store } from "./store";

type ModelAdapter = Pick<OllamaModels, "ollamaStatus" | "invokeAdvisor" | "pullModel" | "cancelDownload">;
export class Models {
  private readonly tasks = new Map<string, { controller: AbortController; promise: Promise<void>; job: ModelJob }>();
  private download?: string;
  private closed = false;
  constructor(private readonly store: Store, private readonly directory: string,
    private readonly adapter: ModelAdapter = new OllamaModels()) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS model_configurations(namespace TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_jobs(id TEXT PRIMARY KEY,namespace TEXT NOT NULL,request_key TEXT NOT NULL,binding TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(namespace,request_key));`);
  }
  recover(): void {
    for (const row of this.store.db.prepare("SELECT id,value FROM model_jobs").all() as { id: string; value: string }[]) {
      const job = JSON.parse(row.value) as ModelJob;
      if (["running", "cancelling"].includes(job.state)) {
        job.state = "interrupted"; job.updatedAt = Date.now();
        job.error = "The engine restarted. Start a new explicit model job to continue; conversations were not cancelled.";
        this.store.db.prepare("UPDATE model_jobs SET value=? WHERE id=?").run(JSON.stringify(job), row.id);
      }
    }
  }
  get busy(): boolean { return this.tasks.size > 0; }
  private authorize(reg: Registration): void {
    if (reg.product === "kidos" || !reg.providers.includes("ollama"))
      throw new AgentError(errors.forbidden, "This client cannot manage Ollama models. KidOS model selection belongs to its system authority.");
  }
  async status(reg: Registration) { this.authorize(reg); return this.adapter.ollamaStatus(); }
  configuration(reg: Registration): z.infer<typeof modelConfiguration> | null {
    this.authorize(reg);
    const row = this.store.db.prepare("SELECT value FROM model_configurations WHERE namespace=?").get(namespace(reg)) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  configure(reg: Registration, input: unknown) {
    this.authorize(reg); const value = modelConfiguration.parse(input);
    if (value.revision !== (this.configuration(reg)?.revision ?? 0)) throw new AgentError(errors.conflict, "Refresh model settings before changing them.");
    const next = { ...value, revision: value.revision + 1 };
    this.store.db.prepare("INSERT INTO model_configurations VALUES(?,?) ON CONFLICT(namespace) DO UPDATE SET value=excluded.value").run(namespace(reg), JSON.stringify(next));
    return next;
  }
  get(reg: Registration, id: string): ModelJob {
    const row = this.store.db.prepare("SELECT value FROM model_jobs WHERE namespace=? AND id=?").get(namespace(reg), id) as { value: string } | undefined;
    if (!row) throw new AgentError(errors.missing, "Model job not found.");
    return JSON.parse(row.value);
  }
  list(reg: Registration): ModelJob[] {
    return (this.store.db.prepare("SELECT value FROM model_jobs WHERE namespace=? ORDER BY rowid DESC LIMIT 100").all(namespace(reg)) as { value: string }[]).map((row) => JSON.parse(row.value));
  }
  private save(job: ModelJob): void {
    if (!this.closed) this.store.db.prepare("UPDATE model_jobs SET value=? WHERE id=?").run(JSON.stringify({ ...job, updatedAt: Date.now() }), job.id);
  }
  private start(reg: Registration, key: string, kind: ModelJob["kind"], input: unknown,
    perform: (job: ModelJob, signal: AbortSignal) => Promise<unknown>): ModelJob {
    this.authorize(reg); if (this.closed) throw new AgentError(errors.unavailable, "Model service is stopping.");
    const binding = contentHash({ kind, input });
    const previous = this.store.db.prepare("SELECT id,binding FROM model_jobs WHERE namespace=? AND request_key=?").get(namespace(reg), key) as { id: string; binding: string } | undefined;
    if (previous) {
      if (previous.binding !== binding) throw new AgentError(errors.conflict, "Model job key was used for different content.");
      return this.get(reg, previous.id);
    }
    if (kind === "download" && this.download) throw new AgentError(errors.conflict, "Another model download is active. It must finish or be cancelled by its owner.");
    const job: ModelJob = { id: randomUUID(), kind, state: "running", createdAt: Date.now(), updatedAt: Date.now() };
    if (kind === "download") job.model = (input as { model: string }).model;
    this.store.db.prepare("INSERT INTO model_jobs VALUES(?,?,?,?,?)").run(job.id, namespace(reg), key, binding, JSON.stringify(job));
    if (kind === "download") this.download = job.id;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => perform(job, controller.signal)).then((result) => {
      job.state = controller.signal.aborted ? "cancelled" : "completed"; job.result = result;
    }, (error: unknown) => {
      job.state = controller.signal.aborted ? "cancelled" : "failed";
      job.error = error instanceof Error ? error.message : "Model operation failed.";
    }).finally(() => { this.save(job); this.tasks.delete(job.id); if (this.download === job.id) this.download = undefined; });
    this.tasks.set(job.id, { controller, promise, job });
    return this.get(reg, job.id);
  }
  pull(reg: Registration, input: unknown): ModelJob {
    const value = modelDownload.parse(input);
    return this.start(reg, value.key, "download", { model: value.model }, async (job, signal) => {
      signal.throwIfAborted();
      const cancel = () => this.adapter.cancelDownload();
      signal.addEventListener("abort", cancel, { once: true });
      try { await this.adapter.pullModel(value.model, (progress) => { job.progress = progress; this.save(job); }); }
      finally { signal.removeEventListener("abort", cancel); }
      return { model: value.model };
    });
  }
  recommend(reg: Registration, input: unknown): ModelJob {
    const value = modelRecommendation.parse(input);
    const catalog = value.publicCatalog === undefined ? undefined : publicOllamaCatalogSchema.parse(value.publicCatalog);
    return this.start(reg, value.key, "recommendation", value, async (_job, signal) => {
      signal.throwIfAborted(); const status = await this.adapter.ollamaStatus();
      if (!status.connected) throw new Error(status.error || "Start Ollama before analyzing models.");
      signal.throwIfAborted();
      const candidates = mergeOllamaCandidates({ bundled: OLLAMA_CATALOG, publicCatalog: catalog, installed: status.models });
      const machine = await detectMachineProfile(this.directory, status.version);
      return new OllamaRecommendationEngine().recommend({ machine, candidates,
        supportedRoles: ["executor", "planner", "evaluator", "vision", "embedding"],
        installedDockerImages: value.installedDockerImages, advisorModel: value.advisorModel,
        ...(value.advisorModel ? { invokeAdvisor: (prompt: string) => this.adapter.invokeAdvisor(value.advisorModel!, prompt, signal) } : {}),
      });
    });
  }
  cancel(reg: Registration, id: string): ModelJob {
    const job = this.get(reg, id), task = this.tasks.get(id);
    if (task) { task.job.state = "cancelling"; this.save(task.job); task.controller.abort(); }
    return this.get(reg, id);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const task of this.tasks.values()) task.controller.abort();
    await Promise.allSettled([...this.tasks.values()].map((task) => task.promise));
  }
}
