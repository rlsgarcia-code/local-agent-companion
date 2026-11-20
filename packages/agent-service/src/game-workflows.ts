import { randomUUID } from "node:crypto";
import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";
import { gameStages, gameWorkflowPolicy, gameWorkflowAdvance, gameWorkflowContinue, gameWorkflowReopen, type GameWorkflowPolicy, type GameWorkflow, type GameWorkflowSnapshot, type GameWorkflowEvent } from "../../contracts/src/game-workflow";
import type { GameQualityAssessment, GameProductionJob } from "../../contracts/src/game-production";
import { gameStageGates } from "../../game-design/src/workflow";
import type { GameProjects } from "./game-projects";
import type { Store } from "./store";
import { namespace } from "./security";

type Row = { value: string };
/** Domain workflow only; jobs execute in GameProduction and agents in LangGraph. */
export class GameWorkflows {
  private readonly policy;
  constructor(private readonly store: Store, private readonly projects: GameProjects,
    private readonly quality: (reg: Registration, projectId: string) => GameQualityAssessment, policy?: GameWorkflowPolicy) {
    this.policy = gameWorkflowPolicy.parse(policy ?? { requestsPerBlock: 64, maxBlocksPerStage: 16 });
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS game_workflows(project TEXT PRIMARY KEY REFERENCES game_projects(id),namespace TEXT NOT NULL,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_workflow_mutations(namespace TEXT NOT NULL,id TEXT NOT NULL,binding TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS game_workflow_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,namespace TEXT NOT NULL,project TEXT NOT NULL REFERENCES game_projects(id),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_workflow_charges(job TEXT PRIMARY KEY REFERENCES game_production_jobs(id) DEFERRABLE INITIALLY DEFERRED,namespace TEXT NOT NULL,project TEXT NOT NULL REFERENCES game_projects(id),workflow TEXT NOT NULL,stage TEXT NOT NULL,binding TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_workflow_acceptances(workflow TEXT PRIMARY KEY,namespace TEXT NOT NULL,project TEXT NOT NULL,revision INTEGER NOT NULL,build TEXT NOT NULL REFERENCES game_production_jobs(id),artifact TEXT NOT NULL REFERENCES game_artifacts(id),FOREIGN KEY(project,revision) REFERENCES game_revisions(project,revision));
    `);
  }
  get(reg: Registration, projectId: string): GameWorkflow | null {
    this.projects.get(reg, projectId);
    const row = this.store.db.prepare("SELECT value FROM game_workflows WHERE namespace=? AND project=?").get(namespace(reg), projectId) as Row | undefined;
    return row ? JSON.parse(row.value) as GameWorkflow : null;
  }
  private save(reg: Registration, value: GameWorkflow, action: string, evidence?: unknown): void {
    this.store.db.prepare("INSERT INTO game_workflows VALUES(?,?,?) ON CONFLICT(project) DO UPDATE SET value=excluded.value")
      .run(value.projectId, namespace(reg), JSON.stringify(value));
    this.store.db.prepare("INSERT INTO game_workflow_events(namespace,project,value) VALUES(?,?,?)")
      .run(namespace(reg), value.projectId, JSON.stringify({ action, workflow: value, ...(evidence ? { evidence } : {}) }));
  }
  private effective(workflow: GameWorkflow | null): GameWorkflowPolicy {
    return { requestsPerBlock: Math.min(workflow?.policy.requestsPerBlock ?? this.policy.requestsPerBlock, this.policy.requestsPerBlock),
      maxBlocksPerStage: Math.min(workflow?.policy.maxBlocksPerStage ?? this.policy.maxBlocksPerStage, this.policy.maxBlocksPerStage) };
  }
  ensure(reg: Registration, projectId: string): GameWorkflow {
    return this.store.db.transaction(() => {
      const old = this.get(reg, projectId); if (old) return old;
      const now = Date.now(), workflow: GameWorkflow = { id: randomUUID(), projectId, version: 1, stage: "design", state: "active", policy: { ...this.policy },
        stages: Object.fromEntries(gameStages.map((stage) => [stage, { usedRequests: 0, blocks: 1 }])) as GameWorkflow["stages"], createdAt: now, updatedAt: now };
      this.save(reg, workflow, "created"); return workflow;
    }).immediate();
  }
  snapshot(reg: Registration, projectId: string): GameWorkflowSnapshot {
    return this.store.db.transaction(() => {
      const project = this.projects.get(reg, projectId), workflow = this.get(reg, projectId), quality = this.quality(reg, projectId), gates = gameStageGates(quality);
      const index = workflow ? gameStages.indexOf(workflow.stage) : -1;
      if (this.store.db.prepare("SELECT id FROM game_production_jobs WHERE namespace=? AND project=? AND state NOT IN ('completed','cancelled','failed') LIMIT 1").get(namespace(reg), projectId)) {
        const gate = gates[Math.max(0, index)]!; gate.blockers.push("production-work-pending"); gate.ready = false;
      }
      const current = workflow?.stages[workflow.stage];
      const policy = this.effective(workflow);
      const eventCursor = (this.store.db.prepare("SELECT max(sequence) AS cursor FROM game_workflow_events WHERE namespace=? AND project=?").get(namespace(reg), projectId) as { cursor: number | null }).cursor ?? 0;
      return { workflow, projectId, revision: project.revision, sourceHash: project.contentHash, gates, effectivePolicy: policy, eventCursor,
        qualityReady: quality.ready, canAdvance: Boolean(workflow?.state === "active" && gates.slice(0, index + 1).every((gate) => gate.ready) &&
          (workflow.stage !== "candidate" || quality.ready)),
        budget: workflow && current ? { stage: workflow.stage, usedRequests: current.usedRequests,
          authorizedRequests: Math.min(current.blocks, policy.maxBlocksPerStage) * policy.requestsPerBlock, exhausted: current.usedRequests >= Math.min(current.blocks, policy.maxBlocksPerStage) * policy.requestsPerBlock,
          canContinue: workflow.state === "active" && current.blocks < policy.maxBlocksPerStage } : null };
    })();
  }
  private mutation(reg: Registration, key: string, input: unknown, perform: () => GameWorkflow): GameWorkflow {
    return this.store.db.transaction(() => {
      const ns = namespace(reg), binding = contentHash(input), old = this.store.db.prepare("SELECT binding,value FROM game_workflow_mutations WHERE namespace=? AND id=?").get(ns, key) as (Row & { binding: string }) | undefined;
      if (old) { if (old.binding !== binding) throw new AgentError(errors.conflict, "Workflow request identity was reused for different content."); return JSON.parse(old.value) as GameWorkflow; }
      const value = perform(); this.store.db.prepare("INSERT INTO game_workflow_mutations VALUES(?,?,?,?)").run(ns, key, binding, JSON.stringify(value)); return value;
    }).immediate();
  }
  private check(reg: Registration, request: { projectId: string; expectedVersion: number; expectedRevision: number }) {
    const project = this.projects.get(reg, request.projectId), workflow = this.get(reg, request.projectId);
    if (!workflow || workflow.version !== request.expectedVersion || project.revision !== request.expectedRevision)
      throw new AgentError(errors.conflict, "Refresh the production workflow and source revision before changing it.");
    if (workflow.state === "completed") throw new AgentError(errors.conflict, "This production cycle is completed; its acceptance cannot be reused for later revisions.");
    return { project, workflow };
  }
  advance(reg: Registration, input: unknown): GameWorkflow {
    const request = gameWorkflowAdvance.parse(input);
    return this.mutation(reg, request.requestId, { kind: "advance", ...request }, () => {
      const { project, workflow } = this.check(reg, request), state = this.snapshot(reg, project.id);
      if (!state.canAdvance) throw new AgentError(errors.conflict, "This stage or an earlier stage lacks current independent evidence.", { gates: state.gates });
      const next = gameStages[gameStages.indexOf(workflow.stage) + 1];
      const updated = { ...workflow, stage: next ?? workflow.stage, state: next ? "active" as const : "completed" as const, version: workflow.version + 1, updatedAt: Date.now() };
      if (!next) {
        const buildId = this.quality(reg, project.id).buildId!;
        const artifact = this.store.db.prepare("SELECT id FROM game_artifacts WHERE namespace=? AND job=?").get(namespace(reg), buildId) as { id: string } | undefined;
        if (!artifact) throw new AgentError(errors.conflict, "The exact accepted build is no longer available.");
        updated.lastAccepted = { workflowId: workflow.id, revision: project.revision, sourceHash: project.contentHash, buildId };
        this.store.db.prepare("INSERT INTO game_workflow_acceptances VALUES(?,?,?,?,?,?)").run(workflow.id, namespace(reg), project.id, project.revision, buildId, artifact.id);
      }
      this.save(reg, updated, next ? "advanced" : "completed", { revision: project.revision, sourceHash: project.contentHash, gates: state.gates }); return updated;
    });
  }
  reopen(reg: Registration, input: unknown): GameWorkflow {
    const request = gameWorkflowReopen.parse(input);
    return this.mutation(reg, request.requestId, { kind: "reopen", ...request }, () => {
      const project = this.projects.get(reg, request.projectId), previous = this.get(reg, project.id);
      if (!previous || previous.state !== "completed" || previous.version !== request.expectedVersion || project.revision !== request.expectedRevision)
        throw new AgentError(errors.conflict, "Only an acknowledged completed cycle can be explicitly reopened at the displayed revision.");
      if (previous.lastAccepted?.sourceHash === project.contentHash && this.quality(reg, project.id).ready)
        throw new AgentError(errors.conflict, "This exact source is already accepted. Preserve it; a changed source or invalidated evidence is required for a new cycle.");
      const now = Date.now(), next: GameWorkflow = { id: randomUUID(), projectId: project.id, version: previous.version + 1, stage: "design", state: "active",
        policy: { ...this.policy }, stages: Object.fromEntries(gameStages.map((stage) => [stage, { usedRequests: 0, blocks: 1 }])) as GameWorkflow["stages"],
        createdAt: now, updatedAt: now, ...(previous.lastAccepted ? { lastAccepted: previous.lastAccepted } : {}) };
      this.save(reg, next, "reopened", { previousWorkflowId: previous.id, revision: project.revision, sourceHash: project.contentHash }); return next;
    });
  }
  events(reg: Registration, projectId: string, cursor = 0, limit = 30, until = Number.MAX_SAFE_INTEGER) {
    this.projects.get(reg, projectId);
    const rows = this.store.db.prepare("SELECT sequence,value FROM game_workflow_events WHERE namespace=? AND project=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?")
      .all(namespace(reg), projectId, cursor, until, limit + 1) as (Row & { sequence: number })[];
    const events = rows.slice(0, limit).map((row): GameWorkflowEvent => ({ ...JSON.parse(row.value), sequence: row.sequence }));
    return { events, cursor: events.at(-1)?.sequence ?? cursor, hasMore: rows.length > limit };
  }
  continue(reg: Registration, input: unknown): GameWorkflow {
    const request = gameWorkflowContinue.parse(input);
    return this.mutation(reg, request.requestId, { kind: "continue", ...request }, () => {
      const { workflow, project } = this.check(reg, request), current = workflow.stages[workflow.stage];
      const policy = this.effective(workflow);
      if (current.usedRequests < Math.min(current.blocks, policy.maxBlocksPerStage) * policy.requestsPerBlock) throw new AgentError(errors.conflict, "This production stage still has an authorized request allocation.");
      if (current.blocks >= policy.maxBlocksPerStage) throw new AgentError(errors.forbidden, "This stage reached its installed production policy; administrative configuration is required.");
      const updated = { ...workflow, policy, version: workflow.version + 1, updatedAt: Date.now(), stages: { ...workflow.stages, [workflow.stage]: { ...current, blocks: current.blocks + 1 } } };
      this.save(reg, updated, "budget-continued", { revision: project.revision, sourceHash: project.contentHash }); return updated;
    });
  }
  /** Must share admission's transaction: failures roll the job and charge back together. */
  reserve(reg: Registration, job: GameProductionJob): void {
    if (!this.store.db.inTransaction) throw new Error("Workflow admission must be transactional with its production job.");
    const binding = contentHash({ projectId: job.projectId, sourceHash: job.sourceHash, revision: job.revision, adapterId: job.adapterId, toolchain: job.toolchain, kind: job.kind,
      buildId: job.buildId ?? null, testSuite: job.testSuite ?? null, assetSpec: job.assetSpec ?? null });
    const previous = this.store.db.prepare("SELECT namespace,binding FROM game_workflow_charges WHERE job=?").get(job.id) as { namespace: string; binding: string } | undefined;
    if (previous) { if (previous.namespace !== namespace(reg) || previous.binding !== binding) throw new AgentError(errors.conflict, "Production charge identity changed."); return; }
    const workflow = this.ensure(reg, job.projectId), current = workflow.stages[workflow.stage];
    const policy = this.effective(workflow);
    if (workflow.state === "completed") throw new AgentError(errors.conflict, "A completed production cycle must be explicitly reopened for new production work.");
    if (current.usedRequests >= Math.min(current.blocks, policy.maxBlocksPerStage) * policy.requestsPerBlock)
      throw new AgentError(errors.forbidden, "The production allocation for this stage is exhausted. Work is saved; authorize continuation in Game Studio.", { kind: "game-production-budget", projectId: job.projectId, stage: workflow.stage });
    const updated = { ...workflow, policy, version: workflow.version + 1, updatedAt: Date.now(), stages: { ...workflow.stages, [workflow.stage]: { ...current, usedRequests: current.usedRequests + 1 } } };
    this.store.db.prepare("INSERT INTO game_workflow_charges VALUES(?,?,?,?,?,?)").run(job.id, namespace(reg), job.projectId, workflow.id, workflow.stage, binding);
    this.save(reg, updated, "request-admitted", { jobId: job.id, kind: job.kind, revision: job.revision, sourceHash: job.sourceHash });
  }
}
