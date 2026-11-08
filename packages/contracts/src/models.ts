import { z } from "zod";
import { identifier } from "./schema";

export const ollamaRoleConfiguration = z.object({
  executor: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/),
  planner: z.string().max(200).optional(), evaluator: z.string().max(200).optional(),
  vision: z.string().max(200).optional(), embedding: z.string().max(200).optional(),
}).strict();
export const modelConfiguration = z.object({
  revision: z.number().int().nonnegative(), roles: ollamaRoleConfiguration,
}).strict();
export const modelDownload = z.object({ key: identifier, model: ollamaRoleConfiguration.shape.executor }).strict();
export const modelRecommendation = z.object({
  key: identifier, advisorModel: ollamaRoleConfiguration.shape.executor.optional(),
  publicCatalog: z.unknown().optional(),
  // Exact image aliases already inspected by the host's Docker adapter. No pulls.
  installedDockerImages: z.array(z.string().max(256)).max(200).default([]),
}).strict();
export const modelJobStates = ["running", "cancelling", "completed", "cancelled", "failed", "interrupted"] as const;
export type ModelJob = {
  id: string; kind: "download" | "recommendation"; state: typeof modelJobStates[number];
  createdAt: number; updatedAt: number; model?: string;
  progress?: { model: string; line: string; done: boolean; error?: string };
  result?: unknown; error?: string;
};
