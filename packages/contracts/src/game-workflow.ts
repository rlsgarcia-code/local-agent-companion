import { z } from "zod";
import { identifier } from "./schema";

export const gameStages = ["design", "core", "systems", "content", "polish", "testing", "corrections", "candidate"] as const;
export type GameStage = typeof gameStages[number];
export const gameWorkflowRead = z.object({ projectId: identifier }).strict();
export const gameWorkflowAdvance = z.object({ requestId: identifier, projectId: identifier, expectedVersion: z.number().int().positive(), expectedRevision: z.number().int().positive() }).strict();
/** Public host operation; deliberately absent from the model's tool catalog. */
export const gameWorkflowContinue = gameWorkflowAdvance;
export const gameWorkflowReopen = gameWorkflowAdvance;
export const gameWorkflowEvents = z.object({ projectId: identifier, cursor: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30), until: z.number().int().nonnegative().optional() }).strict();
export const gameWorkflowPolicy = z.object({ requestsPerBlock: z.number().int().min(1).max(1000), maxBlocksPerStage: z.number().int().min(1).max(1000) }).strict();
export type GameWorkflowPolicy = z.infer<typeof gameWorkflowPolicy>;
export type GameWorkflow = {
  id: string; projectId: string; version: number; stage: GameStage; state: "active" | "completed";
  policy: GameWorkflowPolicy; stages: Record<GameStage, { usedRequests: number; blocks: number }>;
  createdAt: number; updatedAt: number;
  lastAccepted?: { workflowId: string; revision: number; sourceHash: string; buildId: string };
};
export type GameWorkflowEvent = { sequence: number; action: string; workflow: GameWorkflow; evidence?: unknown };
export type GameStageGate = { stage: GameStage; blockers: string[]; ready: boolean };
export type GameWorkflowSnapshot = {
  workflow: GameWorkflow | null; projectId: string; revision: number; sourceHash: string;
  effectivePolicy: GameWorkflowPolicy;
  eventCursor: number;
  gates: GameStageGate[]; canAdvance: boolean; qualityReady: boolean;
  budget: { stage: GameStage; usedRequests: number; authorizedRequests: number; exhausted: boolean; canContinue: boolean } | null;
};
