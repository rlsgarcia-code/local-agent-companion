import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { createGenerationState } from "./game-generation-state";
import { preparedGenerationRecovery } from "./game-generation-recovery";
import { createClientCredential, ensureIdentity } from "../packages/agent-service/src/security";
async function fixture(provider: "ollama" | "openai" = "ollama") {
 const state = await createGenerationState(), workspace = path.join(state, "workspace"), engine = path.join(state, "engine");await mkdir(workspace);await mkdir(engine);await ensureIdentity(state);
 const root = path.resolve("output/game-generation", "recovery-test-" + randomUUID()), prior = path.join(root, "prior"), source = path.join(root, "export", "domain"), preparation = path.resolve("output/game-generation/windmail-recovery-preparation", "test-" + randomUUID());
 for (const folder of [prior, source, preparation]) await mkdir(folder, { recursive: true });
 const selected = { id: "fixture", engine: "phaser", request: "PRIVATE_FIXTURE_REQUEST" }, archive = Buffer.from('{"fixture":"domain only"}'), manifest = Buffer.from('{"fixture":"no executable"}');
 await writeFile(path.join(source, "history.json"), archive);await writeFile(path.join(engine, "manifest.json"), manifest);
 const policy = { namespace: { callsPerBlock: 128, tokensPerBlock: 4194304, maxBlocks: 1 }, stage: { callsPerBlock: 128, tokensPerBlock: 4194304, maxBlocks: 1 }, unknownTokensPerCall: 65536 };
 const policyFile = path.join(state, "inference-limits.json");await writeFile(policyFile, JSON.stringify({ schemaVersion: 1, policy }), { mode: 0o600 });
 const registration = { id: "generation-" + randomUUID(), product: "companion-vscode" as const, profile: "unseen-game-development", workspace, providers: [provider], hostTools: [] };
 const credential = await createClientCredential(state, registration), credentialFile = path.join(state, "inspection-credential.json");await writeFile(credentialFile, JSON.stringify(credential), { mode: 0o600 });
 const project = { id: randomUUID(), revision: 34, contentHash: "a".repeat(64) };
 const control = { provider, evaluationKind: "recovery-from-domain-export", stateDirectory: state, engineDirectory: engine, servicePid: 1_000_000_000, registrationId: registration.id, sessionId: randomUUID(), projectId: project.id, engineManifestSha256: createHash("sha256").update(manifest).digest("hex"), archiveSha256: createHash("sha256").update(archive).digest("hex"), priorAttempt: prior, originalProject: { ...project, id: randomUUID() }, sourceExport: source, legacyRunResult: "unknown", legacyBudget: "unknown", operatorAuthorization: "required-before-new-inference" };
 const report = { project, revisionsPreserved: 34, allRevisionFileBytesVerified: true, newModelRuns: 0, newModelCalls: 0, oldLedgerReset: false, legacyCheckpointImported: false, pastToolsReplayed: false, baseline: { artifact: { jobId: randomUUID(), sourceHash: project.contentHash, artifactHash: "b".repeat(64) } } };
 const original = { case: selected, continuation: { attempt: path.join(root, "export") } };
 const save = async () => { await writeFile(path.join(preparation, "control.json"), JSON.stringify(control));await writeFile(path.join(preparation, "report.json"), JSON.stringify(report));await writeFile(path.join(prior, "control.json"), JSON.stringify(original)); };
 await save();await writeFile(path.join(preparation, "closure.json"), JSON.stringify({ ownedServiceStopped: true, privateStatePreserved: true, prepared: true }));
 return { state, workspace, engine, root, source, preparation, selected, control, report, policy, policyFile, credentialFile, save, read: () => preparedGenerationRecovery(preparation, selected, provider), close: async () => { await rm(state, { recursive: true, force: true });await rm(root, { recursive: true, force: true });await rm(preparation, { recursive: true, force: true }); } };
}
test("prepared recovery is read-only and preserves unknown legacy result/budget without enrolling, starting or granting", { skip: process.platform === "win32" }, async () => {
 const f = await fixture();
 try { const files = [f.credentialFile, f.policyFile, path.join(f.state, "server.key")], before = await Promise.all(files.map(file => readFile(file)));const result = await f.read();assert.equal(result.state, f.state);assert.equal(result.project.contentHash, f.report.project.contentHash);assert.equal(result.control.legacyBudget, "unknown");assert.deepEqual(await Promise.all(files.map(file => readFile(file))), before);
  await assert.rejects(preparedGenerationRecovery(f.preparation, { ...f.selected, request: "DIFFERENT_PRIVATE_REQUEST" }), error => error instanceof Error && /original case/.test(error.message) && !/PRIVATE_FIXTURE|DIFFERENT_PRIVATE/.test(error.message));
 } finally { await f.close(); }
});
test("prepared recovery refuses used/changed evidence, unsafe identity, expanded limits and missing closure", { skip: process.platform === "win32" }, async () => {
 const f = await fixture();
 try {
  f.report.newModelCalls = 1;await f.save();await assert.rejects(f.read());f.report.newModelCalls = 0;
  f.control.legacyBudget = "reset";await f.save();await assert.rejects(f.read());f.control.legacyBudget = "unknown";await f.save();
  await chmod(f.credentialFile, 0o644);await assert.rejects(f.read(), /Private original recovery file/);await chmod(f.credentialFile, 0o600);
  await writeFile(f.policyFile, JSON.stringify({ schemaVersion: 1, policy: { ...f.policy, namespace: { ...f.policy.namespace, maxBlocks: 2 } } }));await assert.rejects(f.read(), /ceiling changed/);await writeFile(f.policyFile, JSON.stringify({ schemaVersion: 1, policy: f.policy }));
  await rm(path.join(f.preparation, "closure.json"));await assert.rejects(f.read(), { code: "ENOENT" });assert.equal(await readFile(path.join(f.source, "history.json"), "utf8"), '{"fixture":"domain only"}');
 } finally { await f.close(); }
});

test("the evaluation driver refuses a recovery without explicit operator authorization before reading feedback or starting a service", async () => {
 await assert.rejects(promisify(execFile)(process.execPath, [path.resolve("scripts/qualify-game-generation.mjs"), "--case=windmail", "--ollama-model=qwen3-coder:30b", "--prepared-recovery=missing-preparation-fixture", "--feedback-file=missing-feedback-fixture"], { timeout: 10000, maxBuffer: 65536 }), error => error instanceof Error && /requires explicit operator authorization/.test(error.message) && !/ENOENT/.test(error.message));
});


test("OpenAI domain recovery admits only its independently provisioned provider and never widens an Ollama credential", { skip: process.platform === "win32" }, async () => {
 const f = await fixture("openai");
 try {
  const result = await f.read();assert.deepEqual(result.credential.registration.providers, ["openai"]);
  await assert.rejects(preparedGenerationRecovery(f.preparation, f.selected, "ollama"), /Prepared provider differs/);
  const credential = JSON.parse(await readFile(f.credentialFile, "utf8"));
  credential.registration.providers.push("ollama");await writeFile(f.credentialFile, JSON.stringify(credential));await assert.rejects(f.read());
  credential.registration.providers = ["ollama"];await writeFile(f.credentialFile, JSON.stringify(credential));await assert.rejects(f.read(), /exact prepared provider/);
 } finally { await f.close(); }
});
