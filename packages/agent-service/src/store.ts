import Database from "better-sqlite3";
import { chmodSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  AgentError,
  errors,
  terminalStates,
  type ClientCredential,
  type EngineEvent,
  type Registration,
  type Run,
  type RunState,
  type Session,
} from "../../contracts/src/index";
import {
  namespace,
  tokenDigest,
  tokenMatches,
  validateProductRegistration,
} from "./security";

import { canonical } from "../../contracts/src/identity";
import { enforceSystemProvisioning } from "./provisioning";

export class Store {
  readonly db: Database.Database;
  encodeEvent: (reg: Registration, data: unknown) => unknown = (_reg, data) => data;
  constructor(file: string) {
    this.db = new Database(file);
    if (file !== ":memory:" && process.platform !== "win32")
      chmodSync(file, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY, registration TEXT NOT NULL, token TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, namespace TEXT NOT NULL, value TEXT NOT NULL, import_key TEXT, UNIQUE(namespace,import_key));
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, namespace TEXT NOT NULL, session TEXT NOT NULL REFERENCES sessions(id), request_key TEXT NOT NULL, request_hash TEXT NOT NULL, state TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(namespace,request_key));
      CREATE UNIQUE INDEX IF NOT EXISTS one_run_per_session ON runs(session) WHERE state NOT IN ('completed','failed','cancelled');
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, namespace TEXT NOT NULL, session TEXT NOT NULL, run TEXT, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, namespace TEXT NOT NULL, run TEXT NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operation_identities(id TEXT PRIMARY KEY REFERENCES receipts(id), kind TEXT NOT NULL, tool TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS imports(namespace TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key));
      CREATE TABLE IF NOT EXISTS session_domains(namespace TEXT NOT NULL, session TEXT PRIMARY KEY REFERENCES sessions(id), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS goals(namespace TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS leases(workspace TEXT PRIMARY KEY, run TEXT NOT NULL UNIQUE REFERENCES runs(id));
    `);
    const columns = this.db.pragma("table_info(receipts)") as { name: string }[];
    if (!columns.some((column) => column.name === "binding"))
      this.db.exec("ALTER TABLE receipts ADD COLUMN binding TEXT");
  }
  register(credential: ClientCredential): void {
    validateProductRegistration(credential.registration);
    enforceSystemProvisioning(credential.registration);
    const previous = this.db
      .prepare("SELECT registration FROM clients WHERE id=?")
      .get(credential.registration.id) as { registration: string } | undefined;
    if (
      previous &&
      canonical(JSON.parse(previous.registration)) !== canonical(credential.registration)
    )
      throw new AgentError(
        errors.conflict,
        "Registration is immutable; provision a new client identity.",
      );
    this.db
      .prepare(
        "INSERT INTO clients VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET token=excluded.token",
      )
      .run(
        credential.registration.id,
        JSON.stringify(credential.registration),
        tokenDigest(credential.token),
      );
  }
  authenticate(id: string, token: string): Registration {
    const row = this.db
      .prepare("SELECT * FROM clients WHERE id=? AND revoked=0")
      .get(id) as { registration: string; token: string } | undefined;
    if (!row || !tokenMatches(token, row.token))
      throw new AgentError(
        errors.forbidden,
        "Client is not registered or was revoked.",
      );
    const registration = JSON.parse(row.registration) as Registration;
    validateProductRegistration(registration);
    enforceSystemProvisioning(registration);
    return registration;
  }
  revoke(id: string): void {
    this.db.prepare("UPDATE clients SET revoked=1 WHERE id=?").run(id);
  }
  createSession(
    reg: Registration,
    title: string,
    importedFrom?: string,
  ): Session {
    const ns = namespace(reg);
    if (importedFrom) {
      const existing = this.db
        .prepare(
          "SELECT value FROM sessions WHERE namespace=? AND import_key=?",
        )
        .get(ns, importedFrom) as { value: string } | undefined;
      if (existing) return JSON.parse(existing.value) as Session;
    }
    const session: Session = {
      id: randomUUID(),
      namespace: ns,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(importedFrom ? { importedFrom } : {}),
    };
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(session.id, ns, JSON.stringify(session), importedFrom ?? null);
    return session;
  }
  sessions(reg: Registration): Session[] {
    return (
      this.db
        .prepare(
          "SELECT value FROM sessions WHERE namespace=? ORDER BY rowid DESC",
        )
        .all(namespace(reg)) as { value: string }[]
    ).map((r) => JSON.parse(r.value) as Session);
  }
  session(reg: Registration, id: string): Session {
    const row = this.db
      .prepare("SELECT value FROM sessions WHERE namespace=? AND id=?")
      .get(namespace(reg), id) as { value: string } | undefined;
    if (!row)
      throw new AgentError(
        errors.missing,
        "Session not found in this product/profile/workspace.",
      );
    return JSON.parse(row.value) as Session;
  }
  start(
    reg: Registration,
    session: string,
    key: string,
    spec: unknown,
  ): { run: Run; created: boolean } {
    return this.db.transaction(() => {
      this.session(reg, session);
      const ns = namespace(reg),
        hash = createHash("sha256").update(canonical(spec)).digest("hex");
      const prior = this.db
        .prepare(
          "SELECT value, request_hash FROM runs WHERE namespace=? AND request_key=?",
        )
        .get(ns, key) as { value: string; request_hash: string } | undefined;
      if (prior) {
        const run = JSON.parse(prior.value) as Run;
        if (prior.request_hash !== hash || run.sessionId !== session)
          throw new AgentError(
            errors.conflict,
            "Idempotency key was used for a different request.",
          );
        return { run, created: false };
      }
      const active = this.db
        .prepare(
          "SELECT id FROM runs WHERE session=? AND state NOT IN ('completed','failed','cancelled')",
        )
        .get(session);
      if (active)
        throw new AgentError(
          errors.conflict,
          "A run is already active in this session.",
        );
      if (
        reg.workspace &&
        this.db
          .prepare("SELECT run FROM leases WHERE workspace=?")
          .get(reg.workspace)
      )
        throw new AgentError(
          errors.conflict,
          "Workspace is in use by another run.",
        );
      const run: Run = {
        id: randomUUID(),
        sessionId: session,
        state: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.db
        .prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?)")
        .run(run.id, ns, session, key, hash, run.state, JSON.stringify(run));
      // Persist the credential-free replay configuration in the same transaction
      // as admission and the workspace lease, before execution can start.
      this.saveReceipt(reg, run.id, `spec:${run.id}`, "configuration", spec);
      if (reg.workspace)
        this.db
          .prepare("INSERT INTO leases VALUES(?,?)")
          .run(reg.workspace, run.id);
      this.append(reg, session, "run.state", { state: run.state }, run.id);
      return { run, created: true };
    })();
  }
  run(reg: Registration, id: string): Run {
    const row = this.db
      .prepare("SELECT value FROM runs WHERE namespace=? AND id=?")
      .get(namespace(reg), id) as { value: string } | undefined;
    if (!row) throw new AgentError(errors.missing, "Run not found.");
    return JSON.parse(row.value) as Run;
  }
  runs(reg: Registration, sessionId: string): Run[] {
    this.session(reg, sessionId);
    return (
      this.db
        .prepare(
          "SELECT value FROM runs WHERE namespace=? AND session=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(namespace(reg), sessionId) as { value: string }[]
    ).map((row) => JSON.parse(row.value) as Run);
  }
  snapshot(
    reg: Registration,
    sessionId: string,
  ): { session: Session; runs: Run[]; events: EngineEvent[]; cursor: number; eventsComplete: boolean } {
    const session = this.session(reg, sessionId);
    const rows = this.db.prepare("SELECT sequence,value FROM events WHERE namespace=? AND session=? ORDER BY sequence DESC LIMIT 500")
      .all(namespace(reg), sessionId) as { sequence: number; value: string }[];
    const events: EngineEvent[] = [];
    let bytes = 0;
    for (const row of rows) {
      bytes += Buffer.byteLength(row.value);
      if (events.length && bytes > 4 * 1024 * 1024) break;
      events.push({ ...JSON.parse(row.value), sequence: row.sequence } as EngineEvent);
    }
    events.reverse();
    return {
      session,
      runs: this.runs(reg, sessionId),
      events,
      cursor: events.at(-1)?.sequence ?? 0,
      eventsComplete: !this.db.prepare("SELECT 1 FROM events WHERE namespace=? AND session=? AND sequence<? LIMIT 1")
        .get(namespace(reg), sessionId, events[0]?.sequence ?? 0),
    };
  }
  updateRun(
    reg: Registration,
    id: string,
    state: RunState,
    extra: { result?: unknown; error?: string } = {},
  ): Run {
    return this.db.transaction(() => {
      const run = {
        ...this.run(reg, id),
        ...extra,
        state,
        updatedAt: Date.now(),
      };
      if (["running", "completed", "cancelled"].includes(state) && !("error" in extra)) delete run.error;
      this.db
        .prepare("UPDATE runs SET state=?,value=? WHERE id=?")
        .run(state, JSON.stringify(run), id);
      if (terminalStates.has(state))
        this.db.prepare("DELETE FROM leases WHERE run=?").run(id);
      this.append(reg, run.sessionId, "run.state", { state, ...extra }, id);
      return run;
    })();
  }
  append(
    reg: Registration,
    sessionId: string,
    type: string,
    data: unknown,
    runId?: string,
    correlationId?: string,
  ): EngineEvent {
    this.session(reg, sessionId);
    const event = {
      id: randomUUID(),
      sequence: 0,
      sessionId,
      runId,
      timestamp: Date.now(),
      type,
      data: this.encodeEvent(reg, data),
      correlationId,
    };
    event.sequence = Number(
      this.db
        .prepare(
          "INSERT INTO events(namespace,session,run,value) VALUES(?,?,?,?)",
        )
        .run(namespace(reg), sessionId, runId ?? null, JSON.stringify(event))
        .lastInsertRowid,
    );
    return event;
  }
  events(
    reg: Registration,
    session: string,
    cursor = 0,
    limit = 500,
  ): EngineEvent[] {
    this.session(reg, session);
    const rows = this.db.prepare(
      "SELECT sequence,value FROM events WHERE namespace=? AND session=? AND sequence>? ORDER BY sequence LIMIT ?",
    ).all(namespace(reg), session, cursor, limit) as { sequence: number; value: string }[];
    const result: EngineEvent[] = [];
    let bytes = 0;
    for (const row of rows) {
      bytes += Buffer.byteLength(row.value);
      if (result.length && bytes > 4 * 1024 * 1024) break;
      result.push({ ...JSON.parse(row.value), sequence: row.sequence } as EngineEvent);
    }
    return result;
  }

  importDomain(reg: Registration, key: string, value: unknown): Session {
    const ns = namespace(reg),
      hash = createHash("sha256").update(canonical(value)).digest("hex");
    return this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT hash,value FROM imports WHERE namespace=? AND key=?")
        .get(ns, key) as { hash: string; value: string } | undefined;
      if (row) {
        if (row.hash !== hash)
          throw new AgentError(
            errors.conflict,
            "An imported source changed; use a new revision key.",
          );
        return JSON.parse(row.value) as Session;
      }
      const session = this.createSession(reg, "Imported conversation", key);
      const encoded = JSON.stringify(value);
      this.db.prepare("INSERT INTO session_domains VALUES(?,?,?)").run(ns, session.id, encoded);
      this.append(reg, session.id, "session.imported", {
        domainStored: true,
        checkpoint: "legacy_incompatible",
        requiresContinuation: true,
      });
      this.db
        .prepare("INSERT INTO imports VALUES(?,?,?,?)")
        .run(ns, key, hash, JSON.stringify(session));
      return session;
    })();
  }
  domain(reg: Registration, sessionId: string): unknown {
    this.session(reg, sessionId);
    const row = this.db.prepare("SELECT value FROM session_domains WHERE namespace=? AND session=?")
      .get(namespace(reg), sessionId) as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
    // Readers for foundation imports remain available during migration.
    for (const event of this.events(reg, sessionId)) {
      if (event.type === "session.imported") return (event.data as { domain?: unknown }).domain ?? {};
    }
    return {};
  }
  exportDomain(reg: Registration, sessionId: string, readResult?: (id: string) => unknown, throughRunId?: string): unknown {
    const imported = this.domain(reg, sessionId);
    const base = imported && typeof imported === "object" && !Array.isArray(imported)
      ? imported as Record<string, unknown> : { legacyDomain: imported };
    const thread = base.thread as { messages?: Record<string, unknown>[] } | undefined;
    const originalMessages = Array.isArray(base.messages) ? base.messages : thread?.messages ?? [];
    const messages: Record<string, unknown>[] = originalMessages.filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && ["user", "assistant"].includes((value as { role: string }).role)),
    ).map((value, index) => ({ ...value, id: value.id ?? `legacy-${index}`, content: value.content ?? value.text ?? "" }));
    const runs = (this.db.prepare("SELECT value FROM runs WHERE namespace=? AND session=? ORDER BY rowid")
      .all(namespace(reg), sessionId) as { value: string }[]).map((row) => JSON.parse(row.value) as Run);
    if (throughRunId && !runs.some((run) => run.id === throughRunId))
      throw new AgentError(errors.missing, "Branch point is not in this session.");
    let files = base.files;
    const exportedRuns: unknown[] = [];
    for (const run of runs) {
      const configuration = this.receipt(reg, `spec:${run.id}`)?.value as Record<string, unknown> | undefined;
      const desktop = configuration?.profile === "desktop" ? configuration.spec as Record<string, unknown> : undefined;
      const user = (configuration?.messages as { id?: string; role: string; content: unknown }[] | undefined)?.filter((message) => message.role === "user").at(-1);
      const prompt = desktop?.request ?? user?.content;
      if (prompt !== undefined) messages.push({ id: desktop?.userMessageId ?? user?.id ?? `${run.id}:user`, role: "user", content: prompt, createdAt: run.createdAt });
      let result = run.result as Record<string, unknown> | undefined;
      if (result?.kind === "agent-result-transfer" && typeof result.id === "string") {
        if (!readResult) throw new AgentError(errors.unavailable, "Export requires the stored result transfer reader.");
        result = readResult(result.id) as Record<string, unknown>;
      }
      if (result?.files) files = result.files;
      if (run.state === "completed" && result) {
        const message = result.message as Record<string, unknown> | undefined;
        messages.push(message ? { ...message, content: message.text ?? message.content ?? "" } : {
          id: `${run.id}:assistant`, role: "assistant", content: result.text ?? "", createdAt: run.updatedAt,
        });
      } else {
        let text = "";
        const events = this.db.prepare("SELECT value FROM events WHERE namespace=? AND run=? ORDER BY sequence").iterate(namespace(reg), run.id) as Iterable<{ value: string }>;
        for (const row of events) {
          const event = JSON.parse(row.value) as EngineEvent;
          let data = event.data as { kind?: string; id?: string; text?: string; delta?: string };
          if (data?.kind === "agent-event-transfer" && data.id) {
            if (!readResult) throw new AgentError(errors.unavailable, "Export requires the saved event transfer reader.");
            data = readResult(data.id) as typeof data;
          }
          if (event.type === "text.reset" || event.type === "desktop.reset") text = "";
          if (event.type === "text.delta") text += data.text ?? "";
          if (event.type === "desktop.delta") text += data.delta ?? "";
          if (event.type === "text.final") text = data.text ?? text;
        }
        if (text) messages.push({ id: `${run.id}:assistant`, role: "assistant", content: text, status: "interrupted", createdAt: run.updatedAt });
      }
      exportedRuns.push({ id: run.id, state: run.state, createdAt: run.createdAt, updatedAt: run.updatedAt, error: run.error });
      if (run.id === throughRunId) break;
    }
    return { ...base, messages, ...(files ? { files } : {}), runs: exportedRuns,
      checkpoint: "domain-only", requires_explicit_continuation: true };
  }
  receipt(
    reg: Registration,
    id: string,
  ): { status: string; value: unknown; binding?: string } | undefined {
    const row = this.db
      .prepare("SELECT status,value,binding FROM receipts WHERE namespace=? AND id=?")
      .get(namespace(reg), id) as { status: string; value: string; binding?: string } | undefined;
    return row
      ? { status: row.status, value: JSON.parse(row.value), binding: row.binding }
      : undefined;
  }
  saveReceipt(
    reg: Registration,
    run: string,
    id: string,
    status: string,
    value: unknown,
    binding?: string,
  ): void {
    this.run(reg, run);
    const prior = this.receipt(reg, id);
    if (prior && binding !== undefined && prior.binding !== binding)
      throw new AgentError(errors.conflict, "Operation identifier was used for different tool arguments or resource.");
    this.db
      .prepare(
        "INSERT INTO receipts(id,namespace,run,status,value,binding) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,value=excluded.value",
      )
      .run(id, namespace(reg), run, status, JSON.stringify(value), binding ?? null);
  }
  recover(): void {
    this.db.transaction(() => {
      const clients = this.db
        .prepare("SELECT registration FROM clients")
        .all() as { registration: string }[];
      for (const c of clients) {
        const reg = JSON.parse(c.registration) as Registration;
        const rows = this.db
          .prepare(
            "SELECT value FROM runs WHERE namespace=? AND state NOT IN ('completed','failed','cancelled')",
          )
          .all(namespace(reg)) as { value: string }[];
        for (const row of rows) {
          const run = JSON.parse(row.value) as Run;
          const unknown = this.db
            .prepare("SELECT id FROM receipts WHERE run=? AND status='started'")
            .get(run.id);
          this.updateRun(
            reg,
            run.id,
            unknown ? "awaiting_reconciliation" : "awaiting_host",
            {
              error:
                "Service restarted. Reconnect the original client to continue explicitly.",
            },
          );
        }
      }
    })();
  }
  close(): void {
    this.db.close();
  }
}
