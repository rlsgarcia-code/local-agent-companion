import { z } from "zod";
import { contentHash } from "./identity";
import { identifier } from "./schema";
import { gameFilePath, gameFileTreeConflict } from "./games";
import { gameArtifact, gameObservation, gameToolchain } from "./game-production";
import { gameTestSuitePath } from "./game-browser-tests";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const GAME_BROWSER_INPUT_BYTES = 256 * 1024 * 1024;
export const GAME_BROWSER_EVIDENCE_BYTES = 64 * 1024 * 1024;

/** A sealed one-job exchange, not a public request or a grant of Core authority. */
export const gameBrowserProcessRequest = z.object({
  schemaVersion: z.literal(1), requestId: identifier, toolchain: gameToolchain,
  artifact: gameArtifact, testSuite: gameTestSuitePath.optional(),
  designScenarios: z.array(z.object({ id: identifier, category: z.enum([
    "gameplay", "technical", "visual", "audio", "performance", "accessibility", "human",
  ]) }).strict()).max(500),
}).strict().superRefine((request, context) => {
  const artifact = request.artifact;
  const fingerprint = contentHash({ sourceHash: artifact.sourceHash, engine: artifact.engine,
    toolchain: artifact.toolchain, entrypoint: artifact.entrypoint,
    files: artifact.files.map(({ transferId: _id, ...file }) => file) });
  if (artifact.artifactHash !== fingerprint)
    context.addIssue({ code: "custom", path: ["artifact", "artifactHash"], message: "The immutable build fingerprint differs from its contents." });
  if (artifact.files.reduce((total, file) => total + file.size, 0) > GAME_BROWSER_INPUT_BYTES)
    context.addIssue({ code: "custom", path: ["artifact", "files"], message: "The build exceeds 256 MiB." });
  if (!artifact.files.some(file => file.path === artifact.entrypoint && file.mime === "text/html"))
    context.addIssue({ code: "custom", path: ["artifact", "entrypoint"], message: "The HTML entrypoint must be packaged." });
  if (request.testSuite && !artifact.files.some(file => file.path === request.testSuite && file.mime === "application/json" && file.size <= 1024 * 1024))
    context.addIssue({ code: "custom", path: ["testSuite"], message: "The named suite must be packaged JSON, at most 1 MiB." });
  if (new Set(request.designScenarios.map(row => row.id)).size !== request.designScenarios.length)
    context.addIssue({ code: "custom", path: ["designScenarios"], message: "Design scenario identities must be unique." });
});
export type GameBrowserProcessRequest = z.infer<typeof gameBrowserProcessRequest>;

export const gameBrowserEvidenceFile = z.object({ path: gameFilePath,
  mime: z.enum(["image/png", "application/json"]), size: z.number().int().min(1).max(GAME_BROWSER_EVIDENCE_BYTES), sha256: hash,
}).strict();
export const gameBrowserCandidateObservation = gameObservation.extend({
  category: z.literal("runtime"), environment: gameObservation.shape.environment.extend({ scope: z.literal("automated") }),
  evidenceFiles: z.array(gameBrowserEvidenceFile).max(2000),
}).superRefine((observation, context) => {
  const conflict = gameFileTreeConflict(observation.evidenceFiles.map(file => file.path));
  if (conflict) context.addIssue({ code: "custom", path: ["evidenceFiles", conflict.index], message: conflict.message });
  if (observation.coverage && (observation.coverage.contentIds.length || observation.coverage.scenarioIds.length))
    context.addIssue({ code: "custom", path: ["coverage"], message: "DOM and pixel collection cannot certify semantic coverage." });
});
export const gameBrowserProcessResult = z.object({
  schemaVersion: z.literal(1), requestId: identifier, requestSha256: hash,
  sourceHash: hash, artifactHash: hash, toolchain: gameToolchain, testSuite: gameTestSuitePath.optional(),
  observations: z.array(gameBrowserCandidateObservation).min(1).max(51),
}).strict().superRefine((result, context) => {
  const files = result.observations.flatMap(row => row.evidenceFiles);
  if (files.length > 2000 || files.reduce((total, file) => total + file.size, 0) > GAME_BROWSER_EVIDENCE_BYTES)
    context.addIssue({ code: "custom", path: ["observations"], message: "Browser evidence exceeds its bounded budget." });
});
export type GameBrowserProcessResult = z.infer<typeof gameBrowserProcessResult>;
