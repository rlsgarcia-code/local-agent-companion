// Read-only admission of a prepared domain copy. This neither starts a service
// nor reconstructs the missing prior run, budget, checkpoints or authority.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ClientCredential } from "../packages/contracts/src/index";
import { ipcPath } from "../packages/agent-service/src/security";
import { readOwnerInferenceLimits } from "../packages/agent-service/src/inference-limits";
import { assertGenerationStateDirectory } from "./game-generation-state";
import { contentHash } from "../packages/contracts/src/identity";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().uuid();
const project = z.object({ id, revision: z.number().int().positive(), contentHash: digest });
const selected = z.object({ id: z.string(), engine: z.string(), request: z.string() });
const ceiling = { namespace: { callsPerBlock: 128, tokensPerBlock: 4194304, maxBlocks: 1 }, stage: { callsPerBlock: 128, tokensPerBlock: 4194304, maxBlocks: 1 }, unknownTokensPerCall: 65536 };
const controlSchema = z.object({ evaluationKind: z.literal("recovery-from-domain-export"), provider: z.enum(["ollama", "openai"]).default("ollama"), stateDirectory: z.string(), engineDirectory: z.string(), servicePid: z.number().int().positive(), registrationId: z.string().regex(/^generation-[a-f0-9-]{36}$/), sessionId: id, projectId: id, engineManifestSha256: digest, archiveSha256: digest, priorAttempt: z.string(), originalProject: project, sourceExport: z.string(), legacyRunResult: z.literal("unknown"), legacyBudget: z.literal("unknown"), operatorAuthorization: z.literal("required-before-new-inference") });

async function privateFile(file: string) {
 const stat = await lstat(file);assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (!process.getuid || stat.uid === process.getuid() && (stat.mode & 0o077) === 0) && stat.size <= 8 * 1024 * 1024, "Private original recovery file required.");return readFile(file);
}
export async function preparedGenerationRecovery(directory: string, caseValue: { id: string; engine: string; request: string }, provider: "ollama" | "openai" = "ollama") {
 const base = await realpath("output/game-generation/windmail-recovery-preparation"), preparation = await realpath(directory);assert.ok(preparation.startsWith(base + path.sep), "Only a prepared generation recovery is accepted.");
 const control = controlSchema.parse(JSON.parse(await readFile(path.join(preparation, "control.json"), "utf8")));
 assert.equal(control.provider, provider, "Prepared provider differs; provision a separate scoped recovery instead of widening the original identity.");
 const report = z.object({ project, revisionsPreserved: z.number().int().positive(), allRevisionFileBytesVerified: z.literal(true), newModelRuns: z.literal(0), newModelCalls: z.literal(0), oldLedgerReset: z.literal(false), legacyCheckpointImported: z.literal(false), pastToolsReplayed: z.literal(false), baseline: z.object({ artifact: z.object({ jobId: id, sourceHash: digest, artifactHash: digest }) }) }).parse(JSON.parse(await readFile(path.join(preparation, "report.json"), "utf8")));
 const closure = z.object({ ownedServiceStopped: z.literal(true), privateStatePreserved: z.literal(true), prepared: z.literal(true) }).parse(JSON.parse(await readFile(path.join(preparation, "closure.json"), "utf8")));
 assert.ok(closure.prepared);assert.equal(report.project.id, control.projectId);assert.equal(report.project.contentHash, control.originalProject.contentHash);assert.equal(report.project.revision, control.originalProject.revision);assert.equal(report.baseline.artifact.sourceHash, report.project.contentHash);
 const prior = await realpath(control.priorAttempt);assert.ok(prior.startsWith(await realpath("output/game-generation") + path.sep));const original = JSON.parse(await readFile(path.join(prior, "control.json"), "utf8"));assert.equal(contentHash(selected.parse(original.case)), contentHash(caseValue), "Recovery must retain the original case request.");
 const source = await realpath(control.sourceExport);assert.ok(source.startsWith(await realpath(original.continuation.attempt) + path.sep));assert.equal(createHash("sha256").update(await readFile(path.join(source, "history.json"))).digest("hex"), control.archiveSha256);
 const state = await assertGenerationStateDirectory(control.stateDirectory);assert.equal(await realpath(control.engineDirectory), await realpath(path.join(state, "engine")));assert.equal(createHash("sha256").update(await readFile(path.join(control.engineDirectory, "manifest.json"))).digest("hex"), control.engineManifestSha256);
 assert.deepEqual(await readOwnerInferenceLimits(state), ceiling, "The prepared hard inference ceiling changed.");
 try { process.kill(control.servicePid, 0);throw Error("Prepared service PID is live or reused; inspect without restarting."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
 try { await lstat(ipcPath(control.stateDirectory));throw Error("Prepared endpoint exists; inspect without replacing it."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
 const schema = z.object({ registration: z.object({ id: z.string(), product: z.literal("companion-vscode"), profile: z.literal("unseen-game-development"), workspace: z.string(), providers: z.tuple([z.enum(["ollama", "openai"])]), hostTools: z.array(z.never()), toolCatalog: z.array(z.never()).optional() }).strict(), token: z.string().regex(/^[A-Za-z0-9_-]{40,256}$/) }).strict();
 const credential: ClientCredential = schema.parse(JSON.parse((await privateFile(path.join(state, "inspection-credential.json"))).toString()));assert.equal(credential.registration.id, control.registrationId);assert.deepEqual(credential.registration.providers, [provider], "Only the exact prepared provider is permitted.");assert.equal(await realpath(credential.registration.workspace), await realpath(path.join(state, "workspace")));await privateFile(path.join(state, "server.key"));await privateFile(path.join(state, "server.crt"));
 return { preparation, state: control.stateDirectory, workspace: credential.registration.workspace, engine: control.engineDirectory, credential, control, project: report.project, baseline: report.baseline, ceiling };
}
