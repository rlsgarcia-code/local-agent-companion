import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { CompositeBackend, createDeepAgent, StateBackend } from "deepagents";
import { createAgent, FakeToolCallingModel } from "langchain";
import { consumeAssistantMessageStreams } from "../src/assistant-stream";
import { completionGateResult, createTaskCompletionMiddleware, parseTaskContract, parseTaskVerdict } from "../src/task-completion";
import type { ChangeTracker } from "../src/change-tracker";
import { ChangeTracker as RealChangeTracker } from "../src/change-tracker";
import { ReviewableFilesystemBackend } from "../src/reviewable-backend";

const contractModel = (outcome: string, verdict = "needs_work"): BaseChatModel => {
  let calls = 0;
  return {
    invoke: async () => ({ text: JSON.stringify(calls++ === 0
      ? { outcome, objective: "Apply the earlier review", reason: "The latest message depends on the review.", acceptanceCriteria: ["The reviewed defect is fixed"] }
      : { verdict, reason: "The observed files do not establish completion." }) })
  } as unknown as BaseChatModel;
};

const tracker = (changes: number): ChangeTracker => ({
  finalize: () => ({ changes: Array.from({ length: changes }, () => ({ path: "src/example.ts", kind: "modified" })), omitted: 0 })
}) as unknown as ChangeTracker;

test("parses a semantic task contract, rejecting malformed model output", () => {
  assert.equal(parseTaskContract('```json\n{"outcome":"workspace_change","objective":"Apply review","reason":"Follow-up","acceptanceCriteria":[]}\n```').outcome, "workspace_change");
  assert.throws(() => parseTaskContract("No JSON"), /task contract/);
  assert.throws(() => parseTaskContract('{"outcome":"unknown","objective":"x","reason":"x","acceptanceCriteria":[]}'));
  assert.equal(parseTaskVerdict('{"verdict":"needs_work","reason":"No diff"}').verdict, "needs_work");
});

test("LangGraph returns to the model for an unfulfilled edit, then marks the run incomplete", async () => {
  const retries: number[] = [];
  const middleware = createTaskCompletionMiddleware({
    model: contractModel("workspace_change"),
    mode: "execute",
    conversation: [
      { role: "user", content: "Review the code" },
      { role: "assistant", content: "The validation needs correction." },
      { role: "user", content: "Apply those criticisms" }
    ],
    tracker: tracker(0),
    signal: new AbortController().signal,
    onRetry: async (attempt) => { retries.push(attempt); }
  });
  const agent = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [middleware] });
  const result = await agent.invoke({ messages: [{ role: "user", content: "Apply those criticisms" }] });
  assert.deepEqual(retries, [1, 2]);
  assert.equal(completionGateResult(result).completionOutcome, "incomplete");
});

test("LangGraph accepts actual changes without retrying and allows read-only answers", async () => {
  for (const [outcome, changes] of [["workspace_change", 1], ["answer", 0]] as const) {
    let retries = 0;
    const middleware = createTaskCompletionMiddleware({
      model: contractModel(outcome, "satisfied"),
      mode: "execute",
      conversation: [{ role: "user", content: "Current request" }],
      tracker: tracker(changes),
      signal: new AbortController().signal,
      onRetry: async () => { retries += 1; }
    });
    const agent = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [middleware] });
    const result = await agent.invoke({ messages: [{ role: "user", content: "Current request" }] });
    assert.equal(completionGateResult(result).completionOutcome, "complete");
    assert.equal(retries, 0);
  }
});

test("a declined edit stops retries and a verified no-op needs observed workspace evidence", async () => {
  for (const [denied, read, expected] of [[true, false, "incomplete"], [false, true, "complete"], [false, false, "incomplete"]] as const) {
    let retries = 0;
    const middleware = createTaskCompletionMiddleware({
      model: contractModel("workspace_change", "already_satisfied"),
      mode: "execute",
      conversation: [{ role: "user", content: "Apply the earlier review" }],
      tracker: tracker(0),
      signal: new AbortController().signal,
      hasObservedRead: () => read,
      approvalWasDenied: () => denied,
      onRetry: async () => { retries += 1; }
    });
    const agent = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [middleware] });
    const result = await agent.invoke({ messages: [{ role: "user", content: "Apply the earlier review" }] });
    assert.equal(completionGateResult(result).completionOutcome, expected);
    if (denied || read) assert.equal(retries, 0);
  }
});

