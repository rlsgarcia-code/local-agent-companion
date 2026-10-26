import assert from "node:assert/strict";
import test from "node:test";
import { parseIncomingMessage } from "../src/webview-protocol";

test("accepts the bounded commands emitted by the bundled sidebar", () => {
  assert.deepEqual(parseIncomingMessage({ type: "ready" }), { type: "ready" });
  assert.deepEqual(
    parseIncomingMessage({ type: "discardRecovery", threadId: "thread-1", messageId: "message-1" }),
    { type: "discardRecovery", threadId: "thread-1", messageId: "message-1" }
  );
  assert.deepEqual(
    parseIncomingMessage({ type: "send", text: "Review this", mode: "review" }),
    { type: "send", text: "Review this", mode: "review" }
  );
  assert.deepEqual(
    parseIncomingMessage({ type: "draftChanged", threadId: "thread-1", text: "draft" }),
    { type: "draftChanged", threadId: "thread-1", text: "draft" }
  );
  assert.deepEqual(
    parseIncomingMessage({ type: "branchThread", id: "thread-1" }),
    { type: "branchThread", id: "thread-1" }
  );
  assert.deepEqual(
    parseIncomingMessage({ type: "setLocalBrowserToolsEnabled", enabled: true }),
    { type: "setLocalBrowserToolsEnabled", enabled: true }
  );
  assert.deepEqual(parseIncomingMessage({ type: "openMcpConnections" }), { type: "openMcpConnections" });
  assert.deepEqual(
    parseIncomingMessage({ type: "selectFinalReview", mode: "changes" }),
    { type: "selectFinalReview", mode: "changes" }
  );
  assert.deepEqual(
    parseIncomingMessage({ type: "restoreRunChanges", runId: "run-1", changeIds: ["change-1", "change-2"] }),
    { type: "restoreRunChanges", runId: "run-1", changeIds: ["change-1", "change-2"] }
  );
  assert.ok(parseIncomingMessage({
    type: "saveLiteLlm",
    provider: "litellm",
    endpoint: "https://gateway.example.test/v1",
    model: "chat-model",
    apiKey: "secret",
    authHeader: "api-key",
    modelsEndpoint: "https://gateway.example.test/models",
    preset: "custom",
    reasoningEffort: "omit",
    temperature: "",
    topP: "",
    semanticMemoryEnabled: true,
    embeddingModel: "embedding-model"
  }));
});

test("rejects unknown, incomplete, and extra-field messages", () => {
  assert.equal(parseIncomingMessage(null), undefined);
  assert.equal(parseIncomingMessage({}), undefined);
  assert.equal(parseIncomingMessage({ type: "unknown" }), undefined);
  assert.equal(parseIncomingMessage({ type: "send", text: "x" }), undefined);
  assert.equal(parseIncomingMessage({ type: "ready", extra: true }), undefined);
  assert.equal(parseIncomingMessage({ type: "discardRecovery", threadId: "thread-1" }), undefined);
  assert.equal(parseIncomingMessage({
    type: "discardRecovery",
    threadId: "thread-1",
    messageId: "message-1",
    extra: true
  }), undefined);
  assert.equal(parseIncomingMessage({ type: "send", text: "x", mode: "unsafe" }), undefined);
  assert.equal(parseIncomingMessage({ type: "setLocalBrowserToolsEnabled", enabled: "yes" }), undefined);
  assert.equal(parseIncomingMessage({ type: "openMcpConnections", template: "secret" }), undefined);
  assert.equal(parseIncomingMessage({ type: "selectFinalReview", mode: "sometimes" }), undefined);
});

test("rejects oversized identifiers, drafts, prompts, credentials, and diagnostics", () => {
  assert.equal(parseIncomingMessage({ type: "selectThread", id: "x".repeat(129) }), undefined);
  assert.equal(parseIncomingMessage({
    type: "draftChanged",
    threadId: "thread-1",
    text: "x".repeat(50_001)
  }), undefined);
  assert.equal(parseIncomingMessage({
    type: "send",
    text: "x".repeat(200_001),
    mode: "review"
  }), undefined);
  assert.equal(parseIncomingMessage({
    type: "listModels",
    endpoint: "https://gateway.example.test/models",
    apiKey: "x".repeat(16_385)
  }), undefined);
  assert.equal(parseIncomingMessage({
    type: "exportSupportBundle",
    diagnostics: "x".repeat(256_001)
  }), undefined);
  assert.equal(parseIncomingMessage({
    type: "restoreRunChanges",
    runId: "run-1",
    changeIds: []
  }), undefined);
  assert.equal(parseIncomingMessage({
    type: "restoreRunChanges",
    runId: "run-1",
    changeIds: Array.from({ length: 51 }, (_, index) => `change-${index}`)
  }), undefined);
});

test("rejects diagnostics that cannot be serialized", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(parseIncomingMessage({ type: "exportSupportBundle", diagnostics: cyclic }), undefined);
});
