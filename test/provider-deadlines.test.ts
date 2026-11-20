import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Agent } from "undici";
import { ProviderModels } from "../packages/agent-core/src/provider-models";

test("model calls own matching transports, retain shorter deadlines/cancellation and close their pools", async t => {
  const agents = new Set<Agent>(), closed = new Set<Agent>();
  const dispatch = Agent.prototype.dispatch, close = Agent.prototype.close;
  t.mock.method(Agent.prototype, "dispatch", function (this: Agent, ...args: Parameters<typeof dispatch>) {
    agents.add(this);return dispatch.apply(this, args);
  });
  t.mock.method(Agent.prototype, "close", function (this: Agent, ...args: Parameters<typeof close>) {
    closed.add(this);return close.apply(this, args);
  });
  let calls = 0, received!: () => void;
  const disconnected: Promise<void>[] = [];
  let arrival = new Promise<void>(resolve => { received = resolve; });
  const server = createServer((request, response) => {
    calls++;assert.equal(request.method, "POST");assert.equal(request.url, "/v1/chat/completions");
    let body = "";request.setEncoding("utf8");request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      const input = JSON.parse(body) as { model: string };
      if (input.model === "wait-for-cancellation") {
        disconnected.push(new Promise<void>(resolve => response.once("close", resolve)));
        received();return;
      }
      received();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "deadline-fixture", object: "chat.completion", created: 1, model: input.model,
        choices: [{ index: 0, message: { role: "assistant", content: "READ_ONLY_OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();assert.ok(address && typeof address === "object");
  const controller = new AbortController();
  const provider = { kind: "ollama" as const, endpoint: `http://127.0.0.1:${address.port}/v1`,
    roles: { executor: "deadline-fixture", evaluator: "wait-for-cancellation" }, authHeader: "authorization" as const };
  const models = new ProviderModels(provider, undefined, controller.signal);
  try {
    const standard = models.model("executor", false);
    assert.equal(standard.timeout, 600_000);
    assert.equal((await standard.invoke("Read-only fixture")).text, "READ_ONLY_OK");
    assert.equal((await models.model("executor", false).invoke("Read-only fixture again")).text, "READ_ONLY_OK");
    assert.equal(agents.size, 1, "one owned pool is reused for the same request deadline");
    // Only a temporary HTTP server is stalled. The SDK must still abort at its
    // shorter deadline and must not repeat the request automatically.
    const before = calls;
    await assert.rejects(models.model("evaluator", false, { timeout: 1_000 }).invoke("Read-only deadline fixture"), /timed out/i);
    assert.equal(calls, before + 1);assert.equal(agents.size, 2);
    arrival = new Promise<void>(resolve => { received = resolve; });
    const pending = models.model("evaluator", false).invoke("Read-only cancellation fixture");
    // The pinned SDK may wrap an external fetch abort as TimeoutError. Prove
    // cancellation by the run signal and peer closure, not that error label.
    const rejected = assert.rejects(pending);
    await arrival;controller.abort();await rejected;
    await disconnected.at(-1);assert.equal(controller.signal.aborted, true);
    assert.equal(calls, before + 2);assert.equal(agents.size, 2);
    for (const timeout of [0, -1, Infinity, NaN]) assert.throws(() => models.model("executor", false, { timeout }), /positive model request timeout/);
  } finally {
    controller.abort();await models.close();
    server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));
  }
  assert.deepEqual(closed, agents, "every used transport is closed, including the short diagnostic pool");
});
