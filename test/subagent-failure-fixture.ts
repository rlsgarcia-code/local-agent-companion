// Disposable child-process qualification. No endpoint, real provider, product
// installation, authority data or human records. Baseline selection is explicit.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatOpenAICompletions } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { runSpec, AgentError, errors, type Registration } from "../packages/contracts/src/index";
import type { executeGraph as Executor } from "../packages/agent-core/src/index";

const mode = process.argv[2]; assert.ok(["stream-failure", "denied-admission"].includes(mode!));
const baseline = process.argv[3] === "baseline";
const { executeGraph } = require(baseline
  ? path.resolve(".cache/provider-failure-tests-a1/packages/agent-core/src/index.js")
  : "../packages/agent-core/src/index") as { executeGraph: typeof Executor };
async function main() {
const directory = await mkdtemp(path.join(tmpdir(), "subagent-failure-"));
const saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite"));
const state = { rootRequests: 0, childRequests: 0, admissions: 0, finishes: 0, outcome: "unknown" };
const root = new ChatOpenAICompletions({ model: "root", apiKey: "synthetic", streaming: false, disableStreaming: true, maxRetries: 0,
  configuration: { baseURL: "http://127.0.0.1:11434/v1", fetch: async () => {
    state.rootRequests++;
    return new Response(JSON.stringify({ id: `root-${state.rootRequests}`, object: "chat.completion", created: 1, model: "root",
      choices: [{ index: 0, message: state.rootRequests === 1 ? { role: "assistant", content: "", tool_calls: [{ id: "bounded-task", type: "function",
        function: { name: "task", arguments: JSON.stringify({ subagent_type: "fixture-reviewer", description: "Read-only synthetic review" }) } }] }
        : { role: "assistant", content: "ROOT_OBSERVED_FAILURE" }, finish_reason: state.rootRequests === 1 ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "content-type": "application/json" } });
  } } });
const child = new ChatOpenAICompletions({ model: "child", apiKey: "synthetic", streaming: true, maxRetries: 0,
  configuration: { baseURL: "http://127.0.0.1:11434/v1", fetch: async () => {
    state.childRequests++;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: "child-1", object: "chat.completion.chunk", created: 1, model: "child",
        choices: [{ index: 0, delta: { role: "assistant", content: "CHILD_PRIVATE_TEST_TEXT" }, finish_reason: null }] })}\n\n`));
      setTimeout(() => controller.error(new TypeError("terminated", { cause: Object.assign(new Error("Synthetic disconnect"), { code: "UND_ERR_SOCKET" }) })), 10);
    } });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  } } });
try {
  const reg: Registration = { id: "fixture", product: "companion-vscode", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
  const spec = runSpec.parse({ runtime: "deep", mode: "plan", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "root" } },
    messages: [{ role: "user", content: "Delegate one read-only synthetic review" }], systemPrompt: "Only a synthetic fixture; no effects", tools: [] });
  try {
    await executeGraph(spec, { registration: reg, threadId: "root", checkpointer: saver, signal: AbortSignal.timeout(10_000), model: root,
      subagents: [{ name: "fixture-reviewer", description: "Read-only fixture", systemPrompt: "Synthetic review only", model: child, tools: [] }],
      inferenceBudget: { begin: async () => { state.admissions++; if (mode === "denied-admission" && state.admissions > 1) throw new AgentError(errors.forbidden, "Synthetic budget denied before inference"); }, finish: () => { state.finishes++; } },
      emit: () => {}, invokeTool: async () => assert.fail("No host effect allowed") });
    state.outcome = "root-handled";
  } catch { state.outcome = "root-failed"; }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(state.rootRequests >= 1); assert.equal(state.childRequests, mode === "denied-admission" ? 0 : 1);
  console.log(JSON.stringify({ marker: "SUBAGENT_OUTCOMES_SETTLED", mode, baseline, ...state }));
} finally { saver.db.close(); await rm(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
