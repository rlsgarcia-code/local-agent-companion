import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { Store } from "../packages/agent-service/src/store";
import { Models } from "../packages/agent-service/src/models";
import type { Registration } from "../packages/contracts/src/index";
import type { PullProgress } from "../packages/contracts/src/desktop";
import { pullOllamaModel } from "../packages/agent-core/src/ollama-models";
const reg: Registration = { id: "mac", product: "companion-mac", profile: "default", workspace: "", providers: ["ollama"], hostTools: [] };

test("a truncated model download cannot report successful installation", async () => {
  const progress: PullProgress[] = [];
  await assert.rejects(pullOllamaModel("fixture", (event) => progress.push(event), new AbortController().signal,
    async () => new Response(JSON.stringify({ status: "downloading", completed: 12, total: 100 }))), /without confirming success/);
  assert.ok(progress.at(-1)?.error);
});

test("model jobs survive a client disappearing; cancellation targets only the owned job", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-models-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  let finished!: () => void;
  let publish!: (progress: PullProgress) => void;
  let calls = 0;
  const models = new Models(store, directory, {
    ollamaStatus: async () => ({ connected: true, models: [] }), invokeAdvisor: async () => "{}",
    cancelDownload: () => finished(),
    pullModel: async (_name, progress) => { calls++; publish = progress; await new Promise<void>((resolve) => { finished = resolve; }); },
  });
  try {
    const session = store.createSession(reg, "An independent conversation");
    const run = store.start(reg, session.id, "conversation", {}).run;
    const job = models.pull(reg, { key: "download", model: "fixture:small" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(models.pull(reg, { key: "download", model: "fixture:small" }).id, job.id);
    assert.throws(() => models.pull(reg, { key: "download", model: "other" }), /different content/);
    assert.throws(() => models.cancel({ ...reg, profile: "another-child" }, job.id), /not found/);
    assert.throws(() => models.pull(reg, { key: "another", model: "other" }), /Another model download/);
    publish({ model: "fixture:small", line: "50%", done: false });
    assert.equal(models.get(reg, job.id).progress?.line, "50%");
    assert.equal(models.cancel(reg, job.id).state, "cancelling");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(models.get(reg, job.id).state, "cancelled");
    assert.equal(store.run(reg, run.id).state, "running");
  } finally { await models.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("model recovery preserves jobs and settings without reissuing a pull or allowing child configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-model-recovery-"));
  const file = path.join(directory, "metadata.sqlite");
  let store = new Store(file), calls = 0;
  let models = new Models(store, directory, {
    ollamaStatus: async () => ({ connected: true, models: [] }), invokeAdvisor: async () => "{}", cancelDownload: () => {},
    pullModel: async () => { calls++; },
  });
  try {
    models.configure(reg, { revision: 0, roles: { executor: "fixture" } });
    assert.throws(() => models.configure(reg, { revision: 0, roles: { executor: "changed" } }), /Refresh/);
    const child = { ...reg, product: "kidos" as const, providers: ["kidos-gateway" as const] };
    assert.throws(() => models.configure(child, { revision: 0, roles: { executor: "unprotected" } }), /system authority/);
    const job = models.pull(reg, { key: "completed", model: "fixture" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(models.get(reg, job.id).state, "completed");
    // Simulate an abrupt stop before a completed job was persisted.
    store.db.prepare("UPDATE model_jobs SET value=? WHERE id=?").run(JSON.stringify({ ...job, state: "running" }), job.id);
    await models.close(); store.close();
    store = new Store(file); models = new Models(store, directory);
    models.recover();
    assert.equal(models.get(reg, job.id).state, "interrupted");
    assert.equal(models.configuration(reg)?.roles.executor, "fixture");
    assert.equal(calls, 1);
    assert.equal(models.pull(reg, { key: "completed", model: "fixture" }).state, "interrupted");
  } finally { await models.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
});
