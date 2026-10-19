import type { AgentRuntime, RunMode } from "./types";

export const MAX_GOAL_ITERATIONS = 20;
export const MAX_GOAL_STAGNATION = 2;
export const MAX_GOAL_HISTORY = 40;
export const MAX_GOALS = 20;

export type GoalStatus =
  | "draft"
  | "active"
  | "awaiting-criteria"
  | "paused"
  | "blocked"
  | "completed"
  | "cancelled";

export type GoalCriterion = {
  id: string;
  text: string;
  status: "pending" | "verified" | "failed";
  evidence: string[];
};

export type GoalMilestone = {
  id: string;
  title: string;
  status: "pending" | "active" | "completed" | "blocked";
  criteriaIds: string[];
  evidence: string[];
  iterationCount: number;
};

export type GoalHistoryEntry = {
  at: number;
  type: "created" | "criteria" | "iteration" | "milestone" | "evidence" | "resumed" | "paused" | "blocked" | "completed" | "cancelled";
  detail: string;
  iteration: number;
};

export type GoalRecord = {
  version: 1;
  id: string;
  title: string;
  objective: string;
  threadId: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  policy: {
    autoResume: boolean;
    runtime: AgentRuntime;
    autonomyMode: RunMode;
    finalReview: "off" | "changes" | "always";
  };
  criteria: GoalCriterion[];
  milestones: GoalMilestone[];
  currentMilestoneId?: string;
  nextAction?: string;
  iteration: number;
  stagnationCount: number;
  lastRunId?: string;
  lastOutcome?: string;
  planRevision: number;
  history: GoalHistoryEntry[];
};

export type GoalEvaluation = {
  decision: "continue" | "completed" | "blocked";
  criteria: Array<{ id: string; status: "verified" | "pending" | "failed"; evidence: string[] }>;
  completedMilestones: string[];
  nextAction?: string;
  reason: string;
};

export function createGoalDraft(input: {
  id?: string;
  title?: string;
  objective: string;
  threadId: string;
  runtime: AgentRuntime;
  autonomyMode: RunMode;
  finalReview: "off" | "changes" | "always";
  now?: number;
}): GoalRecord {
  const now = input.now ?? Date.now();
  const objective = cleanText(input.objective, 20_000);
  const id = input.id ?? String(crypto.randomUUID());
  const criterionId = `${id}-criterion-1`;
  const milestoneId = `${id}-milestone-1`;
  return {
    version: 1,
    id,
    title: cleanText(input.title ?? objective, 160),
    objective,
    threadId: cleanText(input.threadId, 128),
    status: "awaiting-criteria",
    createdAt: now,
    updatedAt: now,
    policy: {
      autoResume: true,
      runtime: input.runtime,
      autonomyMode: input.autonomyMode,
      finalReview: input.finalReview
    },
    criteria: [{ id: criterionId, text: objective, status: "pending", evidence: [] }],
    milestones: [{
      id: milestoneId,
      title: "Deliver the objective",
      status: "active",
      criteriaIds: [criterionId],
      evidence: [],
      iterationCount: 0
    }],
    currentMilestoneId: milestoneId,
    nextAction: "Review the proposed criteria and start the first iteration.",
    iteration: 0,
    stagnationCount: 0,
    planRevision: 1,
    history: [{ at: now, type: "created", detail: "Goal draft created", iteration: 0 }]
  };
}

export function activateGoal(goal: GoalRecord, now = Date.now()): GoalRecord {
  return withHistory({
    ...goal,
    status: "active",
    updatedAt: now,
    nextAction: goal.nextAction || "Inspect the workspace and begin the current milestone."
  }, { at: now, type: "criteria", detail: "Criteria accepted", iteration: goal.iteration });
}

export function startGoalIteration(goal: GoalRecord, runId: string, now = Date.now()): GoalRecord {
  const current = goal.milestones.find((milestone) => milestone.id === goal.currentMilestoneId);
  return withHistory({
    ...goal,
    status: "active",
    iteration: goal.iteration + 1,
    updatedAt: now,
    lastRunId: runId,
    lastOutcome: "running",
    milestones: goal.milestones.map((milestone) => milestone.id === current?.id
      ? { ...milestone, status: "active", iterationCount: milestone.iterationCount + 1 }
      : milestone)
  }, { at: now, type: "iteration", detail: `Started iteration ${goal.iteration + 1}`, iteration: goal.iteration + 1 });
}

