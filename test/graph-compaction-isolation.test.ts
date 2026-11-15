import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "langchain";
import { z } from "zod";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { executePreparedGraph } from "../packages/agent-core/src/graph-executor";
import { InferenceBudgetCallback } from "../packages/agent-core/src/inference-budget";

/** Entirely local scripted models; no endpoint, credentials or provider calls.
 * Supervisor lacks a profile, specialist has an actual fixture window. */
class ScriptedModel extends BaseChatModel {
  normalCalls = 0;
  summaryCalls = 0;
  largestNormalInput = 0;
  constructor(readonly role: "supervisor" | "specialist", readonly summaryRuns: Set<string>, readonly window?: number) { super({}); }
  override get profile() { return this.window ? { maxInputTokens: this.window } : {}; }
  _llmType() { return "local-compaction-fixture"; }
  override bindTools() { return this; }
  override async getNumTokens(content: string) { return Math.ceil(content.length / 3); }
  async _generate(messages: BaseMessage[], _options: this["ParsedCallOptions"], manager?: import("@langchain/core/callbacks/manager").CallbackManagerForLLMRun) {
    const summary = manager ? this.summaryRuns.has(manager.runId) : false;
    let content: string, calls: AIMessage["tool_calls"];
    if (summary) { this.summaryCalls++; content = "PRIVATE_SPECIALIST_SUMMARY: prior readings remain in virtual history; continue the indexed observations."; }
    else {
      this.normalCalls++;
      this.largestNormalInput = Math.max(this.largestNormalInput, JSON.stringify(messages.map(m => m.content)).length);
      content = this.role === "supervisor" ? "PUBLIC_SUPERVISOR_FINAL" : "PUBLIC_SPECIALIST_FINAL";
      if (this.role === "supervisor" && this.normalCalls === 1) calls = [{ name: "task", args: { subagent_type: "game-reviewer", description: "Read each of the sixteen numbered sections exactly once, then report. No modifications." }, id: "delegate-review", type: "tool_call" }];
      if (this.role === "specialist" && this.normalCalls <= 16) calls = [{ name: "read_section", args: { index: this.normalCalls }, id: `read-${this.normalCalls}`, type: "tool_call" }];
    }
    const message = new AIMessage({ id: randomUUID(), content, tool_calls: calls,
      usage_metadata: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
    return { generations: [{ text: content, message }], llmOutput: {} };
  }
}

test("Deep specialist computes its own compaction defaults after an unprofiled supervisor; accounting and checkpoint replay stay exact", async (t) => {
  const summaryRuns = new Set<string>();
  const observer = new class extends BaseCallbackHandler {
    name = "fixture_compaction_observer";
    awaitHandlers = true;
    handleChatModelStart(_llm: unknown, _messages: unknown, runId: string, _parent?: string, _extra?: unknown, tags?: string[]) {
      if (tags?.includes("nostream")) summaryRuns.add(runId);
    }
  }();
  const supervisor = new ScriptedModel("supervisor", summaryRuns), specialist = new ScriptedModel("specialist", summaryRuns, 8192);
  const saver = SqliteSaver.fromConnString(":memory:"), readings: number[] = [], publicText: string[] = [];
  const admissions = new Set<string>(), settlements = new Map<string, unknown>();
  const meter = new InferenceBudgetCallback({
    begin: async id => { assert.ok(!admissions.has(id)); admissions.add(id); },
    finish: (id, usage) => { assert.ok(admissions.has(id)); settlements.set(id, usage); },
  });
  const read = tool(async ({ index }) => { readings.push(index); return `Section ${index}: ${"An original finding; preserve the project and receipts. ".repeat(45)}`; },
    { name: "read_section", description: "Read one numbered synthetic design finding, no side effects.", schema: z.object({ index: z.number().int().min(1).max(16) }) });
  const graph = { model: supervisor, tools: [], systemPrompt: "Delegate the bounded review, then finish with a public reply.", checkpointer: saver,
    subagents: [{ name: "game-reviewer", description: "Read the design's sixteen findings and review without changes.", systemPrompt: "Read sixteen sections in order exactly once. Keep the findings, never modify the project.", model: specialist, tools: [read] }] };
  const execution = { runtime: "deep" as const, graph, threadId: "mixed-model-context", signal: new AbortController().signal,
    recursionLimit: 200, callbacks: [meter, observer], initial: { messages: [new HumanMessage("Review the synthetic game design.")] },
    delta: async (text: string) => { publicText.push(text); }, turn: async () => {} };
  try {
    const state = await executePreparedGraph(execution);
    t.diagnostic(JSON.stringify({ supervisorNormalCalls: supervisor.normalCalls, supervisorSummaryCalls: supervisor.summaryCalls,
      specialistNormalCalls: specialist.normalCalls, specialistSummaryCalls: specialist.summaryCalls,
      specialistLargestNormalInputCharacters: specialist.largestNormalInput, readOperations: readings.length,
      admissions: admissions.size, settlements: settlements.size, scope: "local simulated models, no provider usage or physical quality acceptance" }));
    assert.deepEqual(readings, Array.from({ length: 16 }, (_, i) => i + 1), "compaction must not replay any operation");
    assert.ok(specialist.summaryCalls > 0, "specialist inherited the supervisor's 170k fallback instead of using its own 8192-token profile");
    assert.equal(supervisor.summaryCalls, 0, "unprofiled supervisor keeps native fallback behavior");
    assert.equal(specialist.normalCalls, 17); assert.equal(supervisor.normalCalls, 2);
    assert.ok(publicText.join("").includes("PUBLIC_SUPERVISOR_FINAL"));
    assert.ok(!publicText.join("").includes("PRIVATE_SPECIALIST_SUMMARY"));
    const allCalls = specialist.normalCalls + supervisor.normalCalls + specialist.summaryCalls;
    assert.equal(admissions.size, allCalls); assert.equal(settlements.size, allCalls);
    for (const usage of settlements.values()) assert.deepEqual(usage, { input: 100, output: 5 });
    assert.ok(JSON.stringify(state).includes("PUBLIC_SUPERVISOR_FINAL"));
    await executePreparedGraph({ ...execution, requireCheckpoint: true });
    assert.equal(admissions.size, allCalls); assert.equal(readings.length, 16);
  } finally { saver.db.close(); }
});
