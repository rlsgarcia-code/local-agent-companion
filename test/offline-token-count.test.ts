import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { countTokensOffline } from "../packages/agent-core/src/offline-token-count";
import { ProviderModels } from "../packages/agent-core/src/provider-models";
import { OllamaModels } from "../packages/agent-core/src/ollama-models";
import { assistModel } from "../packages/agent-core/src/model-assistance";

class DesktopModels extends OllamaModels {
  model(alias: string) { return this.createModel(alias, true); }
}

test("known, opaque and multimodal content count locally in both service model factories", async () => {
  const original = globalThis.fetch;
  let external = 0;
  globalThis.fetch = async () => { external++; throw Object.assign(new Error("AbortError: external fetch forbidden"), { name: "AbortError" }); };
  const models = new ProviderModels({ kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "gpt-4o" }, authHeader: "authorization" }, undefined, AbortSignal.timeout(5000));
  try {
    assert.equal(countTokensOffline("", "opaque-company-model"), 0);
    assert.ok(countTokensOffline("ação 漢字 😀 <|endoftext|>", "opaque-company-model") > 0);
    assert.ok(await models.model().getNumTokens("Hello world") > 0);
    assert.ok(await new DesktopModels().model("gpt-4o").getNumTokens("Hello world") > 0);
    assert.ok(await models.model().getNumTokens([{ type: "text", text: "Only visible text" }, { type: "image_url", image_url: "data:image/png;base64,fixture" }]) > 0);
    assert.equal(external, 0);
  } finally { globalThis.fetch = original; await models.close(); }
});

test("the real streamed connection probe completes after provider output without a tokenizer CDN", async () => {
  let requests = 0, external = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests++;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "offline", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }] })}\n\n`);
      // Deliberately no usage: LangChain invokes its post-stream token estimator.
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const original = globalThis.fetch;
  globalThis.fetch = async () => { external++; throw Object.assign(new Error("AbortError: external fetch forbidden"), { name: "AbortError" }); };
  try {
    const result = await assistModel({ purpose: "connection", provider: {
      kind: "ollama", endpoint: `http://127.0.0.1:${address.port}/v1`, roles: { executor: "gpt-4o" }, authHeader: "authorization",
    } }, undefined, AbortSignal.timeout(5000));
    assert.match(result.text, /accepted streaming/);
    assert.equal(requests, 1);
    assert.equal(external, 0);
  } finally {
    globalThis.fetch = original;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
