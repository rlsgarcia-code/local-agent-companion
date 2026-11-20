import assert from "node:assert/strict";
import test from "node:test";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { readOwnerInferenceLimits, INFERENCE_LIMITS_FILE } from "../packages/agent-service/src/inference-limits";
import { InferenceBudgets, defaultInferenceBudgetPolicy } from "../packages/agent-service/src/inference-budgets";
import { Store } from "../packages/agent-service/src/store";
import { runSpec, type Registration } from "../packages/contracts/src/index";
const policy = { namespace: { callsPerBlock: 2, tokensPerBlock: 262144, maxBlocks: 1 }, stage: { callsPerBlock: 2, tokensPerBlock: 262144, maxBlocks: 1 }, unknownTokensPerCall: 65536 };
async function fixture() { const directory = await mkdtemp(path.join(tmpdir(), "inference-limits-")), file = path.join(directory, INFERENCE_LIMITS_FILE);return { directory, file, write: (value: unknown) => writeFile(file, JSON.stringify(value), { mode: 0o600 }), close: () => rm(directory, { recursive: true, force: true }) }; }
test("owner limits preserve absent defaults, accept a strict lower ceiling and reject expansion without echoing configuration", async () => {
 const f = await fixture();
 try {
  assert.equal(await readOwnerInferenceLimits(f.directory), undefined);await f.write({ schemaVersion: 1, policy });const bytes = await readFile(f.file);assert.deepEqual(await readOwnerInferenceLimits(f.directory), policy);assert.deepEqual(await readFile(f.file), bytes);
  for (const value of [
   { schemaVersion: 1, policy: { ...defaultInferenceBudgetPolicy, namespace: { ...defaultInferenceBudgetPolicy.namespace, callsPerBlock: 513 } } },
   { schemaVersion: 1, policy: { ...defaultInferenceBudgetPolicy, unknownTokensPerCall: 1 } },
   { schemaVersion: 1, policy, PRIVATE_SECRET: "never echo" }, { schemaVersion: 2, policy }, null,
  ]) { await f.write(value);await assert.rejects(readOwnerInferenceLimits(f.directory), error => error instanceof Error && /Invalid or unsafe/.test(error.message) && !/PRIVATE|never echo/.test(error.message)); }
  await writeFile(f.file, '{"PRIVATE_MALFORMED":', { mode: 0o600 });await assert.rejects(readOwnerInferenceLimits(f.directory), error => error instanceof Error && !error.message.includes("PRIVATE_MALFORMED"));
 } finally { await f.close(); }
});
test("owner limits refuse public, linked, non-file or oversized input and preserve original bytes", { skip: process.platform === "win32" }, async () => {
 const f = await fixture(), other = f.file + ".original";
 try {
  await f.write({ schemaVersion: 1, policy });await chmod(f.file, 0o644);await assert.rejects(readOwnerInferenceLimits(f.directory), /unsafe/);await chmod(f.file, 0o600);const bytes = await readFile(f.file);
  await link(f.file, other);await assert.rejects(readOwnerInferenceLimits(f.directory), /unsafe/);await rm(f.file);await symlink(other, f.file);await assert.rejects(readOwnerInferenceLimits(f.directory), /unsafe/);assert.deepEqual(await readFile(other), bytes);
  await rm(f.file);await mkdir(f.file);await assert.rejects(readOwnerInferenceLimits(f.directory), /unsafe/);await rm(f.file, { recursive: true });await writeFile(f.file, " ".repeat(16385), { mode: 0o600 });await assert.rejects(readOwnerInferenceLimits(f.directory), /unsafe/);
 } finally { await f.close(); }
});
test("the loaded ceiling limits concurrent namespace admission across sessions and restart without refund or renewal", async () => {
 const f = await fixture(), database = path.join(f.directory, "ledger.sqlite");let store = new Store(database);
 const reg: Registration = { id: "owner-limits", product: "companion-vscode", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
 try {
  await f.write({ schemaVersion: 1, policy });let meter = new InferenceBudgets(store, await readOwnerInferenceLimits(f.directory));
  const a = store.createSession(reg, "First"), b = store.createSession(reg, "Second"), spec = runSpec.parse({ runtime: "standard", mode: "plan", messages: [{ role: "user", content: "No actual inference" }], tools: [], systemPrompt: "", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } } });
  const r1 = store.start(reg, a.id, "a", spec).run, r2 = store.start(reg, b.id, "b", spec).run, scopes = [{ kind: "namespace" as const }];
  assert.equal(meter.begin(reg, r1.id, "one", scopes), null);assert.equal(meter.begin(reg, r2.id, "two", scopes), null);assert.ok(meter.begin(reg, r2.id, "blocked", scopes));meter.finish(reg, r1.id, "one", { input: 4, output: 5 });
  store.close();store = new Store(database);meter = new InferenceBudgets(store, await readOwnerInferenceLimits(f.directory));meter.recover();const value = meter.snapshot(reg, scopes).budgets[0]!;
  assert.equal(value.calls, 2);assert.equal(value.chargedTokens, 65545);assert.equal(value.unreportedCalls, 1);assert.equal(value.pendingCalls, 0);assert.equal(value.canContinue, false);assert.ok(meter.begin(reg, r1.id, "still-blocked", scopes));assert.throws(() => meter.grant(reg, "forged-renewal", { budgets: [value] }));assert.equal(meter.snapshot(reg, scopes).budgets[0]!.blocks, 1);
 } finally { store.close();await f.close(); }
});
