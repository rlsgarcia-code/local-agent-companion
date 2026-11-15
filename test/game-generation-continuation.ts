// Development-driver boundary only. No service, enrollment, signal, retry or
// database write belongs here; every live domain check happens through the SDK.
import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ClientCredential } from "../packages/contracts/src/index";
import { ipcPath } from "../packages/agent-service/src/security";
import { readOwnerInferenceLimits } from "../packages/agent-service/src/inference-limits";
import { assertGenerationStateDirectory } from "./game-generation-state";
import type {InferenceBudgetPolicy} from '../packages/contracts/src/inference-budget';

const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid();
const controlSchema = z.object({ provider: z.enum(["ollama", "openai"]).default("ollama"), stateDirectory: z.string(), servicePid: z.number().int().positive(),
  registrationId: z.string().regex(/^generation-[a-f0-9-]{36}$/), sessionId: uuid, runId: uuid,
  engineManifestSha256: hash, suiteSha256: hash, case: z.object({ id: z.string(), engine: z.string(), request: z.string() }) });
const terminal = new Set(["completed", "failed", "cancelled"]);

async function privateFile(file: string): Promise<Buffer> {
  const stat = await lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid?.() &&
    (stat.mode & 0o077) === 0 && stat.size <= 8 * 1024 * 1024, "Private original generation file required.");
  return readFile(file);
}

export async function originalGenerationContinuation(attemptPath: string, suiteSha256: string,
  selected: { id: string; engine: string; request: string }, provider: "ollama" | "openai" = "ollama", authorizedOwnerPolicy?:InferenceBudgetPolicy) {
  const base = await realpath("output/game-generation"), attempt = await realpath(attemptPath);
  assert.ok(attempt.startsWith(base + path.sep), "Only a generation evaluation output is accepted.");
  const control = controlSchema.parse(JSON.parse(await readFile(path.join(attempt, "control.json"), "utf8")));
  assert.equal(control.provider, provider, "Continuation must retain its original provider; use a separately provisioned recovery for a provider change.");
  assert.equal(control.suiteSha256, suiteSha256, "Continuation must retain its original request corpus.");
  assert.deepEqual(control.case, selected, "Continuation must retain its original case and request.");
  const run = JSON.parse(await readFile(path.join(attempt, "run.json"), "utf8")) as { id: string; sessionId: string; state: string };
  assert.equal(run.id, control.runId);assert.equal(run.sessionId, control.sessionId);
  assert.ok(terminal.has(run.state), "Inspect the original nonterminal run; no continuation is permitted.");
  const report = z.object({ runId: uuid, runState: z.string(), engineManifestSha256: hash, suiteSha256: hash,
    sourceProvided: z.boolean().default(false), projects: z.array(z.object({ project: z.object({ id: uuid, revision: z.number().int().positive(), contentHash: hash }),
      jobs: z.array(z.object({ state: z.string() })) })).min(1) })
    .parse(JSON.parse(await readFile(path.join(attempt, "report.json"), "utf8")));
  assert.equal(report.runId, control.runId);assert.equal(report.runState, run.state);
  assert.equal(report.engineManifestSha256, control.engineManifestSha256);assert.equal(report.suiteSha256, suiteSha256);
  assert.ok(report.projects.length > 0, "A persisted project is required for continuation.");
  assert.ok(report.projects.every(row => Array.isArray(row.jobs) && row.jobs.every(job => terminal.has(job.state))),
    "Inspect original pending or unknown production before continuation.");
  const state = await assertGenerationStateDirectory(control.stateDirectory);
  if (provider === "openai") assert.deepEqual(await readOwnerInferenceLimits(state), authorizedOwnerPolicy??{ namespace: { callsPerBlock: 128, tokensPerBlock: 4194304, maxBlocks: 1 }, stage: { callsPerBlock: 128, tokensPerBlock: 4194304, maxBlocks: 1 }, unknownTokensPerCall: 65536 }, "OpenAI continuation must retain its single original block unless a verified owner allocation was supplied.");
  try { process.kill(control.servicePid, 0);throw Error("Original service PID is live or reused; inspect it without restarting."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  try { await lstat(ipcPath(control.stateDirectory));throw Error("Original endpoint exists; inspect without replacing it."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const credentialSchema = z.object({ registration: z.object({
    id: z.string(), product: z.literal("companion-vscode"), profile: z.literal("unseen-game-development"), workspace: z.string(),
    providers: z.tuple([z.enum(["ollama", "openai"])]), hostTools: z.array(z.never()), toolCatalog: z.array(z.never()).optional(),
  }).strict(), token: z.string().regex(/^[A-Za-z0-9_-]{40,256}$/) }).strict();
  const credential: ClientCredential = credentialSchema.parse(JSON.parse((await privateFile(path.join(state, "inspection-credential.json"))).toString()));
  assert.equal(credential.registration.id, control.registrationId);
  assert.equal(credential.registration.product, "companion-vscode");assert.equal(credential.registration.profile, "unseen-game-development");
  assert.deepEqual(credential.registration.providers, [provider]);assert.deepEqual(credential.registration.hostTools, []);
  assert.ok(!credential.registration.toolCatalog?.length, "No host tool enrollment is permitted for this evaluation.");
  const workspace = await realpath(credential.registration.workspace);
  assert.equal(workspace, await realpath(path.join(state, "workspace")));
  // Refuse damaged bootstrap; do not recreate identity or rekey an old account.
  await privateFile(path.join(state, "server.crt"));await privateFile(path.join(state, "server.key"));
  return { attempt, state: control.stateDirectory, workspace: credential.registration.workspace,
    credential, control, sourceProvided: report.sourceProvided, projects: report.projects.map(row => row.project) };
}
