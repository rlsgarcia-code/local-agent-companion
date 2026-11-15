import { z } from "zod";
import { identifier } from "./schema";
import { gameEngine, gameFile, gameFilePath, gameFileTreeConflict } from "./games";
import { gameTestSuitePath } from "./game-browser-tests";
import type { GameAssetSpec } from "./game-assets";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const gameBuildRequest = z.object({ requestId: identifier, projectId: identifier, revision: z.number().int().positive() }).strict();
export const gameValidationRequest = z.object({ requestId: identifier, buildId: identifier, collectorId: identifier, testSuite: gameTestSuitePath.optional() }).strict();
export const gameProductionRead = z.object({ id: identifier }).strict();
export const gameArtifactFileRead = z.object({ buildId: identifier, path: gameFilePath }).strict();
export const gameProductionEvents = z.object({ projectId: identifier, cursor: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(500).default(100) }).strict();
export const gameProductionList = z.object({ projectId: identifier, cursor: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30), order:z.enum(["asc","desc"]).default("asc") }).strict();
export const gameToolchain = z.object({ id: identifier, version: z.string().min(1).max(128), sha256 }).strict();
export const gameProductionStates = ["admitting", "queued", "running", "cancelling", "awaiting_reconciliation", "completed", "cancelled", "failed"] as const;
export const gameProductionTerminal: ReadonlySet<string> = new Set(["completed", "cancelled", "failed"]);
/** Admission estimates, not OS memory/CPU limits. Only installed ports declare them. */
export const gameProductionResources = z.object({
  memoryMiB: z.number().int().min(1).max(1048576),
  cpuSlots: z.number().int().min(1).max(1024),
  exclusiveGroups: z.array(z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/)).max(8),
}).strict();
export type GameProductionResources = z.infer<typeof gameProductionResources>;
export const gameProductionBudget = z.object({
  memoryMiB: z.number().int().min(1).max(1048576),
  cpuSlots: z.number().int().min(1).max(1024),
  maxConcurrent: z.number().int().min(1).max(32),
  maxQueued: z.number().int().min(1).max(1024),
}).strict();
export type GameProductionBudget = z.infer<typeof gameProductionBudget>;
export type GameProductionJob = {
  id: string; kind: "build" | "validate" | "assets"; projectId: string; revision: number; sourceHash: string;
  engine: z.infer<typeof gameEngine>; adapterId: string; toolchain: z.infer<typeof gameToolchain>;
  state: typeof gameProductionStates[number]; buildId?: string; testSuite?: string;
  createdAt: number; updatedAt: number; error?: string; artifactId?: string; reportIds?: string[];
  assetSpec?: GameAssetSpec;
  resources?: GameProductionResources;
  waitingReason?: "resources";
  /** Service-owned external admission journal; never supplied by the client. */
  admission?: "pending" | "reserved";
};
export const gameArtifact = z.object({
  id: identifier, jobId: identifier, projectId: identifier, revision: z.number().int().positive(), sourceHash: sha256,
  engine: gameEngine, adapterId: identifier, toolchain: gameToolchain,
  entrypoint: gameFilePath, files: z.array(gameFile).min(1).max(20000), artifactHash: sha256,
  createdAt: z.number().int().nonnegative(),
}).strict().superRefine((artifact, context) => {
  const conflict = gameFileTreeConflict(artifact.files.map((file) => file.path));
  if (conflict) context.addIssue({ code: "custom", path: ["files", conflict.index, "path"], message: conflict.message });
});
export type GameArtifact = z.infer<typeof gameArtifact>;
export const gameQualityCategories = ["runtime", "content", "visual", "audio", "performance", "license", "human"] as const;
export const gameObservation = z.object({
  category: z.enum(gameQualityCategories),
  checks: z.array(z.object({ id: identifier, status: z.enum(["passed", "failed", "unverified"]), detail: z.string().min(1).max(4000) }).strict()).min(1).max(500),
  environment: z.object({ platform: z.string().min(1).max(128), device: z.string().min(1).max(300),
    browser: z.string().min(1).max(128), input: z.array(z.enum(["keyboard", "pointer", "touch", "gamepad"])).max(4),
    scope: z.enum(["physical", "automated", "static", "human"]),
  }).strict(),
  metrics: z.record(z.string().min(1).max(100), z.union([z.number().finite(), z.boolean(), z.string().max(2000)])),
  coverage: z.object({ contentIds: z.array(identifier).max(2000), scenarioIds: z.array(identifier).max(500) }).strict().optional(),
  testCase: z.object({ suite: gameTestSuitePath, id: identifier }).strict().optional(),
}).strict();
export type GameObservation = z.infer<typeof gameObservation>;
export type GameValidationReport = GameObservation & {
  id: string; jobId: string; buildId: string; projectId: string; revision: number;
  sourceHash: string; artifactHash: string; collectorId: string;
  toolchain: z.infer<typeof gameToolchain>; createdAt: number;
  evidence?: z.infer<typeof gameFile>[];
};
export type GameQualityAssessment = {
  projectId: string; revision: number; sourceHash: string; buildId: string | null;
  artifactHash: string | null; ready: boolean; stale: boolean;
  blockers: string[]; reports: GameValidationReport[];
};
export type GameProductionCapabilities = {
  resourceBudget?: GameProductionBudget;
  assetProcessors?: { id: string; operations: readonly string[]; toolchain: z.infer<typeof gameToolchain>; available: boolean; reason?: string; resources?: GameProductionResources; projectGuide?: string }[];
  adapters: { id: string; engine: z.infer<typeof gameEngine>; toolchain: z.infer<typeof gameToolchain>; available: boolean; reason?: string; projectGuide?: string; resources?: GameProductionResources }[];
  collectors: { id: string; engines: readonly z.infer<typeof gameEngine>[]; categories: readonly GameObservation["category"][]; toolchain: z.infer<typeof gameToolchain>; available?: boolean; reason?: string; resources?: GameProductionResources; projectGuide?: string }[];
};