export function applyGoalEvaluation(goal: GoalRecord, evaluation: GoalEvaluation, now = Date.now()): GoalRecord {
  const previousSignature = goalSignature(goal);
  const knownCriteria = new Map(evaluation.criteria.map((criterion) => [criterion.id, criterion]));
  const criteria = goal.criteria.map((criterion) => {
    const next = knownCriteria.get(criterion.id);
    if (!next) return criterion;
    return {
      ...criterion,
      status: next.status,
      evidence: uniqueEvidence(next.evidence).slice(0, 20)
    };
  });
  const completed = new Set(evaluation.completedMilestones);
  const milestones = goal.milestones.map((milestone) => {
    if (completed.has(milestone.id)) {
      return { ...milestone, status: "completed" as const, evidence: uniqueEvidence([...milestone.evidence, ...criteria.flatMap((criterion) => criterion.evidence)]).slice(0, 20) };
    }
    if (milestone.status === "completed") return milestone;
    const failed = milestone.criteriaIds.some((id) => criteria.find((criterion) => criterion.id === id)?.status === "failed");
    return { ...milestone, status: failed ? "blocked" as const : milestone.id === goal.currentMilestoneId ? "active" as const : milestone.status };
  });
  const allVerified = criteria.length > 0 && criteria.every((criterion) => criterion.status === "verified" && criterion.evidence.length > 0);
  const nextAction = evaluation.nextAction ?? goal.nextAction;
  const changed = goalSignature({ ...goal, criteria, milestones, nextAction }) !== previousSignature;
  const stagnationCount = changed ? 0 : goal.stagnationCount + 1;
  const shouldPause = !allVerified && (stagnationCount >= MAX_GOAL_STAGNATION || goal.iteration >= MAX_GOAL_ITERATIONS);
  const status: GoalStatus = allVerified && evaluation.decision === "completed"
    ? "completed"
    : evaluation.decision === "blocked" || shouldPause
      ? (evaluation.decision === "blocked" ? "blocked" : "paused")
      : "active";
  const detail = status === "completed"
    ? "All criteria verified with evidence"
    : status === "blocked"
      ? evaluation.reason || "The evaluator reported a blocker"
      : status === "paused"
        ? "No measurable progress or iteration limit reached"
        : evaluation.reason || "Iteration completed; more work remains";
  return withHistory({
    ...goal,
    criteria,
    milestones,
    status,
    ...(nextAction ? { nextAction } : {}),
    stagnationCount,
    updatedAt: now,
    lastOutcome: status,
    planRevision: changed ? goal.planRevision + 1 : goal.planRevision
  }, { at: now, type: status === "completed" ? "completed" : status === "blocked" ? "blocked" : status === "paused" ? "paused" : "evidence", detail, iteration: goal.iteration });
}

export function goalSignature(goal: Pick<GoalRecord, "criteria" | "milestones" | "nextAction">): string {
  return JSON.stringify({
    criteria: goal.criteria.map(({ id, status, evidence }) => ({ id, status, evidence })),
    milestones: goal.milestones.map(({ id, status, evidence }) => ({ id, status, evidence })),
    nextAction: goal.nextAction ?? ""
  });
}

