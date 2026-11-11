import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { ProviderModels } from "../packages/agent-core/src/provider-models";

test("provider catalog uses the exact configured models route and returns stable aliases", async () => {
  let requestPath = "";
  let authorization = "missing";
  const server = createServer((request, response) => {
    requestPath = request.url || "";
    authorization = String(request.headers.authorization || "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "qwen3:latest" }, { id: "nomic-embed-text:latest" }, { id: "qwen3:latest" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const models = new ProviderModels({
    kind: "ollama",
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    roles: { executor: "qwen3:latest" },
    authHeader: "authorization"
  }, undefined, new AbortController().signal);
  try {
    assert.deepEqual(await models.listModels(), ["nomic-embed-text:latest", "qwen3:latest"]);
    assert.equal(requestPath, "/v1/models");
    assert.equal(authorization, "");
  } finally {
    await models.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
