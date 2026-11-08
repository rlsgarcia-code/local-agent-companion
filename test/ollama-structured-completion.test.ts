import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { ChatOpenAICompletions } from "@langchain/openai";
import { createAgent, FakeToolCallingModel } from "langchain";
import { consumeAssistantMessageStreams } from "../packages/agent-core/src/assistant-stream";
import { createTaskCompletionMiddleware, completionGateResult } from "../packages/agent-core/src/task-completion";
import type { ChangeTracker } from "../packages/adapter-workspace/src/change-tracker";

test("schema-constrained classification and review stay on Chat Completions and cannot invent completion evidence", async () => {
  const requests: { method?: string; url?: string; body: Record<string, unknown> }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8"); request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requests.push({ method: request.method, url: request.url, body: parsed });
      const name = (parsed.response_format as { json_schema?: { name?: string } })?.json_schema?.name;
      const result = name === "task_contract"
        ? { outcome: "workspace_change", objective: "Implement the requested change", reason: "The user asked for a change", requiredEvidence: "none", acceptanceCriteria: ["The relevant file changes"] }
        : { verdict: "satisfied", reason: "The provider claims that the work is complete" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1, model: "fixture",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(result) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const verifier = new ChatOpenAICompletions({ model: "fixture", apiKey: "read-only-fixture", maxRetries: 0, streaming: false, disableStreaming: true,
      configuration: { baseURL: `http://127.0.0.1:${address.port}/v1` } });
    const middleware = createTaskCompletionMiddleware({ model: verifier, structuredOutput: true, mode: "execute",
      conversation: [{ role: "user", content: "Implement the requested change" }],
      tracker: { finalize: () => ({ changes: [], omitted: 0 }) } as unknown as ChangeTracker,
      signal: AbortSignal.timeout(10_000), onRetry: async () => {} });
    const agent = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [middleware] });
    const run = await agent.streamEvents({ messages: [{ role: "user", content: "Implement the requested change" }] }, { version: "v3" });
    const visible: string[] = [];
    const [state] = await Promise.all([run.values, consumeAssistantMessageStreams(run.messages, async (text) => { visible.push(text); }, async () => {})]);
    assert.equal(completionGateResult(state).completionOutcome, "incomplete");
    assert.ok(requests.length >= 2);
    for (const request of requests) {
      assert.equal(request.method, "POST"); assert.equal(request.url, "/v1/chat/completions");
      assert.equal((request.body.response_format as { type: string }).type, "json_schema");
    }
    assert.doesNotMatch(visible.join(""), /acceptanceCriteria|provider claims|\"outcome\"/);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