export function normalizeGoal(value: unknown, fallbackId: string = String(crypto.randomUUID())): GoalRecord | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  const id = stringValue(value.id) ?? fallbackId;
  const objective = stringValue(value.objective);
  const threadId = stringValue(value.threadId);
  if (!objective || !threadId) return undefined;
  const status = isGoalStatus(value.status) ? value.status : "paused";
  const policyValue = isRecord(value.policy) ? value.policy : {};
  const criteria = Array.isArray(value.criteria) ? value.criteria.map(normalizeCriterion).filter(Boolean) as GoalCriterion[] : [];
  const milestones = Array.isArray(value.milestones) ? value.milestones.map(normalizeMilestone).filter(Boolean) as GoalMilestone[] : [];
  if (!criteria.length || !milestones.length) return undefined;
  const history = Array.isArray(value.history) ? value.history.map(normalizeHistory).filter(Boolean) as GoalHistoryEntry[] : [];
  return {
    version: 1,
    id: cleanText(id, 128),
    title: cleanText(stringValue(value.title) ?? objective, 160),
    objective: cleanText(objective, 20_000),
    threadId: cleanText(threadId, 128),
    status,
    createdAt: finiteNumber(value.createdAt) ?? Date.now(),
    updatedAt: finiteNumber(value.updatedAt) ?? Date.now(),
    policy: {
      autoResume: policyValue.autoResume !== false,
      runtime: policyValue.runtime === "deep" ? "deep" : "standard",
      autonomyMode: policyValue.autonomyMode === "execute" || policyValue.autonomyMode === "plan" ? policyValue.autonomyMode : "review",
      finalReview: policyValue.finalReview === "off" || policyValue.finalReview === "always" ? policyValue.finalReview : "changes"
    },
    criteria,
    milestones,
    ...(stringValue(value.currentMilestoneId) ? { currentMilestoneId: stringValue(value.currentMilestoneId) } : {}),
    ...(stringValue(value.nextAction) ? { nextAction: cleanText(stringValue(value.nextAction)!, 4_000) } : {}),
    iteration: clampInteger(value.iteration, 0, MAX_GOAL_ITERATIONS),
    stagnationCount: clampInteger(value.stagnationCount, 0, MAX_GOAL_STAGNATION),
    ...(stringValue(value.lastRunId) ? { lastRunId: stringValue(value.lastRunId) } : {}),
    ...(stringValue(value.lastOutcome) ? { lastOutcome: cleanText(stringValue(value.lastOutcome)!, 1_000) } : {}),
    planRevision: clampInteger(value.planRevision, 1, 10_000),
    history: history.slice(-MAX_GOAL_HISTORY)
  };
}

function withHistory(goal: GoalRecord, entry: GoalHistoryEntry): GoalRecord {
  return { ...goal, history: [...goal.history, entry].slice(-MAX_GOAL_HISTORY) };
}

function normalizeCriterion(value: unknown): GoalCriterion | undefined {
  if (!isRecord(value) || !stringValue(value.id) || !stringValue(value.text)) return undefined;
  const status = value.status === "verified" || value.status === "failed" ? value.status : "pending";
  const evidence = Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === "string").map((item) => cleanText(item, 500)).slice(0, 20) : [];
  return { id: cleanText(stringValue(value.id)!, 128), text: cleanText(stringValue(value.text)!, 4_000), status, evidence };
}

function normalizeMilestone(value: unknown): GoalMilestone | undefined {
  if (!isRecord(value) || !stringValue(value.id) || !stringValue(value.title)) return undefined;
  const status = value.status === "completed" || value.status === "blocked" || value.status === "active" ? value.status : "pending";
  const criteriaIds = Array.isArray(value.criteriaIds) ? value.criteriaIds.filter((item): item is string => typeof item === "string").map((item) => cleanText(item, 128)).slice(0, 30) : [];
  const evidence = Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === "string").map((item) => cleanText(item, 500)).slice(0, 20) : [];
  return { id: cleanText(stringValue(value.id)!, 128), title: cleanText(stringValue(value.title)!, 4_000), status, criteriaIds, evidence, iterationCount: clampInteger(value.iterationCount, 0, MAX_GOAL_ITERATIONS) };
}

function normalizeHistory(value: unknown): GoalHistoryEntry | undefined {
  if (!isRecord(value) || !stringValue(value.detail)) return undefined;
  const types = ["created", "criteria", "iteration", "milestone", "evidence", "resumed", "paused", "blocked", "completed", "cancelled"] as const;
  const type = types.includes(value.type as typeof types[number]) ? value.type as GoalHistoryEntry["type"] : "evidence";
  return { at: finiteNumber(value.at) ?? Date.now(), type, detail: cleanText(stringValue(value.detail)!, 1_000), iteration: clampInteger(value.iteration, 0, MAX_GOAL_ITERATIONS) };
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return ["draft", "active", "awaiting-criteria", "paused", "blocked", "completed", "cancelled"].includes(String(value));
}

function uniqueEvidence(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => cleanText(value, 500)).filter(Boolean))];
}

function cleanText(value: string, maximum: number): string {
  return value.replace(/[\0\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  const number = finiteNumber(value);
  return number === undefined ? minimum : Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
