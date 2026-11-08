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
import { namespace, tokenDigest, tokenMatches } from "./security";

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

export class Store {
  readonly db: Database.Database;
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
      CREATE TABLE IF NOT EXISTS imports(namespace TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key));
      CREATE TABLE IF NOT EXISTS goals(namespace TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS leases(workspace TEXT PRIMARY KEY, run TEXT NOT NULL UNIQUE REFERENCES runs(id));
    `);
  }
  register(credential: ClientCredential): void {
    const previous = this.db
      .prepare("SELECT registration FROM clients WHERE id=?")
      .get(credential.registration.id) as { registration: string } | undefined;
    if (
      previous &&
      previous.registration !== JSON.stringify(credential.registration)
    )
      throw new AgentError(
        errors.conflict,
        "Registration is immutable; provision a new client identity.",
      );
    this.db
      .prepare(
        "INSERT INTO clients VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET token=excluded.token,revoked=CASE WHEN clients.token=excluded.token THEN clients.revoked ELSE 0 END",
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
    return JSON.parse(row.registration) as Registration;
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
  ): { session: Session; runs: Run[]; events: EngineEvent[]; cursor: number } {
    const session = this.session(reg, sessionId);
    const events = (
      this.db
        .prepare(
          "SELECT sequence,value FROM events WHERE namespace=? AND session=? ORDER BY sequence DESC LIMIT 500",
        )
        .all(namespace(reg), sessionId) as { sequence: number; value: string }[]
    )
      .reverse()
      .map(
        (row) =>
          ({ ...JSON.parse(row.value), sequence: row.sequence }) as EngineEvent,
      );
    return {
      session,
      runs: this.runs(reg, sessionId),
      events,
      cursor: events.at(-1)?.sequence ?? 0,
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
      data,
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
    return (
      this.db
        .prepare(
          "SELECT sequence,value FROM events WHERE namespace=? AND session=? AND sequence>? ORDER BY sequence LIMIT ?",
        )
        .all(namespace(reg), session, cursor, limit) as {
        sequence: number;
        value: string;
      }[]
    ).map(
      (r) => ({ ...JSON.parse(r.value), sequence: r.sequence }) as EngineEvent,
    );
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
      this.append(reg, session.id, "session.imported", {
        domain: value,
        checkpoint: "legacy_incompatible",
        requiresContinuation: true,
      });
      this.db
        .prepare("INSERT INTO imports VALUES(?,?,?,?)")
        .run(ns, key, hash, JSON.stringify(session));
      return session;
    })();
  }
  receipt(
    reg: Registration,
    id: string,
  ): { status: string; value: unknown } | undefined {
    const row = this.db
      .prepare("SELECT status,value FROM receipts WHERE namespace=? AND id=?")
      .get(namespace(reg), id) as { status: string; value: string } | undefined;
    return row
      ? { status: row.status, value: JSON.parse(row.value) }
      : undefined;
  }
  saveReceipt(
    reg: Registration,
    run: string,
    id: string,
    status: string,
    value: unknown,
  ): void {
    this.db
      .prepare(
        "INSERT INTO receipts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,value=excluded.value",
      )
      .run(id, namespace(reg), run, status, JSON.stringify(value));
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
