import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { originalGenerationContinuation } from "./game-generation-continuation";
import { createGenerationState } from "./game-generation-state";

async function fixture(durable = false, provider: "ollama" | "openai" = "ollama") {
  const state = durable ? await createGenerationState() : await mkdtemp("/tmp/cgg-"), workspace = path.join(state, "workspace");await mkdir(workspace);
  const attempt = path.resolve("output/game-generation", `continuation-test-${randomUUID()}`);await mkdir(attempt, { recursive: true });
  const registration = { id: `generation-${randomUUID()}`, product: "companion-vscode" as const,
    profile: "unseen-game-development", workspace, providers: [provider], hostTools: [] };
  const credential = await createClientCredential(state, registration);await ensureIdentity(state);
  const credentialFile = path.join(state, "inspection-credential.json");await writeFile(credentialFile, JSON.stringify(credential), { mode: 0o600 });
  const selected = { id: "fixture", engine: "phaser", request: "Fixture only; no inference or effect" }, suite = "a".repeat(64);
  const control = { provider, stateDirectory: state, servicePid: 1_000_000_000, registrationId: registration.id,
    sessionId: randomUUID(), runId: randomUUID(), engineManifestSha256: "b".repeat(64), suiteSha256: suite, case: selected };
  const run = { id: control.runId, sessionId: control.sessionId, state: "failed" };
  const report = { sourceProvided: provider === "openai", runId: control.runId, runState: "failed", engineManifestSha256: control.engineManifestSha256,
    suiteSha256: suite, projects: [{ project: { id: randomUUID(), revision: 8, contentHash: "c".repeat(64) }, jobs: [{ state: "failed" }] }] };
  if (provider === "openai") await writeFile(path.join(state, "inference-limits.json"), JSON.stringify({ schemaVersion: 1, policy: { namespace: { callsPerBlock: 128, tokensPerBlock: 4194304, maxBlocks: 1 }, stage: { callsPerBlock: 128, tokensPerBlock: 4194304, maxBlocks: 1 }, unknownTokensPerCall: 65536 } }), { mode: 0o600 });
  const save = async () => { for (const [name, value] of Object.entries({ control, run, report })) await writeFile(path.join(attempt, `${name}.json`), JSON.stringify(value)); };
  await save();
  return { state, attempt, credentialFile, credential, control, run, report, suite, selected, save,
    read: () => originalGenerationContinuation(attempt, suite, selected, provider),
    close: async () => { await rm(state, { recursive: true, force: true });await rm(attempt, { recursive: true, force: true }); } };
}

test("a continuation reuses only the exact private identity/domain and does not write or re-enroll", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    const files = [f.credentialFile, path.join(f.state, "server.key"), path.join(f.state, "server.crt")];
    const before = await Promise.all(files.map(file => readFile(file)));
    const result = await f.read();
    assert.equal(result.state, f.state);assert.deepEqual(result.credential, f.credential);
    assert.equal(result.control.sessionId, f.control.sessionId);assert.deepEqual(result.projects, f.report.projects.map(row => row.project));
    assert.deepEqual(await Promise.all(files.map(file => readFile(file))), before);
  } finally { await f.close(); }
});

test("durable evaluation state retains the same terminal/corpus/identity guards and original bytes for explicit continuation", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(true);
  try {
    const before = await readFile(f.credentialFile), result = await f.read();
    assert.equal(result.state, f.state);assert.deepEqual(await readFile(f.credentialFile), before);
    f.run.state = f.report.runState = "awaiting_reconciliation";await f.save();await assert.rejects(f.read(), /original nonterminal run/);
    f.run.state = f.report.runState = "failed";f.report.projects[0]!.jobs[0]!.state = "awaiting_reconciliation";await f.save();await assert.rejects(f.read(), /pending or unknown production/);
    assert.deepEqual(await readFile(f.credentialFile), before);
  } finally { await f.close(); }
});

test("nonterminal execution or unknown/pending production cannot be continued", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    for (const state of ["running", "cancelling", "awaiting_reconciliation", "awaiting_approval"]) {
      f.run.state = state;f.report.runState = state;await f.save();
      await assert.rejects(f.read(), /original nonterminal run/);
    }
    f.run.state = f.report.runState = "failed";
    for (const state of ["queued", "running", "cancelling", "awaiting_reconciliation", "unrecognized-state"]) {
      f.report.projects[0]!.jobs[0]!.state = state;await f.save();
      await assert.rejects(f.read(), /pending or unknown production/);
    }
  } finally { await f.close(); }
});

test("a live/reused PID or existing endpoint refuses restart without signaling or unlinking", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    f.control.servicePid = process.pid;await f.save();await assert.rejects(f.read(), /PID is live or reused/);
    f.control.servicePid = 1_000_000_000;await f.save();
    const endpoint = ipcPath(f.state);await mkdir(path.dirname(endpoint), { recursive: true });
    await writeFile(endpoint, "sentinel");await assert.rejects(f.read(), /Original endpoint exists/);
    assert.equal(await readFile(endpoint, "utf8"), "sentinel");
  } finally { await f.close(); }
});

test("continuation refuses changed corpus, unsafe credentials and host authority", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(originalGenerationContinuation(f.attempt, "d".repeat(64), f.selected), /original request corpus/);
    await assert.rejects(originalGenerationContinuation(f.attempt, f.suite, { ...f.selected, request: "Different" }), /original case and request/);
    await chmod(f.credentialFile, 0o644);await assert.rejects(f.read(), /Private original generation file/);await chmod(f.credentialFile, 0o600);
    await writeFile(f.credentialFile, JSON.stringify({ ...f.credential, registration: { ...f.credential.registration, hostTools: ["shell"] } }));
    await assert.rejects(f.read());
    await assert.rejects(originalGenerationContinuation(path.resolve("."), f.suite, f.selected), /Only a generation evaluation output/);
  } finally { await f.close(); }
});


test("OpenAI continuation preserves its existing namespace, source provenance and one block; it cannot switch or add providers", { skip: process.platform === "win32" }, async () => {
 const f = await fixture(true, "openai");
 try {
  const before = await readFile(f.credentialFile), result = await f.read();
  assert.equal(result.sourceProvided, true);assert.equal(result.control.sessionId, f.control.sessionId);
  assert.deepEqual(result.credential.registration.providers, ["openai"]);assert.deepEqual(await readFile(f.credentialFile), before);
  await assert.rejects(originalGenerationContinuation(f.attempt, f.suite, f.selected, "ollama"), /original provider/);
  await rm(path.join(f.state, "inference-limits.json"));await assert.rejects(f.read(), /single original block/);
 } finally { await f.close(); }
});
