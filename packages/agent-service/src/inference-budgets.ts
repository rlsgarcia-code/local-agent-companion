import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";
import { inferenceBudgetPolicy, type InferenceBudgetPolicy, type InferenceBudgetScope, type InferenceBudget, type InferenceBudgetSnapshot, type InferenceUsage } from "../../contracts/src/inference-budget";
import type { Store } from "./store";
import { namespace } from "./security";
import {DEFAULT_INFERENCE_TOKEN_RESERVATION,inferenceBudgetForReservation} from '../../contracts/src/inference-budget';

type Stored = { scope: InferenceBudgetScope; version: number; blocks: number; policy: InferenceBudget["policy"]; reservedTokensPerCall: number;
  calls: number; chargedTokens: number; reportedInput: number; reportedOutput: number; unreportedCalls: number; pendingCalls: number };
type Call = { run: string; scopes: string[]; reservation: number; state: "pending" | "reported" | "unreported"; usage?: InferenceUsage };
type Row = { value: string };
export const defaultInferenceBudgetPolicy: InferenceBudgetPolicy = { namespace: { callsPerBlock: 512, tokensPerBlock: 16_777_216, maxBlocks: 16 },
  stage: { callsPerBlock: 128, tokensPerBlock: 4_194_304, maxBlocks: 16 }, unknownTokensPerCall: DEFAULT_INFERENCE_TOKEN_RESERVATION };

/** Durable admission across runs/projects in the authenticated namespace, plus
 * stage allocations. Does not execute a model or infer provider billing. */
