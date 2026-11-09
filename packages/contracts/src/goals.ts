import { z } from "zod";
import { identifier } from "./schema";
import { MAX_GOAL_HISTORY, MAX_GOAL_ITERATIONS, MAX_GOAL_STAGNATION, type GoalRecord } from "./goal-state";

const policy = z.object({ autoResume: z.boolean(), runtime: z.enum(["standard", "deep"]),
  autonomyMode: z.enum(["plan", "review", "execute"]), finalReview: z.enum(["off", "changes", "always"]) }).strict();
const evidenceRef = z.object({ kind: z.enum(["test", "diagnostic", "diff", "visual", "command", "mcp", "note"]),
  operationId: z.string().min(1).max(256).optional(), resultSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  summary: z.string().max(500), iteration: z.number().int().min(0).max(MAX_GOAL_ITERATIONS) }).strict();
const criterion = z.object({ id: identifier, text: z.string().min(1).max(20_000),
  status: z.enum(["pending", "verified", "failed"]), evidence: z.array(z.string().max(2000)).max(20), evidenceRefs: z.array(evidenceRef).max(30).optional() }).strict();
const milestone = z.object({ id: identifier, title: z.string().min(1).max(4000), status: z.enum(["pending", "active", "completed", "blocked"]),
  criteriaIds: z.array(identifier).max(200), evidence: z.array(z.string().max(2000)).max(20), iterationCount: z.number().int().min(0).max(MAX_GOAL_ITERATIONS) }).strict();
export const goalRecord: z.ZodType<GoalRecord> = z.object({
  version: z.literal(1), id: identifier, title: z.string().max(160), objective: z.string().min(1).max(20_000), threadId: identifier,
  status: z.enum(["draft", "active", "awaiting-criteria", "paused", "blocked", "completed", "cancelled"]),
  createdAt: z.number().nonnegative(), updatedAt: z.number().nonnegative(), policy,
  criteria: z.array(criterion).min(1).max(200), milestones: z.array(milestone).min(1).max(200),
  currentMilestoneId: identifier.optional(), nextAction: z.string().max(4000).optional(),
  iteration: z.number().int().min(0).max(MAX_GOAL_ITERATIONS), stagnationCount: z.number().int().min(0).max(MAX_GOAL_STAGNATION),
  lastRunId: identifier.optional(), lastOutcome: z.string().max(1000).optional(), planRevision: z.number().int().min(1).max(10_000),
  history: z.array(z.object({ at: z.number().nonnegative(),
    type: z.enum(["created", "criteria", "iteration", "milestone", "evidence", "resumed", "paused", "blocked", "completed", "cancelled"]),
    detail: z.string().max(1000), iteration: z.number().int().min(0).max(MAX_GOAL_ITERATIONS) }).strict()).max(MAX_GOAL_HISTORY),
}).strict().superRefine((goal, context) => {
  const criteria = new Set(goal.criteria.map((entry) => entry.id));
  const milestones = new Set(goal.milestones.map((entry) => entry.id));
  if (criteria.size !== goal.criteria.length || milestones.size !== goal.milestones.length ||
      goal.milestones.some((entry) => entry.criteriaIds.some((id) => !criteria.has(id))) ||
      (goal.currentMilestoneId && !milestones.has(goal.currentMilestoneId)))
    context.addIssue({ code: "custom", message: "Goal criteria and milestone references must be unique and valid." });
});
export const goalCreate = z.object({ key: identifier.max(96), sessionId: identifier,
  title: z.string().max(160).optional(), objective: z.string().min(1).max(20_000),
  runtime: z.enum(["standard", "deep"]), mode: z.enum(["plan", "review", "execute"]),
  finalReview: z.enum(["off", "changes", "always"]).default("changes"),
}).strict();
export const goalEdit = z.object({ id: identifier, revision: z.number().int().positive(),
  changes: z.object({ title: z.string().max(160).optional(), objective: z.string().min(1).max(20_000).optional(),
    criteria: z.array(z.object({ id: identifier, text: z.string().min(1).max(20_000) }).strict()).min(1).max(200).optional(),
    milestones: z.array(z.object({ id: identifier, title: z.string().min(1).max(4000), criteriaIds: z.array(identifier).max(200) }).strict()).min(1).max(200).optional(),
    policy: policy.optional(),
  }).strict(),
}).strict();
export const goalEvaluation = z.object({ decision: z.enum(["continue", "completed", "blocked"]),
  criteria: z.array(z.object({ id: identifier, status: z.enum(["pending", "verified", "failed"]),
    evidence: z.array(z.string().max(2000)).max(20), evidenceRefs: z.array(evidenceRef).max(30).optional() }).strict()).max(200),
  completedMilestones: z.array(identifier).max(200), nextAction: z.string().max(4000).optional(), reason: z.string().max(2000),
}).strict();
