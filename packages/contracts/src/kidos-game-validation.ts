/** Private protected observation protocol; a report is not a shutdown/QA grant. */
import { z } from "zod";
import { gameToolchain } from "./game-production";
import { gameBrowserEvidenceFile, gameBrowserProcessResult } from "./game-browser-worker";
import { coreBuildReceipt, coreBuildProgress, coreBuildChunk, coreBuildReply, coreProductionPolicy } from "./kidos-game-builds";

export const coreValidationReceipt = coreBuildReceipt.extend({ production_kind: z.literal("validate"), admitted: z.boolean() });
export const coreValidationCapabilities = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false), reason: z.string().min(1).max(4000) }).strict(),
  z.object({ available: z.literal(true), validation_abi: z.literal(1), queue_budget_abi: z.literal(1),
    collector_id: z.literal("kidos-core-browser-v1"), engines: z.array(z.enum(["phaser", "babylon", "godot"])).min(1).max(3),
    categories: z.tuple([z.literal("runtime")]), toolchain: gameToolchain, admission: coreProductionPolicy,
    chunk_bytes: z.literal(262144), request_bytes: z.literal(16777216), source_bytes: z.literal(268435456), result_bytes: z.literal(71303168),
  }).strict(),
]);
const { observations: _observations, ...binding } = gameBrowserProcessResult.shape;
export const coreValidationPage = z.object({ ...binding,
  collector_id: z.literal("kidos-core-browser-v1"), observation_count: z.number().int().min(1).max(51),
  report: gameBrowserEvidenceFile.extend({ path: z.literal("report.json"), mime: z.literal("application/json"), size: z.number().int().min(1).max(4194304) }),
  files: z.array(gameBrowserEvidenceFile).max(100), cursor: z.number().int().min(0).max(2001), has_more: z.boolean(),
}).strict();
export const installedCoreGameValidationSchemas = { receipt: coreValidationReceipt, capabilities: coreValidationCapabilities,
  page: coreValidationPage, progress: coreBuildProgress, chunk: coreBuildChunk, reply: coreBuildReply };
