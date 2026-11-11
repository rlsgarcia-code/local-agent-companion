import { z } from "zod";
import { identifier } from "./schema";

export const modelSelectionMode = z.enum(["optimized", "custom"]);
export const modelOptimizationProfile = z.enum(["quality", "balanced", "speed"]);
export const configurableModelProvider = z.enum(["ollama", "openai", "litellm"]);
export type ModelSelectionMode = z.infer<typeof modelSelectionMode>;
export type ModelOptimizationProfile = z.infer<typeof modelOptimizationProfile>;

export const ollamaRoleConfiguration = z.object({
  executor: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/),
  planner: z.string().max(200).optional(), evaluator: z.string().max(200).optional(),
  vision: z.string().max(200).optional(), embedding: z.string().max(200).optional(),
}).strict();
export const modelConfiguration = z.object({
  revision: z.number().int().nonnegative(),
  provider: configurableModelProvider.default("ollama"),
  endpoint: z.string().url().default("http://127.0.0.1:11434/v1"),
  credentialRef: identifier.optional(),
  selectionMode: modelSelectionMode.default("custom"),
  optimizationProfile: modelOptimizationProfile.default("balanced"),
  roles: ollamaRoleConfiguration,
}).strict();
export type ModelConfiguration = z.infer<typeof modelConfiguration>;
export const modelDownload = z.object({ key: identifier, model: ollamaRoleConfiguration.shape.executor }).strict();
export const modelRecommendation = z.object({
  key: identifier, advisorModel: ollamaRoleConfiguration.shape.executor.optional(),
  optimizationProfile: modelOptimizationProfile.default("balanced"),
  publicCatalog: z.unknown().optional(),
  // Exact image aliases already inspected by the host's Docker adapter. No pulls.
  installedDockerImages: z.array(z.string().max(256)).max(200).default([]),
}).strict();
export const modelCatalog = z.object({
  provider: configurableModelProvider,
  models: z.array(z.string().min(1).max(200)).max(5_000),
  loadedAt: z.number().int().nonnegative(),
}).strict();
export type ModelCatalog = z.infer<typeof modelCatalog>;
export const modelJobStates = ["running", "cancelling", "completed", "cancelled", "failed", "interrupted"] as const;
export type ModelJob = {
  id: string; kind: "download" | "recommendation"; state: typeof modelJobStates[number];
  createdAt: number; updatedAt: number; model?: string;
  progress?: { model: string; line: string; done: boolean; error?: string };
  result?: unknown; error?: string;
};
