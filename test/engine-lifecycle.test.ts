import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AgentService, type GraphExecutor } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { Transfers } from "../packages/agent-service/src/transfers";
import { LocalServer } from "../packages/agent-service/src/server";
import { authorizeProvisionedClient } from "../packages/agent-service/src/provisioning";
import { contentHash } from "../packages/contracts/src/identity";
import { runSpec, type Registration, type Run, type ToolSpec, type SessionSnapshot } from "../packages/contracts/src/index";

const tool: ToolSpec = {
  name: "write_fixture", description: "Write fixture",
  schema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
  effect: "write",
};
const reg: Registration = { id: "lifecycle", product: "companion-mac", profile: "test", workspace: "",
  providers: ["ollama"], hostTools: [tool.name], toolCatalog: [tool] };
const spec = runSpec.parse({ runtime: "standard", mode: "execute",
  provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } },
  messages: [{ role: "user", content: "Test" }], systemPrompt: "Test", tools: [tool] });
async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Fixture did not reach expected state");
}
type Request = { id: string; kind: string; payload: { input?: unknown } };

test("a second cold start cannot recover or interrupt the live coordinator's run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-owner-"));
  const file = path.join(directory, "metadata.sqlite");
  const store = new Store(file);
  store.register({ registration: reg, token: "owner-fixture" });
  let finish!: (value: unknown) => void;
  const service = new AgentService(store, directory, () => new Promise((resolve) => { finish = resolve; }), {}, { deferRecovery: true });
  const server = new LocalServer(service, directory);
  await server.listen();
  let other: LocalServer | undefined;
  try {
    const session = store.createSession(reg, "Keep working");
    const run = await service.dispatch(reg, "runs.start", { sessionId: session.id, key: "owner", spec }, "host") as Run;
    other = new LocalServer(new AgentService(new Store(file), directory, undefined, {}, { deferRecovery: true }), directory);
    await assert.rejects(other.listen(), /already exists|EADDRINUSE/);
    assert.equal(store.run(reg, run.id).state, "running");
    finish({ text: "The original owner completed the request" });
    await poll(async () => store.run(reg, run.id), (value) => value.state === "completed");
  } finally { await other?.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
});

 test("cancellation keeps the workspace leased until the executor confirms interruption", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "engine-cancel-"));
  const store = new Store(path.join(dir, "metadata.sqlite"));
  let finish!: (value: unknown) => void;
  const service = new AgentService(store, dir, () => new Promise((resolve) => { finish = resolve; }));
  try {
    const session = store.createSession(reg, "Cancellation");
    const run = await service.dispatch(reg, "runs.start", { sessionId: session.id, key: "cancel", spec }, "host") as Run;
    const cancelling = await service.dispatch(reg, "runs.cancel", { id: run.id }, "host") as Run;
    assert.equal(cancelling.state, "cancelling");
    assert.throws(() => store.start(reg, session.id, "too-soon", spec), /already active/);
    finish({ text: "late result" });
    await poll(async () => store.run(reg, run.id), (value) => value.state === "cancelled");
    assert.equal(store.run(reg, run.id).result, undefined);
    assert.ok(store.start(reg, session.id, "after-confirmation", spec).created);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test("a receipt cannot authorize different tool arguments, even with a reused invocation ID", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "engine-binding-"));
  const store = new Store(path.join(dir, "metadata.sqlite"));
  const service = new AgentService(store, dir, async (_run, context) => {
    await context.invokeTool(tool, { value: "one" }, "stable-invocation");
    return context.invokeTool(tool, { value: "two" }, "stable-invocation");
  });
  try {
    const session = store.createSession(reg, "Binding");
    const run = await service.dispatch(reg, "runs.start", { sessionId: session.id, key: "binding", spec }, "host") as Run;
    const requests = await poll(async () => service.dispatch(reg, "host.poll", {}, "host") as Promise<Request[]>, (value) => value.length > 0);
    assert.deepEqual(requests[0]!.payload.input, { value: "one" });
    await service.dispatch(reg, "host.respond", { id: requests[0]!.id, value: { written: true } }, "host");
    const result = await poll(async () => store.run(reg, run.id), (value) => value.state === "failed");
    assert.match(result.error!, /different tool arguments/);
    assert.deepEqual(await service.dispatch(reg, "host.poll", {}, "host"), []);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test("a pending exact approval survives a service restart without being denied or duplicating its effect", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "engine-approval-"));
  let store = new Store(path.join(dir, "metadata.sqlite"));
  store.register({ registration: reg, token: "test-token" });
  const executor: GraphExecutor = async (_run, context) => context.invokeTool(tool, { value: "one" }, "approval-invocation");
  let service = new AgentService(store, dir, executor);
  try {
    const session = store.createSession(reg, "Approval");
    const run = await service.dispatch(reg, "runs.start", { sessionId: session.id, key: "approval", spec: { ...spec, mode: "review" } }, "before") as Run;
    const before = await poll(async () => service.dispatch(reg, "host.poll", {}, "before") as Promise<Request[]>, (value) => value.length > 0);
    assert.equal(before[0]!.kind, "approval");
    const snapshot = async () => {
      const transfer = await service.dispatch(reg, "sessions.snapshot", { id: session.id }, "viewer") as { id: string };
      return new Transfers(store).json(reg, transfer.id) as SessionSnapshot;
    };
    assert.equal((await snapshot()).pendingApprovals[0]?.id, before[0]!.id);
    assert.equal((await snapshot()).pendingApprovals[0]?.actionable, true);
    await service.close();
    store = new Store(path.join(dir, "metadata.sqlite"));
    service = new AgentService(store, dir, executor);
    assert.equal(store.run(reg, run.id).state, "awaiting_host");
    assert.equal((await snapshot()).pendingApprovals[0]?.id, before[0]!.id);
    assert.equal((await snapshot()).pendingApprovals[0]?.actionable, false);
    await service.dispatch(reg, "runs.resume", { id: run.id }, "after");
    const after = await poll(async () => service.dispatch(reg, "host.poll", {}, "after") as Promise<Request[]>, (value) => value.length > 0);
    assert.equal(after[0]!.id, before[0]!.id);
    await assert.rejects(service.dispatch(reg, "approvals.respond", { id: after[0]!.id, value: "yes" }, "after"), /boolean/);
    await service.dispatch(reg, "approvals.respond", { id: after[0]!.id, value: true }, "after");
    const effect = await poll(async () => service.dispatch(reg, "host.poll", {}, "after") as Promise<Request[]>, (value) => value.some((request) => request.kind === "tool"));
    await service.dispatch(reg, "host.respond", { id: effect[0]!.id, value: { written: true } }, "after");
    await poll(async () => store.run(reg, run.id), (value) => value.state === "completed");
    assert.equal((store.db.prepare("SELECT count(*) AS count FROM receipts WHERE status='completed'").get() as { count: number }).count, 1);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test("tool classification comes from the installed adapter, never the request", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "engine-catalog-"));
  const store = new Store(path.join(dir, "metadata.sqlite"));
  const service = new AgentService(store, dir, async () => ({ text: "must not run" }));
  try {
    const session = store.createSession(reg, "Catalog");
    await assert.rejects(service.dispatch(reg, "runs.start", { sessionId: session.id, key: "forged",
      spec: { ...spec, tools: [{ ...tool, effect: "read" }] } }, "host"), /installed adapter catalog/);
    assert.equal(store.runs(reg, session.id).length, 0);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test("system provisioning binds exact product, profile, adapter and real UID", () => {
  const child: Registration = { ...reg, product: "kidos", profile: "isaac", providers: ["kidos-gateway"],
    hostTools: ["kidos_read"], toolCatalog: [{ ...tool, name: "kidos_read", effect: "read" }] };
  const policy = { schema: 1 as const, clients: [{ uid: 1003, id: child.id, registrationSha256: contentHash(child) }] };
  authorizeProvisionedClient(child, policy, 1003);
  assert.throws(() => authorizeProvisionedClient(child, policy, 1000), /not provisioned/);
  assert.throws(() => authorizeProvisionedClient({ ...child, product: "companion-mac" }, policy, 1003), /not provisioned/);
  assert.throws(() => authorizeProvisionedClient({ ...child, profile: "alien" }, policy, 1003), /not provisioned/);
  assert.throws(() => authorizeProvisionedClient({ ...child, toolCatalog: [{ ...tool, name: "shell" }] }, policy, 1003), /not provisioned/);
});

test("updates wait for active work and quiesce the coordinator before safe shutdown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "engine-activation-"));
  const store = new Store(path.join(dir, "metadata.sqlite"));
  let finish!: (value: unknown) => void;
  const service = new AgentService(store, dir, () => new Promise((resolve) => { finish = resolve; }));
  try {
    const session = store.createSession(reg, "Activation");
    const run = await service.dispatch(reg, "runs.start", { sessionId: session.id, key: "active", spec }, "host") as Run;
    const blocked = await service.dispatch(reg, "engine.shutdownIfIdle", {}, "host") as { accepted: boolean; blockers: { activeRuns: number } };
    assert.equal(blocked.accepted, false);
    assert.equal(blocked.blockers.activeRuns, 1);
    assert.equal(store.run(reg, run.id).state, "running");
    finish({ text: "Done" });
    await poll(async () => store.run(reg, run.id), (value) => value.state === "completed");
    assert.equal((await service.dispatch(reg, "engine.updateStatus", {}, "host") as { ready: boolean }).ready, true);
    assert.equal((await service.dispatch(reg, "engine.shutdownIfIdle", {}, "host") as { accepted: boolean }).accepted, true);
    await assert.rejects(service.dispatch(reg, "runs.start", { sessionId: session.id, key: "race", spec }, "host"), /activating a prepared update/);
    assert.equal(store.runs(reg, session.id).length, 1);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});