test("the Deep Agent subgraph uses the same in-graph completion gate", async () => {
  const retries: number[] = [];
  const middleware = createTaskCompletionMiddleware({
    model: contractModel("workspace_change"),
    mode: "execute",
    conversation: [{ role: "user", content: "Implement the review" }],
    tracker: tracker(0),
    signal: new AbortController().signal,
    onRetry: async (attempt) => { retries.push(attempt); }
  });
  const agent = createDeepAgent({
    model: new FakeToolCallingModel(),
    tools: [],
    backend: new StateBackend(),
    middleware: [middleware]
  });
  const result = await agent.invoke({ messages: [{ role: "user", content: "Implement the review" }] });
  assert.deepEqual(retries, [1, 2]);
  assert.equal(completionGateResult(result).completionOutcome, "incomplete");
});

test("the graph accepts a relevant edit after a read-only first attempt", async () => {
  let changed = false;
  const middleware = createTaskCompletionMiddleware({
    model: contractModel("workspace_change", "satisfied"),
    mode: "execute",
    conversation: [{ role: "user", content: "Apply the review" }],
    tracker: { finalize: () => ({ changes: changed ? [{ path: "src/example.ts", kind: "modified" }] : [], omitted: 0 }) } as unknown as ChangeTracker,
    signal: new AbortController().signal,
    onRetry: async () => { changed = true; }
  });
  const agent = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [middleware] });
  const result = await agent.invoke({ messages: [{ role: "user", content: "Apply the review" }] });
  assert.equal(changed, true);
  assert.equal(completionGateResult(result).completionOutcome, "complete");
});

test("a diff alone does not complete a semantically unrelated implementation", async () => {
  const retries: number[] = [];
  const middleware = createTaskCompletionMiddleware({
    model: contractModel("workspace_change", "needs_work"),
    mode: "execute",
    conversation: [{ role: "user", content: "Implement the review" }],
    tracker: tracker(1),
    signal: new AbortController().signal,
    onRetry: async (attempt) => { retries.push(attempt); }
  });
  const agent = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [middleware] });
  const result = await agent.invoke({ messages: [{ role: "user", content: "Implement the review" }] });
  assert.deepEqual(retries, [1, 2]);
  assert.equal(completionGateResult(result).completionOutcome, "incomplete");
});

test("the intent model sees attached images instead of classifying text alone", async () => {
  let receivedImage = false;
  const classifier = {
    invoke: async (messages: Array<{ content: unknown }>) => {
      const content = messages.at(-1)?.content;
      receivedImage = Array.isArray(content) && content.some((block) => block?.type === "image_url");
      return { text: JSON.stringify({ outcome: "answer", objective: "Describe the screenshot", reason: "Read-only request", acceptanceCriteria: [] }) };
    }
  } as unknown as BaseChatModel;
  const middleware = createTaskCompletionMiddleware({
    model: classifier,
    mode: "execute",
    conversation: [{ role: "user", content: "What is wrong here?" }],
    currentImages: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    tracker: tracker(0),
    signal: new AbortController().signal,
    onRetry: async () => undefined
  });
  const agent = createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [middleware] });
  const result = await agent.invoke({ messages: [{ role: "user", content: "What is wrong here?" }] });
  assert.equal(receivedImage, true);
  assert.equal(completionGateResult(result).completionOutcome, "complete");
});

test("uncertain context asks for clarification before the executor can use tools", async () => {
  const executor = new FakeToolCallingModel();
  const middleware = createTaskCompletionMiddleware({
    model: contractModel("uncertain"), mode: "execute",
    conversation: [{ role: "user", content: "Do that" }],
    tracker: tracker(0), signal: new AbortController().signal,
    onRetry: async () => undefined
  });
  const agent = createAgent({ model: executor, tools: [], middleware: [middleware] });
  const result = await agent.invoke({ messages: [{ role: "user", content: "Do that" }] });
  assert.equal(executor.index, 0);
  assert.equal(completionGateResult(result).completionOutcome, "incomplete");
  assert.match(String(result.messages.at(-1)?.content), /esclarecimento/);
});

