import { createHash, randomUUID } from "node:crypto";
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
  type ToolSpec,
} from "../../contracts/src/index";
import { namespace } from "./security";
import { Store } from "./store";
import { OllamaDesktopRuntime } from "../../agent-core/src/desktop-runtime";
import { desktopRunSpec } from "../../contracts/src/desktop";

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
  private readonly pending = new Map<string, Pending>();
  private readonly credentialLeases = new Map<string, Map<string, string>>();
  private readonly checkpointers = new Map<string, SqliteSaver>();
  private readonly specs = new Map<string, RunSpec>();
  private readonly desktopRuntimes = new Map<string, OllamaDesktopRuntime>();
  private readonly advisors = new Map<string, AbortController>();
  private readonly credentialUsers = new Map<string, number>();
  private readonly credentialTimers = new Map<string, NodeJS.Timeout>();
  constructor(
    readonly store: Store,
    readonly directory: string,
    private readonly executor: GraphExecutor = executeGraph,
    private readonly buildInfo: {
      commit?: string;
      target?: string;
      manifestSha256?: string;
    } = {},
  ) {
    store.recover();
  }
  private checkpoint(reg: Registration): SqliteSaver {
    const ns = namespace(reg);
    let saver = this.checkpointers.get(ns);
    if (!saver) {
      const directory = path.join(this.directory, "namespaces", ns);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite"));
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
    // Leased secrets must not reach event/history persistence, even through provider errors.
    let encoded = JSON.stringify(data);
    for (const secret of this.credentialLeases.get(reg.id)?.values() ?? [])
      if (secret) encoded = encoded.split(secret).join("[credential redacted]");
    this.store.append(reg, session, type, JSON.parse(encoded), run);
  }
  private protect<T>(reg: Registration, value: T): T {
    let encoded = JSON.stringify(value ?? null);
    for (const secret of this.credentialLeases.get(reg.id)?.values() ?? [])
      if (secret) encoded = encoded.split(secret).join("[credential redacted]");
    return JSON.parse(encoded) as T;
  }
  async dispatch(
    reg: Registration,
    method: string,
    params: unknown,
    connection: string,
  ): Promise<unknown> {
    // Scope comes exclusively from the authenticated immutable registration.
    const p = params ?? {};
    switch (method) {
      case "desktop.ollamaStatus":
        return this.desktop(reg).ollamaStatus();
      case "desktop.dockerStatus":
        return this.desktop(reg).dockerStatus();
      case "desktop.configureDocker": {
        const v = z.object({ enabled: z.boolean() }).strict().parse(p);
        this.desktop(reg).configureDockerSandbox(v.enabled);
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
      case "desktop.cancel":
        this.desktop(reg).cancel();
        return { accepted: true };
      case "desktop.start": {
        const v = z
          .object({
            sessionId: identifier,
            key: identifier,
            spec: desktopRunSpec,
          })
          .strict()
          .parse(p);
        if (v.spec.workspacePath !== reg.workspace)
          throw new AgentError(
            errors.forbidden,
            "Workspace must match the installed client registration.",
          );
        const runtime = this.desktop(reg),
          created = this.store.start(reg, v.sessionId, v.key, v.spec);
        if (created.created) {
          const run = created.run;
          void runtime
            .run({
              ...v.spec,
              openPreview: async (url) => {
                await this.wait(reg, run, "tool", {
                  operation: "preview",
                  url,
                });
              },
              callbacks: {
                approval: async (request) =>
                  (await this.wait(reg, run, "approval", request)) === true,
                activity: (activity) =>
                  this.emit(
                    reg,
                    run.sessionId,
                    run.id,
                    "desktop.activity",
                    activity,
                  ),
                delta: (messageId, delta) =>
                  this.emit(reg, run.sessionId, run.id, "desktop.delta", {
                    messageId,
                    delta,
                  }),
                step: (messageId, step) =>
                  this.emit(reg, run.sessionId, run.id, "desktop.step", {
                    messageId,
                    step,
                  }),
                reset: (messageId) =>
                  this.emit(reg, run.sessionId, run.id, "desktop.reset", {
                    messageId,
                  }),
              },
            })
            .then((result) =>
              this.store.updateRun(reg, run.id, "completed", { result }),
            )
            .catch((error) =>
              this.store.updateRun(reg, run.id, "failed", {
                error: error instanceof Error ? error.message : "Run failed.",
              }),
            );
        }
        return created.run;
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
          ],
        };
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
      case "sessions.import": {
        const v = z
          .object({ key: identifier, domain: z.unknown() })
          .strict()
          .parse(p);
        return this.store.importDomain(reg, v.key, v.domain);
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
        return this.store.snapshot(reg, v.sessionId);
      }
      case "credentials.lease": {
        const v = z
          .object({
            reference: identifier,
            value: z.string().min(1).max(16384),
          })
          .strict()
          .parse(p);
        const leases =
          this.credentialLeases.get(reg.id) ?? new Map<string, string>();
        leases.set(v.reference, v.value);
        this.credentialLeases.set(reg.id, leases);
        clearTimeout(this.credentialTimers.get(reg.id));
        const expire = () => {
          if ((this.credentialUsers.get(reg.id) ?? 0) > 0) {
            const timer = setTimeout(expire, 300_000);
            timer.unref();
            this.credentialTimers.set(reg.id, timer);
          } else {
            this.credentialLeases.delete(reg.id);
            this.credentialTimers.delete(reg.id);
          }
        };
        const timer = setTimeout(expire, 300_000);
        timer.unref();
        this.credentialTimers.set(reg.id, timer);
        return { accepted: true };
      }
      case "runs.start": {
        const v = z
          .object({ sessionId: identifier, key: identifier, spec: runSpec })
          .strict()
          .parse(p);
        v.spec = this.protect(reg, v.spec);
        validateProvider(reg, v.spec.provider);
        const created = this.store.start(reg, v.sessionId, v.key, v.spec);
        if (created.created) {
          this.store.append(
            reg,
            v.sessionId,
            "message.user",
            [...v.spec.messages]
              .reverse()
              .find((message) => message.role === "user") ?? null,
            created.run.id,
          );
          this.specs.set(created.run.id, v.spec);
          // Run specs have references only, never credentials. Required for explicit restart recovery.
          this.store.saveReceipt(
            reg,
            created.run.id,
            `spec:${created.run.id}`,
            "configuration",
            v.spec,
          );
          this.launch(reg, created.run, v.spec);
        }
        return this.store.run(reg, created.run.id);
      }
      case "runs.get":
        return this.store.run(
          reg,
          z.object({ id: identifier }).strict().parse(p).id,
        );
      case "runs.list":
        return this.store.runs(
          reg,
          z.object({ sessionId: identifier }).strict().parse(p).sessionId,
        );
      case "runs.cancel": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const run = this.store.run(reg, id);
        if (terminalStates.has(run.state)) return run;
        this.running.get(id)?.abort(new Error("Cancelled by user."));
        for (const [key, wait] of this.pending)
          if (wait.run === id) {
            wait.reject(new Error("Cancelled by user."));
            this.pending.delete(key);
          }
        return this.store.updateRun(reg, id, "cancelled");
      }
      case "runs.resume": {
        const { id } = z.object({ id: identifier }).strict().parse(p);
        const run = this.store.run(reg, id);
        if (terminalStates.has(run.state))
          throw new AgentError(
            errors.conflict,
            "A terminal run cannot be resumed.",
          );
        if (run.state === "awaiting_reconciliation")
          throw new AgentError(
            errors.reconciliation,
            "Reconcile the unknown tool effect before continuing.",
          );
        const spec =
          this.specs.get(id) ??
          (this.store.receipt(reg, `spec:${id}`)?.value as RunSpec | undefined);
        if (!spec)
          throw new AgentError(
            errors.unavailable,
            "Run configuration is unavailable.",
          );
        if (this.running.has(id)) {
          for (const wait of this.pending.values())
            if (wait.run === id) wait.delivered = undefined;
          return run;
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
        if (!wait || wait.reg.id !== reg.id || wait.delivered !== connection)
          throw new AgentError(
            errors.forbidden,
            "Request does not belong to this client connection.",
          );
        if (method === "approvals.respond" && wait.kind !== "approval")
          throw new AgentError(errors.invalid, "Not an approval request.");
        this.pending.delete(v.id);
        wait.resolve(v.value);
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
        const run = this.store.run(reg, v.runId);
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
      case "goals.list":
        return (
          this.store.db
            .prepare("SELECT value FROM goals WHERE namespace=?")
            .all(namespace(reg)) as { value: string }[]
        ).map((r) => JSON.parse(r.value));
      case "goals.put": {
        const v = z
          .object({ id: identifier, value: z.record(z.string(), z.unknown()) })
          .strict()
          .parse(p);
        this.store.db
          .prepare(
            "INSERT INTO goals VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value",
          )
          .run(namespace(reg), v.id, JSON.stringify(v.value));
        return v;
      }
      default:
        throw new AgentError(-32601, "Method not found.");
    }
  }
  private launch(reg: Registration, run: Run, spec: RunSpec): void {
    const credential = spec.provider.credentialRef
      ? this.credentialLeases.get(reg.id)?.get(spec.provider.credentialRef)
      : undefined;
    if (spec.provider.credentialRef && !credential) {
      this.store.updateRun(reg, run.id, "awaiting_credentials");
      return;
    }
    const controller = new AbortController();
    this.credentialUsers.set(
      reg.id,
      (this.credentialUsers.get(reg.id) ?? 0) + 1,
    );
    this.running.set(run.id, controller);
    this.store.updateRun(reg, run.id, "running");
    void this.executor(spec, {
      registration: reg,
      threadId: run.id,
      checkpointer: this.checkpoint(reg),
      signal: controller.signal,
      credential,
      reconciliations: Object.fromEntries(
        (
          this.store.db
            .prepare(
              "SELECT id,value FROM receipts WHERE namespace=? AND run=? AND status='reconciled'",
            )
            .all(namespace(reg), run.id) as { id: string; value: string }[]
        ).map((row) => [
          row.id.slice(run.id.length + 1),
          JSON.parse(row.value),
        ]),
      ),
      emit: (type, data) => this.emit(reg, run.sessionId, run.id, type, data),
      invokeTool: (definition, input, callId) =>
        this.invokeTool(reg, run, spec, definition, input, callId),
    })
      .then((result) => {
        if (!controller.signal.aborted)
          this.store.updateRun(reg, run.id, "completed", {
            result: this.protect(reg, result),
          });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        let message = error instanceof Error ? error.message : "Run failed.";
        for (const secret of this.credentialLeases.get(reg.id)?.values() ?? [])
          message = message.split(secret).join("[credential redacted]");
        const state = this.store.run(reg, run.id).state;
        const authenticationFailed =
          Boolean(spec.provider.credentialRef) &&
          [401, 403].includes(Number((error as { status?: number })?.status));
        this.store.updateRun(
          reg,
          run.id,
          state === "awaiting_reconciliation"
            ? state
            : authenticationFailed
              ? "awaiting_credentials"
              : "failed",
          { error: message },
        );
      })
      .finally(() => {
        this.running.delete(run.id);
        const remaining = (this.credentialUsers.get(reg.id) ?? 1) - 1;
        if (remaining > 0) this.credentialUsers.set(reg.id, remaining);
        else {
          this.credentialUsers.delete(reg.id);
          this.credentialLeases.delete(reg.id);
          clearTimeout(this.credentialTimers.get(reg.id));
          this.credentialTimers.delete(reg.id);
        }
      });
  }
  private async invokeTool(
    reg: Registration,
    run: Run,
    spec: RunSpec,
    definition: ToolSpec,
    input: unknown,
    callId: string,
  ): Promise<unknown> {
    const id = `${run.id}:${callId}`,
      prior = this.store.receipt(reg, id);
    if (prior?.status === "completed" || prior?.status === "reconciled")
      return prior.value;
    if (prior?.status === "started") {
      this.store.updateRun(reg, run.id, "awaiting_reconciliation");
      throw new AgentError(
        errors.reconciliation,
        "Tool may have executed; automatic repetition is prohibited.",
      );
    }
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
    // Mark before handing off. A crash between handoff and receipt is an unknown effect.
    this.store.saveReceipt(reg, run.id, id, "started", {
      tool: definition.name,
      inputHash: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
    });
    const result = await this.wait(reg, run, "tool", {
      tool: definition.name,
      input,
      callId,
    });
    const safeResult = this.protect(reg, result);
    this.store.saveReceipt(reg, run.id, id, "completed", safeResult);
    this.emit(reg, run.sessionId, run.id, "tool.receipt", {
      tool: definition.name,
      callId,
      status: "completed",
    });
    return safeResult;
  }
  private wait(
    reg: Registration,
    run: Run,
    kind: Pending["kind"],
    payload: unknown,
  ): Promise<unknown> {
    const id = randomUUID();
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
          this.store.updateRun(reg, run.id, "running");
          resolve(value);
        },
        reject,
      });
    });
  }
  disconnect(connection: string): void {
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
  close(): void {
    for (const timer of this.credentialTimers.values()) clearTimeout(timer);
    this.credentialLeases.clear();
    for (const controller of this.running.values()) controller.abort();
    for (const wait of this.pending.values())
      wait.reject(new Error("Service stopping."));
    for (const saver of this.checkpointers.values()) saver.db.close();
    this.store.close();
  }
}
