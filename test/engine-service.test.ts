import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { FakeToolCallingModel } from "langchain";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { executeGraph } from "../packages/agent-core/src/index";
import { AgentClient } from "../packages/client-ts/src/index";
import { verifyBundle } from "../packages/client-ts/src/bootstrap";
import {
  createClientCredential,
  ensureIdentity,
  ipcPath,
} from "../packages/agent-service/src/security";
import { AgentService } from "../packages/agent-service/src/service";
import { LocalServer } from "../packages/agent-service/src/server";
import { Store } from "../packages/agent-service/src/store";
import {
  ENGINE_VERSION,
  AgentError,
  errors,
  runSpec,
  type Registration,
  type Run,
} from "../packages/contracts/src/index";

const registration: Registration = {
  id: "test-mac",
  product: "companion-mac",
  profile: "default",
  workspace: "",
  providers: ["ollama"],
  hostTools: [],
};
const spec = runSpec.parse({
  runtime: "standard",
  mode: "plan",
  provider: {
    kind: "ollama",
    endpoint: "http://127.0.0.1:11434/v1",
    roles: { executor: "test" },
  },
  messages: [{ role: "user", content: "Read-only test" }],
  systemPrompt: "Respond briefly",
  tools: [],
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "companion-engine-"));
  const store = new Store(path.join(dir, "metadata.sqlite"));
  return {
    dir,
    store,
    async close() {
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("release verification rejects tampering, undeclared files and unsigned production bundles", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "companion-signature-"));
  try {
    const node = process.platform === "win32" ? "node.exe" : "node";
    const files: Record<string, string> = {};
    for (const name of [node, "service.cjs", "bootstrap-lock.cjs"]) {
      await writeFile(path.join(directory, name), "fixture");
      files[name] = createHash("sha256").update("fixture").digest("hex");
    }
    const manifest = Buffer.from(
      JSON.stringify({
        node: "22.23.4",
        version: ENGINE_VERSION,
        protocol: "1.0",
        target: `${process.platform}-${process.arch}`,
        files,
      }),
    );
    await writeFile(path.join(directory, "manifest.json"), manifest);
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    await assert.rejects(verifyBundle(directory), /signing key/);
    await writeFile(
      path.join(directory, "manifest.sig"),
      sign(null, manifest, keys.privateKey),
    );
    await verifyBundle(directory, publicKey);
    await assert.rejects(verifyBundle(directory, publicKey, false, "wrong-architecture"), /platform does not match/);
    await writeFile(path.join(directory, "unlisted.cjs"), "unexpected");
    await assert.rejects(verifyBundle(directory, publicKey), /undeclared/);
    await rm(path.join(directory, "unlisted.cjs"));
    await writeFile(path.join(directory, node), "altered");
    await assert.rejects(verifyBundle(directory, publicKey), /integrity/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a lost tool acknowledgement is interrupted and reconciled without repeating the effect", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "companion-reconcile-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  const writeTool = {
    name: "write_fixture", description: "Write an isolated test fixture",
    schema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    effect: "write" as const,
  };
  const reg: Registration = { ...registration, hostTools: ["write_fixture"], toolCatalog: [writeTool] };
  const credential = await createClientCredential(directory, reg);
  store.register(credential);
  const identity = await ensureIdentity(directory);
  const model = new FakeToolCallingModel({
    toolCalls: [
      [{ name: "write_fixture", args: { value: "one" }, id: "effect-1" }],
      [],
    ],
  });
  const service = new AgentService(store, directory, (run, context) =>
    executeGraph(run, { ...context, model }),
  );
  const server = new LocalServer(service, directory);
  await server.listen();
  const options = {
    address: ipcPath(directory),
    certificate: identity.cert,
    credential,
  };
  let client = new AgentClient(options),
    effects = 0;
  try {
    await client.connect();
    const session = await client.call<{ id: string }>("sessions.create", {
      title: "Unknown effect",
    });
    const run = await client.call<Run>("runs.start", {
      sessionId: session.id,
      key: "tool-effect",
      spec: {
        ...spec,
        mode: "execute",
        tools: [writeTool],
      },
    });
    let offered: { id: string; payload: unknown }[] = [];
    for (let i = 0; i < 50 && !offered.length; i++) {
      offered = await client.call("host.poll");
      if (!offered.length)
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(offered.length, 1);
    effects++;
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    client = new AgentClient(options);
    await client.connect();
    assert.equal(
      (await client.call<Run>("runs.get", { id: run.id })).state,
      "awaiting_reconciliation",
    );
    assert.deepEqual(await client.call("host.poll"), []);
    await assert.rejects(
      client.call("runs.resume", { id: run.id }),
      /Reconcile/,
    );
    await client.call("tools.reconcile", {
      runId: run.id,
      callId: (offered[0]!.payload as { callId: string }).callId,
      result: { written: true },
    });
    await client.call("runs.resume", { id: run.id });
    const final = await client.waitForRun(
      run.id,
      session.id,
      () => {},
      async () => {
        effects++;
        return { written: true };
      },
    );
    assert.equal(final.state, "completed");
    assert.equal(effects, 1);
    assert.equal(
      store
        .events(reg, session.id)
        .filter((event) => event.type === "host.requested").length,
      1,
    );
  } finally {
    client.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("namespaces, idempotency, imports and cross-product workspace leases are enforced by storage", async () => {
  const f = await fixture();
  try {
    const mac = { ...registration, workspace: "/tmp/project" },
      vscode: Registration = {
        ...mac,
        id: "test-vscode",
        product: "companion-vscode",
      };
    const session = f.store.createSession(mac, "Mac");
    assert.throws(() => f.store.session(vscode, session.id), /not found/);
    const a = f.store.start(mac, session.id, "request-1", spec);
    assert.equal(
      f.store.start(mac, session.id, "request-1", spec).run.id,
      a.run.id,
    );
    assert.throws(
      () =>
        f.store.start(mac, session.id, "request-1", {
          ...spec,
          mode: "execute",
        }),
      /different request/,
    );
    const other = f.store.createSession(vscode, "VSCode");
    assert.throws(
      () => f.store.start(vscode, other.id, "other", spec),
      /Workspace/,
    );
    f.store.updateRun(mac, a.run.id, "completed");
    assert.ok(f.store.start(vscode, other.id, "other", spec).created);
    const imported = f.store.importDomain(mac, "legacy:1", {
      messages: [{ role: "assistant", content: "old" }],
      files: { "/game.js": "preserved" },
    });
    assert.equal(
      f.store.importDomain(mac, "legacy:1", {
        messages: [{ role: "assistant", content: "old" }],
        files: { "/game.js": "preserved" },
      }).id,
      imported.id,
    );
    assert.throws(
      () => f.store.importDomain(mac, "legacy:1", { changed: true }),
      /source changed/,
    );
  } finally {
    await f.close();
  }
});

test("revocation survives registration refresh; recovery never repeats an unknown tool effect", async () => {
  const f = await fixture();
  try {
    const credential = await createClientCredential(f.dir, registration);
    assert.throws(()=>f.store.register({...credential,registration:{...registration,providers:["openai"]}}),/only Ollama/);
    assert.throws(()=>f.store.register({...credential,registration:{...registration,product:"kidos",providers:["kidos-gateway"],hostTools:["shell"]}}),/Core adapter/);
    f.store.register(credential);
    assert.equal(
      f.store.authenticate(registration.id, credential.token).product,
      "companion-mac",
    );
    f.store.revoke(registration.id);
    f.store.register({ ...credential, token: "rotated-after-revocation" });
    assert.throws(() => f.store.authenticate(registration.id, "rotated-after-revocation"), /revoked/);
    f.store.register(credential);
    assert.throws(
      () => f.store.authenticate(registration.id, credential.token),
      /revoked/,
    );
    const session = f.store.createSession(registration, "Test"),
      { run } = f.store.start(registration, session.id, "request", spec);
    f.store.saveReceipt(registration, run.id, `${run.id}:call-1`, "started", {
      tool: "write",
    });
    f.store.recover();
    assert.equal(
      f.store.run(registration, run.id).state,
      "awaiting_reconciliation",
    );
    assert.equal(
      f.store.events(registration, session.id).at(-1)?.type,
      "run.state",
    );
  } finally {
    await f.close();
  }
});

for (const runtime of ["standard", "deep"] as const)
  test(`official ${runtime} graph runs headless and resumes its SQLite checkpoint`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "companion-graph-")),
      saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite"));
    try {
      const events: string[] = [];
      let tools = 0;
      const context = {
        registration,
        threadId: "durable",
        checkpointer: saver,
        signal: new AbortController().signal,
        model: new FakeToolCallingModel(),
        emit: (type: string) => events.push(type),
        invokeTool: async () => {
          tools++;
          return "read";
        },
      };
      const result = await executeGraph({ ...spec, runtime }, context);
      assert.ok(result.text);
      assert.ok(events.includes("text.final"));
      assert.ok(
        await saver.getTuple({ configurable: { thread_id: "durable" } }),
      );
      const recovered = await executeGraph({ ...spec, runtime }, context);
      assert.equal(recovered.text, result.text);
      assert.equal(tools, 0);
    } finally {
      saver.db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

test("TLS IPC rejects unregistered clients; closing a client preserves an active run and cursor replay", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "companion-ipc-")),
    store = new Store(path.join(directory, "metadata.sqlite"));
  const credential = await createClientCredential(directory, registration);
  store.register(credential);
  const identity = await ensureIdentity(directory);
  let finish!: (value: unknown) => void;
  const service = new AgentService(store, directory, async (_spec, context) => {
    context.emit("text.delta", { text: "before disconnect" });
    return await new Promise((resolve) => {
      finish = resolve;
    });
  });
  const server = new LocalServer(service, directory);
  await server.listen();
  const options = {
    address: ipcPath(directory),
    certificate: identity.cert,
    credential,
  };
  let client = new AgentClient(options);
  try {
    const invalid = new AgentClient({
      ...options,
      credential: { ...credential, token: "unpaired" },
    });
    await assert.rejects(invalid.connect(), /registered/);
    invalid.close();
    await client.connect();
    const session = await client.call<{ id: string }>("sessions.create", {
      title: "Retained",
    });
    const run = await client.call<Run>("runs.start", {
      sessionId: session.id,
      key: "disconnect",
      spec,
    });
    client.close();
    finish({ text: "completed without a window" });
    client = new AgentClient(options);
    await client.connect();
    const result = await client.waitForRun(run.id, session.id, () => {});
    assert.equal(result.state, "completed");
    const first = await client.call<{ sequence: number }[]>("events.read", {
      sessionId: session.id,
      cursor: 0,
    });
    const cursor = first.at(-1)!.sequence;
    assert.deepEqual(
      await client.call("events.read", { sessionId: session.id, cursor }),
      [],
    );
    assert.equal(new Set(first.map((e) => e.sequence)).size, first.length);
    await assert.rejects(
      client.call("sessions.list", { namespace: "other" }),
      /Invalid/,
    );
    store.revoke(registration.id);
    await assert.rejects(client.call("engine.info"), /revoked/);
  } finally {
    client.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing host credential explicitly blocks a run and never writes a credential to disk", async () => {
  const f = await fixture();
  const service = new AgentService(f.store, f.dir, async (_spec, context) => {
    context.emit("diagnostic", { value: context.credential });
    return { text: "ok" };
  });
  try {
    const reg: Registration = {
      ...registration,
      id: "vscode",
      product: "companion-vscode",
      providers: ["litellm"],
    };
    const session = f.store.createSession(reg, "Credentials");
    const run = (await service.dispatch(
      reg,
      "runs.start",
      {
        sessionId: session.id,
        key: "credential-test",
        spec: {
          ...spec,
          provider: {
            kind: "litellm",
            endpoint: "https://gateway.example/v1",
            roles: { executor: "test" },
            credentialRef: "provider",
          },
        },
      },
      "connection",
    )) as Run;
    assert.equal(run.state, "awaiting_credentials");
    await service.dispatch(
      reg,
      "credentials.lease",
      { reference: "provider", value: "secret-fixture-unique" },
      "connection",
    );
    await service.dispatch(reg, "runs.resume", { id: run.id }, "connection");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const events = f.store.events(reg, session.id);
    assert.ok(!JSON.stringify(events).includes("secret-fixture-unique"));
    assert.ok(
      !(await readFile(path.join(f.dir, "metadata.sqlite"))).includes(
        Buffer.from("secret-fixture-unique"),
      ),
    );
    const second = (await service.dispatch(
      reg,
      "runs.start",
      {
        sessionId: session.id,
        key: "credential-test-second",
        spec: {
          ...spec,
          provider: {
            kind: "litellm",
            endpoint: "https://gateway.example/v1",
            roles: { executor: "test" },
            credentialRef: "provider",
          },
        },
      },
      "connection",
    )) as Run;
    assert.equal(second.state, "awaiting_credentials");
  } finally {
    service.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("the official SQLite serializer removes leased credentials from graph checkpoints as well as public events", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-checkpoint-secret-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  const reg: Registration = { ...registration, id: "vscode-checkpoint", product: "companion-vscode", providers: ["litellm"] };
  const secret = "checkpoint-secret-fixture-only";
  const { emptyCheckpoint } = await import("@langchain/langgraph-checkpoint");
  const service = new AgentService(store, directory, async (_spec, context) => {
    const config = { configurable: { thread_id: context.threadId } };
    const checkpoint = { ...emptyCheckpoint(), channel_values: { public: "kept", privateEcho: context.credential } };
    await context.checkpointer.put(config, checkpoint, { source: "input", step: 0, parents: {} }, {});
    const restored = await context.checkpointer.getTuple(config);
    assert.equal(restored?.checkpoint.channel_values.privateEcho, "[credential redacted]");
    assert.equal(restored?.checkpoint.channel_values.public, "kept");
    return { text: context.credential };
  });
  try {
    const session = store.createSession(reg, "Secret checkpoint");
    await service.dispatch(reg, "credentials.lease", { reference: "provider", value: secret }, "host");
    const run = await service.dispatch(reg, "runs.start", { sessionId: session.id, key: "checkpoint-secret", spec: {
      ...spec, provider: { kind: "litellm", endpoint: "https://gateway.example/v1", roles: { executor: "fixture" }, credentialRef: "provider" },
    } }, "host") as Run;
    for (let i = 0; i < 100 && store.run(reg, run.id).state === "running"; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(store.run(reg, run.id).state, "completed");
    assert.ok(!JSON.stringify(store.run(reg, run.id)).includes(secret));
    const { readdir } = await import("node:fs/promises");
    for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      assert.ok(!(await readFile(file)).includes(Buffer.from(secret)), "Secret reached a persisted engine file");
    }
  } finally { service.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a host callback failure after an effect is not automatically invoked again by the SDK", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-host-failure-"));
  const definition = { name: "write_fixture", description: "Isolated fixture", schema: { type: "object", properties: {}, additionalProperties: false }, effect: "write" as const };
  const reg: Registration = { ...registration, hostTools: [definition.name], toolCatalog: [definition] };
  const store = new Store(path.join(directory, "metadata.sqlite"));
  const credential = await createClientCredential(directory, reg);
  store.register(credential);
  const identity = await ensureIdentity(directory);
  const model = new FakeToolCallingModel({ toolCalls: [[{ name: definition.name, args: {}, id: "write-once" }], []] });
  const service = new AgentService(store, directory, (run, context) => executeGraph(run, { ...context, model }));
  const server = new LocalServer(service, directory);
  const client = new AgentClient({ address: ipcPath(directory), certificate: identity.cert, credential });
  await server.listen();
  let effects = 0;
  const controller = new AbortController();
  try {
    await client.connect();
    const session = await client.call<{ id: string }>("sessions.create", { title: "Failed acknowledgement" });
    const run = await client.startRun(session.id, "failure", { ...spec, mode: "execute", tools: [definition] });
    const observation = client.waitForRun(run.id, session.id, () => {}, async () => {
      effects++;
      await writeFile(path.join(directory, "effect.txt"), "one");
      throw new Error("Simulated failure after writing");
    }, controller.signal);
    const stopped = observation.catch(() => {});
    for (let i = 0; i < 100 && store.run(reg, run.id).state !== "awaiting_reconciliation"; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(store.run(reg, run.id).state, "awaiting_reconciliation");
    controller.abort();
    await stopped;
    assert.equal(effects, 1);
    assert.deepEqual(await client.call("host.poll"), []);
    const receipt = store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started'").get(run.id) as { id: string };
    await client.call("tools.reconcile", { runId: run.id, callId: receipt.id.slice(run.id.length + 1), result: "Written" });
    await client.call("runs.resume", { id: run.id });
    const completed = await client.waitForRun(run.id, session.id, () => {}, async () => { effects++; return "Must not execute"; });
    assert.equal(completed.state, "completed");
    assert.equal(effects, 1);
    assert.equal(await readFile(path.join(directory, "effect.txt"), "utf8"), "one");
  } finally { controller.abort(); client.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
});
