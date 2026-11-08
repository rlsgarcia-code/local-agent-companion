import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { goalRecord, type goalCreate, type goalEdit } from "../../contracts/src/goals";
import { MAX_GOALS, MAX_GOAL_HISTORY, MAX_GOAL_ITERATIONS, activateGoal, applyGoalEvaluation, createGoalDraft, startGoalIteration,
  type GoalRecord, type GoalEvaluation } from "../../contracts/src/goal-state";
import { canonical } from "../../contracts/src/identity";
import { namespace } from "./security";
import type { Store } from "./store";
import type { z } from "zod";

export class Goals {
  constructor(private readonly store: Store) {}
  list(reg: Registration): GoalRecord[] {
    return (this.store.db.prepare("SELECT value FROM goals WHERE namespace=? ORDER BY rowid DESC").all(namespace(reg)) as { value: string }[])
      .map((row) => goalRecord.parse(JSON.parse(row.value)));
  }
  get(reg: Registration, id: string): GoalRecord {
    const row = this.store.db.prepare("SELECT value FROM goals WHERE namespace=? AND id=?").get(namespace(reg), id) as { value: string } | undefined;
    if (!row) throw new AgentError(errors.missing, "Goal not found in this namespace.");
    return goalRecord.parse(JSON.parse(row.value));
  }
  save(reg: Registration, value: GoalRecord): GoalRecord {
    const goal = goalRecord.parse(value);
    this.store.session(reg, goal.threadId);
    const existing = this.store.db.prepare("SELECT id FROM goals WHERE namespace=? AND id=?").get(namespace(reg), goal.id);
    if (!existing && this.list(reg).length >= MAX_GOALS) throw new AgentError(errors.conflict, "The product's 20-goal limit was reached. Existing history was preserved.");
    this.store.db.prepare("INSERT INTO goals VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value")
      .run(namespace(reg), goal.id, JSON.stringify(goal));
    return goal;
  }
  create(reg: Registration, input: z.infer<typeof goalCreate>): GoalRecord {
    return this.store.db.transaction(() => {
      this.store.session(reg, input.sessionId);
      const proposed = createGoalDraft({ id: input.key, title: input.title, objective: input.objective, threadId: input.sessionId,
        runtime: input.runtime, autonomyMode: input.mode, finalReview: input.finalReview });
      const existing = this.store.db.prepare("SELECT value FROM goals WHERE namespace=? AND id=?").get(namespace(reg), proposed.id) as { value: string } | undefined;
      if (existing) {
        const goal = goalRecord.parse(JSON.parse(existing.value));
        if (canonical([goal.objective, goal.title, goal.threadId, goal.policy]) !== canonical([proposed.objective, proposed.title, proposed.threadId, proposed.policy]))
          throw new AgentError(errors.conflict, "Goal creation key was used for a different request.");
        return goal;
      }
      return this.save(reg, proposed);
    })();
  }
  edit(reg: Registration, input: z.infer<typeof goalEdit>): GoalRecord {
    return this.store.db.transaction(() => {
      const goal = this.get(reg, input.id);
      this.assertIdle(reg, goal);
      if (goal.planRevision !== input.revision) throw new AgentError(errors.conflict, "Goal changed. Refresh before editing.");
      const changes = input.changes;
      const criteria = changes.criteria || changes.objective
        ? (changes.criteria ?? goal.criteria).map((entry) => ({ id: entry.id, text: entry.text, status: "pending" as const, evidence: [] })) : goal.criteria;
      let milestones = changes.milestones?.map((entry) => ({ ...entry, status: "pending" as const, evidence: [], iterationCount: 0 })) ?? goal.milestones;
      if (changes.criteria && !changes.milestones) {
        const ids = new Set(criteria.map((entry) => entry.id));
        milestones = milestones.map((entry) => ({ ...entry, status: "pending", evidence: [], criteriaIds: entry.criteriaIds.filter((id) => ids.has(id)) }));
        const assigned = new Set(milestones.flatMap((entry) => entry.criteriaIds));
        const first = milestones[0]!;
        milestones[0] = { ...first, criteriaIds: [...first.criteriaIds, ...criteria.filter((entry) => !assigned.has(entry.id)).map((entry) => entry.id)] };
      }
      return this.save(reg, { ...goal, ...changes, criteria, milestones,
        currentMilestoneId: milestones.some((entry) => entry.id === goal.currentMilestoneId) ? goal.currentMilestoneId : milestones[0]!.id,
        ...(changes.criteria || changes.objective ? { status: "awaiting-criteria" as const } : {}),
        planRevision: goal.planRevision + 1, updatedAt: Date.now() });
    })();
  }
  transition(reg: Registration, id: string, action: "activate" | "continue" | "pause" | "cancel"): GoalRecord {
    return this.store.db.transaction(() => {
      const goal = this.get(reg, id);
      if (action === "activate" || action === "continue") {
        if (goal.status === "active") return goal;
        this.assertIdle(reg, goal);
        if (["completed", "cancelled"].includes(goal.status) || goal.iteration >= MAX_GOAL_ITERATIONS)
          throw new AgentError(errors.conflict, "A completed, cancelled or exhausted goal cannot continue.");
        return this.save(reg, activateGoal({ ...goal, stagnationCount: action === "continue" ? 0 : goal.stagnationCount }));
      }
      const status: "paused" | "cancelled" = action === "pause" ? "paused" : "cancelled";
      if (goal.status === status || ["completed", "cancelled"].includes(goal.status)) return goal;
      return this.save(reg, { ...goal, status, updatedAt: Date.now(), lastOutcome: status,
        history: [...goal.history, { at: Date.now(), type: status, detail: `Goal ${status} by the user`, iteration: goal.iteration }].slice(-MAX_GOAL_HISTORY) });
    })();
  }
  begin(reg: Registration, id: string, session: string, run: string): GoalRecord {
    const goal = this.get(reg, id);
    if (goal.threadId !== session || goal.status !== "active" || goal.iteration >= MAX_GOAL_ITERATIONS)
      throw new AgentError(errors.conflict, "Goal is not active in this session or its iteration limit was reached.");
    return this.save(reg, startGoalIteration(goal, run));
  }
  evaluate(reg: Registration, id: string, run: string, evaluation: GoalEvaluation): GoalRecord {
    const goal = this.get(reg, id);
    if (goal.lastRunId !== run) throw new AgentError(errors.conflict, "Goal evaluation does not belong to its current iteration.");
    const evaluated = applyGoalEvaluation(goal, evaluation);
    return this.save(reg, ["paused", "cancelled"].includes(goal.status) ? { ...evaluated, status: goal.status } : evaluated);
  }
  private assertIdle(reg: Registration, goal: GoalRecord): void {
    if (goal.lastRunId && !["completed", "failed", "cancelled"].includes(this.store.run(reg, goal.lastRunId).state))
      throw new AgentError(errors.conflict, "Finish or cancel the active goal iteration before editing or resuming it.");
  }
}