export class InferenceBudgets {
  private readonly policy: InferenceBudgetPolicy;
  constructor(private readonly store: Store, policy?: InferenceBudgetPolicy) {
    this.policy = inferenceBudgetPolicy.parse(policy ?? defaultInferenceBudgetPolicy);
    store.db.exec(`CREATE TABLE IF NOT EXISTS inference_budgets(namespace TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS inference_calls(namespace TEXT NOT NULL,id TEXT NOT NULL,run TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS inference_budget_grants(namespace TEXT NOT NULL,id TEXT NOT NULL,binding TEXT NOT NULL,PRIMARY KEY(namespace,id));`);
  }
  private id(scope: InferenceBudgetScope) { return contentHash(scope); }
  private initial(scope: InferenceBudgetScope): Stored { return { scope, version: 1, blocks: 1,
    policy: { ...(scope.kind === "namespace" ? this.policy.namespace : this.policy.stage) }, reservedTokensPerCall: this.policy.unknownTokensPerCall,
    calls: 0, chargedTokens: 0, reportedInput: 0, reportedOutput: 0, unreportedCalls: 0, pendingCalls: 0 }; }
  private read(reg: Registration, scope: InferenceBudgetScope): Stored {
    const row = this.store.db.prepare("SELECT value FROM inference_budgets WHERE namespace=? AND id=?").get(namespace(reg), this.id(scope)) as Row | undefined;
    return row ? JSON.parse(row.value) as Stored : this.initial(scope);
  }
  private save(reg: Registration, value: Stored) {
    this.store.db.prepare("INSERT INTO inference_budgets VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value")
      .run(namespace(reg), this.id(value.scope), JSON.stringify(value));
  }
  private effective(value: Stored): InferenceBudget {
    const installed = value.scope.kind === "namespace" ? this.policy.namespace : this.policy.stage;
    const policy = { callsPerBlock: Math.min(installed.callsPerBlock, value.policy.callsPerBlock), tokensPerBlock: Math.min(installed.tokensPerBlock, value.policy.tokensPerBlock), maxBlocks: installed.maxBlocks };
    const blocks = Math.min(value.blocks, policy.maxBlocks), authorizedCalls = blocks * policy.callsPerBlock, authorizedTokens = blocks * policy.tokensPerBlock;
    const reservedTokensPerCall = Math.max(value.reservedTokensPerCall, this.policy.unknownTokensPerCall);
    const exhausted = value.calls >= authorizedCalls || value.chargedTokens + reservedTokensPerCall > authorizedTokens;
    return { ...value, policy, reservedTokensPerCall, authorizedCalls, authorizedTokens, exhausted, canContinue: exhausted && value.blocks < policy.maxBlocks };
  }
  snapshot(reg: Registration, scopes: readonly InferenceBudgetScope[]): InferenceBudgetSnapshot {
    return this.store.db.transaction(() => ({ budgets: scopes.map((scope) => this.effective(this.read(reg, scope))) }))();
  }
  begin(reg: Registration, run: string, callId: string, scopes: readonly InferenceBudgetScope[],minimumReservationTokens?:number): InferenceBudgetSnapshot | null {
    this.store.run(reg, run);
    if(minimumReservationTokens!==undefined&&(!Number.isSafeInteger(minimumReservationTokens)||minimumReservationTokens<0))throw new AgentError(errors.invalid,'A safe nonnegative model reservation is required.');
    return this.store.db.transaction(() => {
      const values = scopes.map((scope) => this.effective(this.read(reg, scope)));
      const reservation = Math.max(...values.map((value) => value.reservedTokensPerCall),minimumReservationTokens??0);
      const old = this.store.db.prepare("SELECT value FROM inference_calls WHERE namespace=? AND id=?").get(namespace(reg), callId) as Row | undefined;
      if (old) {
        const previous = JSON.parse(old.value) as Call;
        if (previous.run !== run) throw new AgentError(errors.conflict, "Model call identity belongs to another execution.");
        if (previous.state !== "pending") throw new AgentError(errors.conflict, "This model attempt is already settled; another provider execution needs a new attempt identity.");
        if(reservation>previous.reservation)throw new AgentError(errors.conflict,'A pending model invocation cannot increase its reserved request under the same identity.');
        return null;
      }
      // Reserve the same amount in every enclosing scope, including any older
      // cycle with a more conservative missing-usage reservation.
      if (values.some((value) => value.exhausted||value.chargedTokens + reservation > value.authorizedTokens)) return {
        budgets:values.map(value=>inferenceBudgetForReservation(value,reservation,minimumReservationTokens!==undefined)) };
      for (const value of values) this.save(reg, { ...value, version: value.version + 1, calls: value.calls + 1, chargedTokens: value.chargedTokens + reservation, pendingCalls: value.pendingCalls + 1 });
      const call: Call = { run, scopes: scopes.map((scope) => this.id(scope)), reservation, state: "pending" };
      this.store.db.prepare("INSERT INTO inference_calls VALUES(?,?,?,?)").run(namespace(reg), callId, run, JSON.stringify(call)); return null;
    }).immediate();
  }
  recover() {
    this.store.db.transaction(() => {
      const rows = this.store.db.prepare("SELECT namespace,id,value FROM inference_calls WHERE json_extract(value,'$.state')='pending'").all() as (Row & { namespace: string; id: string })[];
      for (const row of rows) {
        const call = JSON.parse(row.value) as Call;
        for (const id of call.scopes) {
          const value = JSON.parse((this.store.db.prepare("SELECT value FROM inference_budgets WHERE namespace=? AND id=?").get(row.namespace, id) as Row).value) as Stored;
          this.store.db.prepare("UPDATE inference_budgets SET value=? WHERE namespace=? AND id=?")
            .run(JSON.stringify({ ...value, version: value.version + 1, pendingCalls: value.pendingCalls - 1, unreportedCalls: value.unreportedCalls + 1 }), row.namespace, id);
        }
        this.store.db.prepare("UPDATE inference_calls SET value=? WHERE namespace=? AND id=?").run(JSON.stringify({ ...call, state: "unreported" }), row.namespace, row.id);
      }
    }).immediate();
  }
  finish(reg: Registration, run: string, callId: string, usage?: InferenceUsage) {
    this.store.run(reg, run);
    if (usage && (!Number.isSafeInteger(usage.input + usage.output) || usage.input < 0 || usage.output < 0 || !Number.isInteger(usage.input) || !Number.isInteger(usage.output)))
      throw new AgentError(errors.invalid, "Model usage must be nonnegative safe token counts.");
    this.store.db.transaction(() => {
      const row = this.store.db.prepare("SELECT value FROM inference_calls WHERE namespace=? AND id=?").get(namespace(reg), callId) as Row | undefined;
      if (!row) return; // A rejected admission did not contact the provider.
      const call = JSON.parse(row.value) as Call;
      if (call.run !== run) throw new AgentError(errors.conflict, "Model usage belongs to another execution.");
      if (call.state !== "pending") return;
      for (const id of call.scopes) {
        const value = JSON.parse((this.store.db.prepare("SELECT value FROM inference_budgets WHERE namespace=? AND id=?").get(namespace(reg), id) as Row).value) as Stored;
        this.save(reg, { ...value, version: value.version + 1, chargedTokens: value.chargedTokens + (usage ? usage.input + usage.output - call.reservation : 0),
          reportedInput: value.reportedInput + (usage?.input ?? 0), reportedOutput: value.reportedOutput + (usage?.output ?? 0),
          unreportedCalls: value.unreportedCalls + (usage ? 0 : 1), pendingCalls: value.pendingCalls - 1 });
      }
      this.store.db.prepare("UPDATE inference_calls SET value=? WHERE namespace=? AND id=?")
        .run(JSON.stringify({ ...call, state: usage ? "reported" : "unreported", ...(usage ? { usage } : {}) }), namespace(reg), callId);
    }).immediate();
  }
  /** Exact host decision; stale concurrent decisions cannot grant twice. */
  grant(reg: Registration, id: string, snapshot: InferenceBudgetSnapshot) {
    const blocked = snapshot.budgets.filter((value) => value.exhausted), binding = contentHash(blocked.map((value) => ({ scope: value.scope, blocks: value.blocks, version: value.version, policy: value.policy,...(value.nextReservationTokens===undefined?{}:{nextReservationTokens:value.nextReservationTokens}) })));
    this.store.db.transaction(() => {
      const old = this.store.db.prepare("SELECT binding FROM inference_budget_grants WHERE namespace=? AND id=?").get(namespace(reg), id) as { binding: string } | undefined;
      if (old) { if (old.binding !== binding) throw new AgentError(errors.conflict, "Inference grant identity changed."); return; }
      for (const value of blocked) {
        const current = this.effective(this.read(reg, value.scope));
        if (current.blocks !== value.blocks) continue;
        const requested=value.nextReservationTokens??current.reservedTokensPerCall;
        if(!Number.isSafeInteger(requested)||requested<current.reservedTokensPerCall)throw new AgentError(errors.invalid,'Invalid request reservation in this budget decision.');
        const demand=inferenceBudgetForReservation(current,requested,value.nextReservationTokens!==undefined);
        if (!demand.exhausted) continue;
        if (!demand.canContinue) throw new AgentError(errors.forbidden, "The installed inference policy does not allow another block.");
        this.save(reg, { ...current, version: current.version + 1, blocks: current.blocks + 1 });
      }
      this.store.db.prepare("INSERT INTO inference_budget_grants VALUES(?,?,?)").run(namespace(reg), id, binding);
    }).immediate();
  }
}
