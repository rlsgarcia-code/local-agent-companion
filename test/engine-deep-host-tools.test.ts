import assert from "node:assert/strict";
import test from "node:test";
import { FakeToolCallingModel, tool } from "langchain";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";
import { executePreparedGraph } from "../packages/agent-core/src/graph-executor";
import { createProductGraph } from "../packages/agent-core/src/graph";
import { gameProductionProfile } from "../packages/agent-core/src/game-production-profile";
import type { ToolRuntime } from "@langchain/core/tools";

for (const delegated of [false, true]) test(`Deep ${delegated ? "game specialist" : "supervisor"} keeps host reads separate from native filesystem tools`, async () => {
  const saver = SqliteSaver.fromConnString(":memory:");
  const calls: { path: string; callId: string | undefined; marker: unknown }[] = [];
  const read = tool(async ({ path }, runtime) => {
    const current = runtime as unknown as ToolRuntime;
    calls.push({ path, callId: current.toolCall?.id, marker: current.config.configurable?.thread_id });
    assert.equal(current.toolCall?.name, "read_file");
    assert.ok(current.signal && !current.signal.aborted);
    return "AUTHORIZED_HOST_READ";
  }, { name: "read_file", description: "Read through the authorized host adapter only", schema: z.object({ path: z.literal("registered.txt") }) });
  // These are fixed model responses. No provider, personal file or child process.
  const child = new FakeToolCallingModel({ toolCalls: [[{ name: "companion_host_read_file", args: { path: "registered.txt" }, id: "host-read" }], []] });
  const parent = delegated ? new FakeToolCallingModel({ toolCalls: [[{ name: "task", args: { subagent_type: "game-design-director", description: "Read the registered fixture using the host adapter" }, id: "delegate" }], []] }) : child;
  const profile = gameProductionProfile({ catalog: [], invoke: async () => { throw Error("No game tool expected"); }, evidence: () => ({ changes: [], projects: [] }) }, {
    mode: "plan", signal: AbortSignal.timeout(20_000), modelForRole: () => child, readTools: [read],
  })!;
  try {
    await executePreparedGraph({ runtime: "deep", threadId: "host-boundary", signal: AbortSignal.timeout(20_000), recursionLimit: 30,
      initial: { messages: [{ role: "user", content: "Read only the registered fixture" }] },
      graph: { model: parent, tools: delegated ? [] : [read], systemPrompt: "Fixture only", checkpointer: saver,
        ...(delegated ? { subagents: profile.specialists } : {}) },
      delta: async () => {}, turn: async () => {},
    });
    assert.deepEqual(calls.map(call => call.path), ["registered.txt"], "the authorized original tool must execute exactly once");
    assert.equal(calls[0]!.callId, "host-read", "the original adapter retains the provider call identity");
    assert.equal(calls[0]!.marker, "host-boundary", "forward the graph configuration, not just parsed arguments");
    assert.equal(read.name, "read_file", "do not mutate a tool shared with another graph or product");
    await executePreparedGraph({ runtime: "deep", threadId: "host-boundary", signal: AbortSignal.timeout(20_000), recursionLimit: 30,
      initial: { messages: [] }, requireCheckpoint: true,
      graph: { model: parent, tools: delegated ? [] : [read], systemPrompt: "Fixture only", checkpointer: saver,
        ...(delegated ? { subagents: profile.specialists } : {}) }, delta: async () => {}, turn: async () => {},
    });
    assert.equal(calls.length, 1, "checkpoint replay must not execute the host read again");
  } finally { saver.db.close(); }
});

test("Deep host aliases refuse a conflicting adapter name before executing anything", () => {
  const saver = SqliteSaver.fromConnString(":memory:");
  let calls = 0;
  const fixture = (name: string) => tool(async () => { calls++; return "unused"; }, { name, description: "Fixture", schema: z.object({}) });
  try {
    assert.throws(() => createProductGraph("deep", { model: new FakeToolCallingModel(),
      tools: [fixture("read_file"), fixture("companion_host_read_file")], systemPrompt: "Fixture", checkpointer: saver,
    }), /Host tool alias conflicts/);
    assert.equal(calls, 0);
  } finally { saver.db.close(); }
});
