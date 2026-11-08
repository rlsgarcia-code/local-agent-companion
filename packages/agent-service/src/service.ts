import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { contentHash, canonical } from "../../contracts/src/identity";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync, chmodSync } from "node:fs";
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
  errors,
  identifier,
  NODE_VERSION,
  PROTOCOL_VERSION,
  negotiate,
  runSpec,
  terminalStates,
  type Registration,
  type Run,
  type RunSpec,
  type SessionSnapshot,
  type ToolSpec,
} from "../../contracts/src/index";
import { namespace } from "./security";
import { Store } from "./store";
import { Transfers } from "./transfers";
import { Goals } from "./goals";
import { CredentialVault } from "./credentials";
import { ProductMemory } from "./memory";
import { Models } from "./models";
import { memoryRead, memoryWrite } from "../../contracts/src/memory";
import { goalCreate, goalEdit, goalRecord, goalEvaluation } from "../../contracts/src/goals";
import { transferBegin, transferAppend, sessionImport, TRANSFER_CHUNK_BYTES } from "../../contracts/src/transfers";
import { OllamaDesktopRuntime } from "../../agent-core/src/desktop-runtime";
import { desktopRunSpec } from "../../contracts/src/desktop";

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
  private readonly desktopRuntimes = new Map<string, OllamaDesktopRuntime>();
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
    options: { deferRecovery?: boolean } = {},
  ) {
    this.transfers = new Transfers(store);
    this.goals = new Goals(store);
    this.memory = new ProductMemory(store);
    this.models = new Models(store, directory);
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
  private protect<T>(reg: Registration, value: T): T {
    const secrets = this.secrets(reg).flatMap((secret) =>
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
  private validateRun(reg: Registration, spec: DurableSpec): void {
    if ("profile" in spec) {
      if (reg.product !== "companion-mac" || spec.spec.workspacePath !== reg.workspace)
        throw new AgentError(errors.forbidden, "Desktop profile does not match this installed client.");
      return;
    }
    validateProvider(reg, spec.provider);
    for (const definition of spec.tools) {
      const installed = reg.toolCatalog?.find((tool) => tool.name === definition.name);
      if (!installed || canonical(installed) !== canonical(definition))
        throw new AgentError(errors.forbidden, "Tool definition must match the installed adapter catalog.");
    }
  }
  private readRun(reg: Registration, id: string): Run {
    const run = this.store.run(reg, id);
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
    if (this.quiescing && method !== "engine.info")
      throw new AgentError(errors.unavailable, "Engine is activating a prepared update. Reconnect with the updated client.");
    // Scope comes exclusively from the authenticated immutable registration.
    const p = params ?? {};
    switch (method) {
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
        const created = this.store.start(reg, v.sessionId, v.key, spec);
        if (created.created) this.start(reg, created.run, spec);
        return this.store.run(reg, created.run.id);
      }
      case "engine.info":
        return {
          version: ENGINE_VERSION,
          protocol: PROTOCOL_VERSION,
          node: process.versions.node,
          requiredNode: NODE_VERSION,
          product: reg.product,
          build: this.buildInfo,
          capabilities: [
            "sessions",
            "runs",
            "events",
            "approvals",
            "goals",
            "sqlite-checkpoints",
            "chunked-transfers",
            "durable-approvals",
            "bound-tool-receipts",
            "ollama-model-jobs",
            "public-session-snapshots",
          ],
        };
      case "engine.shutdownIfIdle": {
        z.object({}).strict().parse(p);
        const active = this.store.db.prepare("SELECT id FROM runs WHERE state NOT IN ('completed','failed','cancelled') LIMIT 1").get();
        if (active || this.running.size || this.advisors.size || this.models.busy || [...this.desktopRuntimes.values()].some((runtime) => runtime.hasActiveResources))
          return { accepted: false, reason: "Work is active. The prepared update will wait without cancelling it." };
        this.quiescing = true;
        return { accepted: true };
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
          modelConfiguration: reg.product !== "kidos" && reg.providers.includes("ollama") ? this.models.configuration(reg) : null,
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
        } : { profile: "generic" }) };
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
          const unknown = this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1").get(id);
          this.store.updateRun(reg, id, unknown ? "awaiting_reconciliation" : "cancelled");
        }
        return this.store.run(reg, id);
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
      case "host.poll": {
        z.object({}).strict().parse(p);
        return [...this.pending.entries()]
          .filter(
            ([, w]) =>
              w.reg.id === reg.id &&
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
        if (!wait || wait.reg.id !== reg.id || wait.delivered !== connection)
          throw new AgentError(
            errors.forbidden,
            "Request does not belong to this client connection.",
          );
        if (method === "approvals.respond" && wait.kind !== "approval")
          throw new AgentError(errors.invalid, "Not an approval request.");
        if (wait.kind === "approval" && typeof v.value !== "boolean")
          throw new AgentError(errors.invalid, "Approval decisions must be boolean.");
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
      case "tools.reconcile": {
        const v = z
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
        this.store.saveReceipt(
          reg,
          v.runId,
          `${v.runId}:${v.callId}`,
          "reconciled",
          this.protect(reg, v.result),
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
    const provider = "profile" in spec ? undefined : spec.provider;
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
          execution: {
            threadId: run.id,
            signal: controller.signal,
            reconciliations,
            requireCheckpoint,
            operation: (id, tool, args, perform) => this.operation(reg, run, id, tool, args, perform),
          },
          openPreview: async (url) => { await this.wait(reg, run, "tool", { operation: "preview", url }); },
          callbacks: {
            approval: async (request) => (await this.wait(reg, run, "approval", request)) === true,
            activity: (value) => this.emit(reg, run.sessionId, run.id, "desktop.activity", value),
            delta: (messageId, delta) => this.emit(reg, run.sessionId, run.id, "desktop.delta", { messageId, delta }),
            step: (messageId, step) => this.emit(reg, run.sessionId, run.id, "desktop.step", { messageId, step }),
            reset: (messageId) => this.emit(reg, run.sessionId, run.id, "desktop.reset", { messageId }),
          },
        })
      : this.executor(spec, {
          registration: reg,
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
          resolveAttachment: async (id) => this.transfers.image(reg, id),
          emit: (type, data) => this.emit(reg, run.sessionId, run.id, type, data),
          invokeTool: (definition, input, callId) => this.invokeTool(reg, run, spec, definition, input, callId),
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
      .catch((error) => {
        if (this.closed || controller.signal.aborted) return;
        let message = error instanceof Error ? error.message : "Run failed.";
        for (const secret of this.secrets(reg))
          message = message.split(secret).join("[credential redacted]");
        const state = this.store.run(reg, run.id).state;
        if (state === "awaiting_host" && error instanceof AgentError && error.code === errors.reconciliation &&
          !this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1").get(run.id))
          return; // A host reconciled the receipt while the interrupted graph was settling.
        const authenticationFailed =
          Boolean(provider?.credentialRef) &&
          [401, 403].includes(Number((error as { status?: number })?.status));
        this.store.updateRun(
          reg,
          run.id,
          state === "awaiting_reconciliation" || (error instanceof AgentError && error.code === errors.reconciliation)
            ? "awaiting_reconciliation"
            : authenticationFailed
              ? "awaiting_credentials"
              : "failed",
          { error: message },
        );
      })
      .finally(() => {
        if (!this.closed && controller.signal.aborted) {
          const unknown = this.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started' LIMIT 1").get(run.id);
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
  private async invokeTool(
    reg: Registration,
    run: Run,
    spec: RunSpec,
    definition: ToolSpec,
    input: unknown,
    callId: string,
  ): Promise<unknown> {
    if (reg.product === "kidos")
      throw new AgentError(errors.forbidden, "KidOS system tools require the signed service-side Core adapter. UI tool callbacks cannot execute them.");
    if (spec.mode === "plan" && definition.effect !== "read")
      throw new AgentError(errors.forbidden, "Mutation denied in plan mode.");
    if (
      definition.effect !== "read" &&
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
  private async operation(
    reg: Registration, run: Run, callId: string, tool: string, input: unknown,
    perform: () => Promise<unknown>,
    evidenceKind: NonNullable<ToolSpec["evidenceKind"]> = "note",
  ): Promise<unknown> {
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
      this.store.saveReceipt(reg, run.id, `wait:${id}`, "waiting", normalized, binding);
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
        payload,
        resolve: (value) => {
          if (operation && kind === "approval") {
            const effect = this.store.receipt(reg, operation);
            if (effect) this.store.saveReceipt(reg, run.id, operation, "started", effect.value, effect.binding);
          }
          this.store.updateRun(reg, run.id, "running");
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
    this.credentials.clear();
    for (const controller of this.running.values()) controller.abort();
    for (const wait of this.pending.values())
      wait.reject(new Error("Service stopping."));
    this.pending.clear();
    const resources = [...this.desktopRuntimes.values()].map((runtime) => runtime.shutdown());
    resources.push(this.models.close());
    for (const controller of this.advisors.values()) controller.abort();
    for (const saver of this.checkpointers.values()) saver.db.close();
    this.store.close();
    this.closing = Promise.allSettled(resources).then(() => {});
    return this.closing;
  }
}
