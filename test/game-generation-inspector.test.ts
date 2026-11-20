import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import path from "node:path";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { createClientCredential, ensureIdentity } from "../packages/agent-service/src/security";
import { runSpec, type Registration, type Run } from "../packages/contracts/src/index";
import { createGenerationState } from "./game-generation-state";

for (const durable of [false, true]) for (const provider of (durable ? ["ollama", "openai"] as const : ["ollama"] as const)) test("generation inspector authenticates the original " + (durable ? "durable" : "legacy temporary") + " " + provider + " run without dispatch and refuses changed ownership/identity", { skip: process.platform === "win32" }, async () => {
  const state = durable ? await createGenerationState() : await mkdtemp("/tmp/cgg-"), workspace = path.join(state, "workspace");
  const attempt = path.resolve("output/game-generation", `inspector-test-${randomUUID()}`);
  await mkdir(attempt, { recursive: true }); await mkdir(workspace);
  const registration: Registration = { id: `generation-${randomUUID()}`, product: "companion-vscode", profile: "unseen-game-development", workspace, providers: [provider], hostTools: [] };
  const credential = await createClientCredential(state, registration);
  const credentialFile = path.join(state, "inspection-credential.json");
  await writeFile(credentialFile, JSON.stringify(credential), { mode: 0o600 });
  await ensureIdentity(state);
  const store = new Store(path.join(state, "metadata.sqlite"));store.register(credential);
  let release!: () => void;const pending = new Promise<void>(resolve => { release = resolve; });
  const hash = "a".repeat(64);
  const service = new AgentService(store, state, async () => { await pending;return { text: "Fixture only; no model/tool called" }; }, { manifestSha256: hash });
  const server = new LocalServer(service, state);
  const inspect = (directory = attempt) => promisify(execFile)(process.execPath, [path.resolve("scripts/inspect-game-generation.mjs"), `--attempt=${directory}`], { timeout: 10000, maxBuffer: 1024 * 1024 });
  try {
    await server.listen();
    const session = store.createSession(registration, "Inspector fixture");
    const run = await service.dispatch(registration, "runs.start", { sessionId: session.id, key: "original", spec: runSpec.parse({ runtime: "standard", mode: "plan", provider: { kind: provider, endpoint: provider === "openai" ? "https://api.openai.com/v1" : "http://127.0.0.1:11434/v1", roles: { executor: "not-invoked" } }, messages: [{ role: "user", content: "Fixture only" }], systemPrompt: "Fixture only", tools: [] }) }, "fixture-owner") as Run;
    const control = { provider, stateDirectory: state, servicePid: process.pid, registrationId: registration.id, engineManifestSha256: hash, sessionId: session.id, runId: run.id, case: { id: "fixture" } };
    await writeFile(path.join(state, "runtime.json"), JSON.stringify({ pid: process.pid }));
    const saveControl = () => writeFile(path.join(attempt, "control.json"), JSON.stringify(control));await saveControl();
    const observed = JSON.parse((await inspect()).stdout);
    assert.equal(observed.liveAuthenticatedService, true);assert.equal(observed.run.id, run.id);assert.equal(observed.run.state, "running");
    assert.equal(observed.project, null);assert.deepEqual(observed.jobs, []);
    assert.equal(store.run(registration, run.id).state, "running");
    assert.equal((store.db.prepare("SELECT count(*) AS n FROM game_production_jobs").get() as { n: number }).n, 0);
    assert.deepEqual(await service.dispatch(registration, "host.poll", {}, "fixture-owner"), []);
    await chmod(credentialFile, 0o644);
    await assert.rejects(inspect(), /Private original credential required/);await chmod(credentialFile, 0o600);
    control.servicePid++;await saveControl();await assert.rejects(inspect(), /original service identity changed/);
    await assert.rejects(inspect(path.resolve(".")), /Only a generation evaluation output/);
    assert.equal(store.run(registration, run.id).state, "running");
  } finally { release();await server.close();await rm(state, { recursive: true, force: true });await rm(attempt, { recursive: true, force: true }); }
});
