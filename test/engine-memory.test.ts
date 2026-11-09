import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { Store } from "../packages/agent-service/src/store";
import { ProductMemory } from "../packages/agent-service/src/memory";
import type { Registration } from "../packages/contracts/src/index";

test("memory remains product-scoped and retries cannot overwrite a newer revision", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-memory-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  const memory = new ProductMemory(store);
  const reg: Registration = { id: "memory", product: "companion-vscode", profile: "default", workspace: "/same/workspace", providers: ["ollama"], hostTools: [] };
  try {
    const first = memory.put(reg, { key: "project", requestId: "first", revision: 0, content: "VS Code preference" });
    assert.equal(memory.get({ ...reg, product: "companion-mac" }, "project"), undefined);
    const second = memory.put(reg, { key: "project", requestId: "second", revision: 1, content: "New preference" });
    assert.equal(second.revision, 2);
    assert.deepEqual(memory.put(reg, { key: "project", requestId: "first", revision: 0, content: "VS Code preference" }), first);
    assert.equal(memory.get(reg, "project")!.content, "New preference");
    assert.throws(() => memory.put(reg, { key: "project", requestId: "first", revision: 0, content: "Altered" }), /different content/);
    assert.throws(() => memory.put(reg, { key: "project", requestId: "stale", revision: 0, content: "Stale" }), /Refresh/);
    assert.throws(() => memory.put(reg, { key: "other", requestId: "over-limit", revision: 0, content: "á".repeat(1_000_000) }), /2 MB/);
    assert.equal(memory.get(reg, "other"), undefined);
    assert.deepEqual(memory.list(reg), [{ key: "project", revision: 2, updatedAt: second.updatedAt }]);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
