import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { FakeToolCallingModel, tool } from "langchain";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";
import { executePreparedGraph } from "../packages/agent-core/src/graph-executor";
import { operationMiddleware } from "../packages/agent-core/src/operations";
import { AgentError, errors } from "../packages/contracts/src/index";
import { checkpointInput } from "../packages/agent-core/src/recovery";

test("a lost checkpoint with recorded effects cannot restart a graph from its original request", async () => {
  const saver = SqliteSaver.fromConnString(":memory:");
  let graphReads = 0;
  try {
    await assert.rejects(checkpointInput({ getState: async () => { graphReads++; } }, saver, "lost",
      { messages: [{ role: "user", content: "Write the fixture" }] }, {}, true), /Automatic repetition is prohibited/);
    assert.equal(graphReads, 0);
  } finally { saver.db.close(); }
});

for (const runtime of ["standard", "deep"] as const) test(`${runtime} product middleware keeps repeated provider IDs distinct and replays completed receipts`, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-operation-"));
  const saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite"));
  let effects = 0;
  const receipts = new Map<string, unknown>();
  const ids: string[] = [];
  const model = new FakeToolCallingModel({ toolCalls: [
    [{ name: "write_fixture", args: { value: "one" }, id: "provider-reused" }],
    [{ name: "write_fixture", args: { value: "two" }, id: "provider-reused" }], [],
  ] });
  const tools = [tool(async ({ value }) => { effects++; await writeFile(path.join(directory, "effect.txt"), value); return "Written"; }, {
    name: "write_fixture", description: "Write an isolated fixture", schema: z.object({ value: z.string() }),
  })];
  const prepared = {
    runtime, threadId: "operation-thread", signal: new AbortController().signal, recursionLimit: 30,
    initial: { messages: [{ role: "user", content: "Run the two test fixture writes" }] },
    graph: { model, tools, systemPrompt: "Test", checkpointer: saver,
      middleware: [operationMiddleware(async (id, _tool, _args, perform) => {
        ids.push(id);
        if (receipts.has(id)) return receipts.get(id);
        const result = await perform(); receipts.set(id, result); return result;
      })] },
    delta: async () => {}, turn: async () => {},
  };
  try {
    await executePreparedGraph(prepared);
    assert.equal(effects, 2);
    assert.equal(new Set(ids).size, 2);
    assert.equal(await readFile(path.join(directory, "effect.txt"), "utf8"), "two");
    await executePreparedGraph(prepared);
    assert.equal(effects, 2);
  } finally { saver.db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a product backend interrupted after its effect resumes from its receipt", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-product-reconcile-"));
  const saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite"));
  let effects = 0, operationId = "";
  let receipt: unknown;
  const prepared = {
    runtime: "standard" as const, threadId: "interrupted-product", signal: new AbortController().signal, recursionLimit: 30,
    initial: { messages: [{ role: "user", content: "Test fixture" }] },
    graph: { model: new FakeToolCallingModel({ toolCalls: [[{ name: "effect", args: {}, id: "call" }], []] }),
      tools: [tool(async () => { effects++; await writeFile(path.join(directory, "effect.txt"), "one"); return "Written"; }, { name: "effect", description: "Isolated effect", schema: z.object({}) })],
      systemPrompt: "Test", checkpointer: saver,
      middleware: [operationMiddleware(async (id, _tool, _args, perform) => {
        if (receipt !== undefined) { assert.equal(id, operationId); return receipt; }
        operationId = id; receipt = await perform();
        throw new AgentError(errors.reconciliation, "Simulated loss after an effect");
      })] },
    delta: async () => {}, turn: async () => {},
  };
  try {
    await assert.rejects(executePreparedGraph(prepared), /interrupted/);
    assert.equal(effects, 1);
    await executePreparedGraph({ ...prepared, reconciliations: { [operationId]: receipt } });
    assert.equal(effects, 1);
    assert.equal(await readFile(path.join(directory, "effect.txt"), "utf8"), "one");
  } finally { saver.db.close(); await rm(directory, { recursive: true, force: true }); }
});
