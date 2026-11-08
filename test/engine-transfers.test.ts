import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AgentClient } from "../packages/client-ts/src/index";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { Transfers } from "../packages/agent-service/src/transfers";
import { LocalServer } from "../packages/agent-service/src/server";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { message, runSpec, type Registration, type Session } from "../packages/contracts/src/index";
import { TRANSFER_CHUNK_BYTES } from "../packages/contracts/src/transfers";

const reg: Registration = { id: "transfer", product: "companion-mac", profile: "test", workspace: "",
  providers: ["ollama"], hostTools: [] };

test("transfers survive restart, deduplicate chunks and reject forged content and namespaces", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-transfers-"));
  let store = new Store(path.join(directory, "metadata.sqlite"));
  try {
    let transfers = new Transfers(store);
    const data = Buffer.alloc(TRANSFER_CHUNK_BYTES * 2 + 37, 7);
    const spec = { key: "resumable", size: data.length, sha256: createHash("sha256").update(data).digest("hex"), mime: "application/octet-stream" as const };
    const transfer = transfers.begin(reg, spec);
    transfers.append(reg, transfer.id, 0, data.subarray(0, TRANSFER_CHUNK_BYTES));
    store.close();
    store = new Store(path.join(directory, "metadata.sqlite"));
    transfers = new Transfers(store);
    assert.equal(transfers.begin(reg, spec).received, TRANSFER_CHUNK_BYTES);
    assert.equal(transfers.append(reg, transfer.id, 0, data.subarray(0, TRANSFER_CHUNK_BYTES)).received, TRANSFER_CHUNK_BYTES);
    assert.throws(() => transfers.append(reg, transfer.id, 0, Buffer.alloc(TRANSFER_CHUNK_BYTES, 8)), /content changed/);
    assert.throws(() => transfers.commit(reg, transfer.id), /incomplete/);
    assert.throws(() => transfers.get({ ...reg, profile: "other" }, transfer.id), /not found/);
    assert.throws(() => transfers.begin(reg, { ...spec, size: 1 }), /different content/);
    for (let offset = TRANSFER_CHUNK_BYTES; offset < data.length; offset += TRANSFER_CHUNK_BYTES)
      transfers.append(reg, transfer.id, offset, data.subarray(offset, offset + TRANSFER_CHUNK_BYTES));
    assert.equal(transfers.commit(reg, transfer.id).committed, true);
    assert.equal(transfers.commit(reg, transfer.id).committed, true);
    assert.equal(Buffer.from(transfers.read(reg, transfer.id, TRANSFER_CHUNK_BYTES - 3).data, "base64").length, TRANSFER_CHUNK_BYTES);
    const invalid = transfers.begin(reg, { ...spec, key: "tampered", sha256: "0".repeat(64), size: 3 });
    transfers.append(reg, invalid.id, 0, Buffer.from("bad"));
    assert.throws(() => transfers.commit(reg, invalid.id), /SHA-256 mismatch/);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("SDK imports a domain larger than a frame and exports history produced after migration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-import-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  const credential = await createClientCredential(directory, reg);
  store.register(credential);
  const identity = await ensureIdentity(directory);
  const service = new AgentService(store, directory, async () => ({ text: "A new response", files: { "/new.txt": { content: ["new"], created_at: "now", modified_at: "now" } } }));
  const server = new LocalServer(service, directory);
  const client = new AgentClient({ address: ipcPath(directory), certificate: identity.cert, credential });
  await server.listen();
  try {
    await client.connect();
    const domain = { messages: [{ role: "user", content: "Old message" }], files: { "/large.txt": { content: ["á".repeat(4 * 1024 * 1024 + 20)], created_at: "before", modified_at: "before" } }, incompatible: { retained: true } };
    const session = await client.importSession("large-domain", domain);
    const second = await client.importSession("large-domain", domain);
    assert.equal(session.id, second.id);
    const { productState, ...initialDomain } = await client.exportSession(session.id) as Record<string, unknown>;
    assert.deepEqual(productState, { schema: 1, product: reg.product, profile: reg.profile, workspace: "", goals: [], memory: [], modelConfiguration: null, operations: [] });
    assert.deepEqual(initialDomain, { ...domain,
      messages: [{ ...domain.messages[0], id: "legacy-0" }], runs: [], checkpoint: "domain-only", requires_explicit_continuation: true });
    const events = await client.call<unknown[]>("events.read", { sessionId: session.id });
    assert.ok(Buffer.byteLength(JSON.stringify(events)) < 128 * 1024);
    assert.equal(store.domain(reg, session.id) !== undefined, true);
    const spec = runSpec.parse({ runtime: "standard", mode: "plan", provider: {
      kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } },
      messages: [{ role: "user", content: "After migration" }], systemPrompt: "Fixture", tools: [] });
    const run = await client.startRun(session.id, "after-migration", spec);
    await client.waitForRun(run.id, session.id, () => {});
    await client.call("memory.put", { key: "decision", content: "Keep a local-only engine", requestId: "memory", revision: 0 });
    await client.call("models.configure", { revision: 0, roles: { executor: "fixture" } });
    await client.call("goals.create", { key: "goal", sessionId: session.id, runtime: "standard", mode: "plan", objective: "Preserve this goal in rollback" });
    const exported = await client.exportSession(session.id) as { messages: { content: string }[]; files: Record<string, unknown>; incompatible: unknown;
      productState: { goals: { objective: string }[]; memory: { content: string }[]; modelConfiguration: { roles: { executor: string } } } };
    assert.deepEqual(exported.messages.map((item) => item.content), ["Old message", "After migration", "A new response"]);
    assert.deepEqual(exported.incompatible, domain.incompatible);
    assert.ok(exported.files["/new.txt"]);
    assert.equal(exported.productState.goals[0]?.objective, "Preserve this goal in rollback");
    assert.equal(exported.productState.memory[0]?.content, "Keep a local-only engine");
    assert.equal(exported.productState.modelConfiguration.roles.executor, "fixture");
    const fork = await client.call<Session>("sessions.fork", { id: session.id, key: "branch", throughRunId: run.id });
    assert.notEqual(fork.id, session.id);
    assert.equal(store.runs(reg, fork.id).length, 0);
    assert.deepEqual((store.domain(reg, fork.id) as { messages: unknown }).messages, exported.messages);
  } finally { client.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test("image attachments are namespace-bound, typed and never interpreted as external URLs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-images-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  const transfers = new Transfers(store);
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const image = transfers.begin(reg, { key: "image", size: png.length, sha256: createHash("sha256").update(png).digest("hex"), mime: "image/png" });
    transfers.append(reg, image.id, 0, png);
    assert.throws(() => transfers.image(reg, image.id), /verified PNG/);
    transfers.commit(reg, image.id);
    assert.equal(transfers.image(reg, image.id).data, png.toString("base64"));
    assert.throws(() => transfers.image({ ...reg, profile: "other" }, image.id), /not found/);
    const invalid = transfers.begin(reg, { key: "forged", size: 3, sha256: createHash("sha256").update("bad").digest("hex"), mime: "image/png" });
    transfers.append(reg, invalid.id, 0, Buffer.from("bad"));
    transfers.commit(reg, invalid.id);
    assert.throws(() => transfers.image(reg, invalid.id), /declared media type/);
    assert.deepEqual(message.parse({ role: "user", content: [{ type: "text", text: "Look" }, { type: "image", attachmentId: image.id }] }).role, "user");
    assert.throws(() => message.parse({ role: "user", content: [{ type: "image", url: "https://example.com/image.png" }] }));
    assert.throws(() => message.parse({ role: "system", content: [{ type: "image", attachmentId: image.id }] }));
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
