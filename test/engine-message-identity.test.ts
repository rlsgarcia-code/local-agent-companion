import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { z } from "zod";
import { tool } from "langchain";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { BaseMessage } from "@langchain/core/messages";
import { ProviderModels } from "../packages/agent-core/src/provider-models";
import { executePreparedGraph } from "../packages/agent-core/src/graph-executor";
import { extractFinalAssistantText } from "../packages/agent-core/src/assistant-final";
import { operationMiddleware } from "../packages/agent-core/src/operations";

type Reply = { content: string; tool_calls?: { index: number; id: string; type: string; function: { name: string; arguments: string } }[] };
const call = (name: string, id: string, args: unknown): Reply => ({ content: "", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
async function fixture(replies: Reply[]) {
  let calls = 0;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");assert.equal(request.url, "/v1/chat/completions");
      let body = "";for await (const chunk of request) body += chunk;const input = JSON.parse(body);assert.equal(input.stream, true);
      const reply = replies[calls++];assert.ok(reply, "No unplanned model call or retry");
      response.writeHead(200, { "content-type": "text/event-stream" });
      const choices = [{ index: 0, delta: { role: "assistant", ...reply }, finish_reason: null }];
      response.write(`data: ${JSON.stringify({ id: "fixture-provider-reuses-response-id", object: "chat.completion.chunk", model: "identity-fixture", choices })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: "fixture-provider-reuses-response-id", object: "chat.completion.chunk", model: "identity-fixture", choices: [{ index: 0, delta: {}, finish_reason: reply.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) { response.destroy(error as Error); }
  });
  server.listen(0, "127.0.0.1");await once(server, "listening");const address = server.address();assert.ok(address && typeof address === "object");
  const signal = AbortSignal.timeout(20_000),models = new ProviderModels({ kind: "ollama", endpoint: `http://127.0.0.1:${address.port}/v1`, roles: { executor: "identity-fixture" }, authHeader: "authorization" }, undefined, signal);
  const saver = SqliteSaver.fromConnString(":memory:");
  return { signal, models, saver, calls: () => calls, async close() { saver.db.close();await models.close();server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); } };
}

for (const runtime of ["standard", "deep"] as const) test(`${runtime} keeps colliding response IDs as distinct turns on the real streaming SDK wire and checkpoint replay`, async () => {
  const f = await fixture([call("write_fixture", "first-call", { value: "first" }), call("write_fixture", "second-call", { value: "second" }), { content: "IDENTITY_FINAL_OK" }]);
  const effects: string[] = [],receipts = new Map<string, unknown>();
  const prepared = { runtime, threadId: "identity", signal: f.signal, recursionLimit: 30,
    initial: { messages: [{ role: "user", content: "Perform the two isolated fixture operations, then answer" }] },
    graph: { model: f.models.model(), tools: [tool(async ({ value }) => { effects.push(value);return "Recorded"; }, { name: "write_fixture", description: "Isolated test operation", schema: z.object({ value: z.string() }) })], systemPrompt: "Fixture only", checkpointer: f.saver,
      middleware: [operationMiddleware(async (id, _tool, _args, perform) => { if (receipts.has(id)) return receipts.get(id);const result = await perform();receipts.set(id, result);return result; })] },
    delta: async () => {},turn: async () => {} };
  try {
    const state = await executePreparedGraph(prepared) as { messages: BaseMessage[] };
    assert.equal(extractFinalAssistantText(state), "IDENTITY_FINAL_OK");assert.deepEqual(effects, ["first", "second"]);assert.equal(receipts.size, 2);assert.equal(f.calls(), 3);
    assert.deepEqual(state.messages.map(message => message.getType()), ["human", "ai", "tool", "ai", "tool", "ai"]);
    const assistants = state.messages.filter(message => message.getType() === "ai");assert.equal(new Set(assistants.map(message => message.id)).size, 3);
    assert.equal(assistants[0]!.id, "fixture-provider-reuses-response-id");
    for (const message of assistants) assert.deepEqual((message as unknown as { usage_metadata: unknown }).usage_metadata, { input_tokens: 10, output_tokens: 2, total_tokens: 12 });
    const ids = state.messages.map(message => message.id),replayed = await executePreparedGraph({ ...prepared, requireCheckpoint: true }) as { messages: BaseMessage[] };
    assert.equal(extractFinalAssistantText(replayed), "IDENTITY_FINAL_OK");assert.deepEqual(replayed.messages.map(message => message.id), ids);assert.equal(f.calls(), 3);assert.deepEqual(effects, ["first", "second"]);
  } finally { await f.close(); }
});

for (const name of ["general-purpose", "fixture-reader"]) test(`Deep delegated ${name} preserves child and parent final turns despite provider ID collisions`, async () => {
  const f = await fixture([call("task", "delegate", { subagent_type: name, description: "Run the isolated read fixture, then answer CHILD_OK" }), call("read_fixture", "child-read", {}), { content: "CHILD_OK" }, { content: "PARENT_OK" }]);
  let reads = 0;
  const read = tool(async () => { reads++;return "Read fixture"; }, { name: "read_fixture", description: "Read isolated fixture", schema: z.object({}) });
  try {
    const state = await executePreparedGraph({ runtime: "deep", threadId: "delegated-identity", signal: f.signal, recursionLimit: 30,
      graph: { model: f.models.model(), tools: [read], systemPrompt: "Fixture only", checkpointer: f.saver,
        ...(name === "general-purpose" ? {} : { subagents: [{ name, description: "Fixture reader", systemPrompt: "Read fixture only", model: f.models.model(), tools: [read] }] }) },
      initial: { messages: [{ role: "user", content: "Delegate the fixture read once" }] },delta: async () => {},turn: async () => {} }) as { messages: BaseMessage[] };
    assert.equal(extractFinalAssistantText(state), "PARENT_OK");assert.equal(reads, 1);assert.equal(f.calls(), 4);
    const result = state.messages.find(message => message.getType() === "tool");assert.ok(result);assert.match(String(result.content), /CHILD_OK/);
    assert.deepEqual(state.messages.map(message => message.getType()), ["human", "ai", "tool", "ai"]);
  } finally { await f.close(); }
});