test("completion model messages have distinct graph nodes from the executor stream", async () => {
  class JsonModel extends BaseChatModel {
    private count = 0;
    _llmType(): string { return "completion-json-test"; }
    async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
      const content = JSON.stringify(this.count++ === 0
        ? { outcome: "workspace_change", objective: "Edit a file", reason: "Implementation", acceptanceCriteria: [] }
        : { verdict: "blocked", reason: "No file write is available in this test." });
      return { generations: [{ text: content, message: new AIMessage(content) }] };
    }
  }
  for (const runtime of ["standard", "deep"] as const) {
    const middleware = createTaskCompletionMiddleware({
      model: new JsonModel({}), mode: "execute",
      conversation: [{ role: "user", content: "Edit a file" }],
      tracker: tracker(0), signal: new AbortController().signal,
      onRetry: async () => undefined
    });
    const agent = runtime === "deep"
      ? createDeepAgent({ model: new FakeToolCallingModel(), tools: [], backend: new StateBackend(), middleware: [middleware] })
      : createAgent({ model: new FakeToolCallingModel(), tools: [], middleware: [middleware] });
    const run = await agent.streamEvents({ messages: [{ role: "user", content: "Edit a file" }] }, { version: "v3" });
    const nodes: Array<string | undefined> = [];
    const visible: string[] = [];
    const [result] = await Promise.all([run.values, (async () => {
      await consumeAssistantMessageStreams(run.messages, async (text) => { visible.push(text); }, async () => undefined,
        (stream) => { nodes.push(stream.node); return !stream.node?.startsWith("TaskCompletionGate."); });
    })()]);
    assert.equal(completionGateResult(result).completionOutcome, "incomplete");
    assert.ok(nodes.includes("TaskCompletionGate.before_agent"));
    assert.ok(nodes.includes("TaskCompletionGate.after_agent"));
    assert.ok(nodes.includes("model_request"));
    assert.doesNotMatch(visible.join(""), /"verdict"|"acceptanceCriteria"/);
  }
});

test("a Deep Agent can recover from read-only completion and write a real temporary workspace file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "companion-completion-gate-"));
  try {
    const changeTracker = new RealChangeTracker(root);
    let verifierCalls = 0;
    const verifier = {
      invoke: async () => ({ text: JSON.stringify(verifierCalls++ === 0
        ? { outcome: "workspace_change", objective: "Create feature.txt", reason: "Implementation requested", acceptanceCriteria: ["feature.txt exists"] }
        : { verdict: changeTracker.finalize().changes.length ? "satisfied" : "needs_work", reason: "Check the actual file change." }) })
    } as unknown as BaseChatModel;
    const retries: number[] = [];
    const middleware = createTaskCompletionMiddleware({
      model: verifier, mode: "execute", conversation: [{ role: "user", content: "Create feature.txt" }],
      tracker: changeTracker, signal: new AbortController().signal,
      onRetry: async (attempt) => { retries.push(attempt); }
    });
    const workspace = new ReviewableFilesystemBackend({ rootDir: root, virtualMode: true, maxFileSizeMb: 1.5 }, changeTracker);
    const agent = createDeepAgent({
      model: new FakeToolCallingModel({ toolCalls: [[], [{ name: "write_file", args: { file_path: "/workspace/feature.txt", content: "implemented\n" }, id: "write-1" }], []] }),
      tools: [], middleware: [middleware],
      backend: new CompositeBackend(new StateBackend(), { "/workspace/": workspace })
    });
    const result = await agent.invoke({ messages: [{ role: "user", content: "Create feature.txt" }] });
    assert.deepEqual(retries, [1]);
    assert.equal(completionGateResult(result).completionOutcome, "complete");
    assert.equal(await readFile(path.join(root, "feature.txt"), "utf8"), "implemented\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
