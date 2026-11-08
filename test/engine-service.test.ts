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
    for (const name of [node, "service.cjs"]) {
      await writeFile(path.join(directory, name), "fixture");
      files[name] = createHash("sha256").update("fixture").digest("hex");
    }
    const manifest = Buffer.from(JSON.stringify({ node: "22.23.4", files }));
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
  const reg: Registration = { ...registration, hostTools: ["write_fixture"] };
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
        tools: [
          {
            name: "write_fixture",
            description: "Write an isolated test fixture",
            schema: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
            },
            effect: "write",
          },
        ],
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
      callId: "effect-1",
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
    f.store.register(credential);
    assert.equal(
      f.store.authenticate(registration.id, credential.token).product,
      "companion-mac",
    );
    f.store.revoke(registration.id);
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
  } finally {
    service.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
