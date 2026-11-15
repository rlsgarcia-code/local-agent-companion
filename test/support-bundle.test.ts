import assert from "node:assert/strict";
import test from "node:test";
import { createSupportBundle, serializeSupportBundle } from "../src/support-bundle";

const SECRET = "super-secret-key-value";
const ENDPOINT = "https://private.corporate.example/internal/chat/completions";
const MODEL = "private-model-alias";

function input() {
  return {
    application: {
      extensionVersion: "0.11.0",
      vscodeVersion: "1.106.0",
      nodeVersion: "22.0.0",
      platform: "darwin",
      architecture: "arm64",
      remote: false
    },
    workspace: { folderCount: 1, trusted: true },
    agent: {
      runtime: "deep" as const,
      autonomyMode: "review" as const,
      autoContext: true,
      maxContextCharacters: 24_000,
      maxConversationCharacters: 48_000,
      standardRecursionLimit: 200
    },
    connection: {
      provider: "litellm" as const,
      endpoint: ENDPOINT,
      modelsEndpoint: "https://private.corporate.example/models",
      authHeader: "api-key" as const,
      keyPresent: true,
      corporateCaPresent: true,
      chatModel: MODEL,
      embeddingModel: "private-embedding-alias",
      semanticMemoryEnabled: true,
      modelProfileCount: 3,
      selectedPreset: "custom" as const,
      resolvedPreset: "custom" as const,
      reasoningEffort: "medium" as const,
      temperatureConfigured: false,
      topPConfigured: false
    },
    memory: { readable: true, entryCount: 4, projectedEntries: 4, omittedEntries: 0 },
    conversations: {
      threadCount: 2,
      activeMessageCount: 6,
      recoveryStates: { failed: 1, unexpected: 99 }
    },
    diagnostics: [{
      id: "chat",
      label: MODEL,
      status: "failed",
      detail: `${SECRET} ${ENDPOINT}`,
      durationMs: 123.4,
      fixes: [{ kind: "set-auth-header", label: SECRET }]
    }]
  };
}

test("creates a useful support bundle without raw connection or user content", () => {
  const bundle = createSupportBundle(input(), new Date("2026-10-15T12:00:00.000Z"));
  const serialized = serializeSupportBundle(bundle);
  assert.equal(bundle.connection.provider, "litellm");
  assert.equal(bundle.connection.endpointConfigured, true);
  assert.equal(bundle.connection.explicitChatCompletionsRoute, true);
  assert.equal(bundle.diagnostics[0]?.suggestedFixKinds[0], "set-auth-header");
  for (const forbidden of [SECRET, ENDPOINT, MODEL, "private-embedding-alias", "private.corporate.example"]) {
    assert.equal(serialized.includes(forbidden), false, `support bundle leaked ${forbidden}`);
  }
  assert.equal(serialized.includes('"detail"'), false);
  assert.equal(serialized.includes('"label"'), false);
  assert.deepEqual(bundle.conversations.recoveryStates, { failed: 1 });
});

test("drops malformed diagnostic content and bounds numeric metadata", () => {
  const value = input();
  value.memory.entryCount = Number.POSITIVE_INFINITY;
  value.diagnostics = [null, { id: "../../bad", status: "unknown", detail: SECRET }] as unknown as typeof value.diagnostics;
  const bundle = createSupportBundle(value);
  assert.equal(bundle.memory.entryCount, 0);
  assert.deepEqual(bundle.diagnostics, []);
});


test("exports only allowlisted failure metadata and correlation, not raw errors", () => {
  const value = input();
  value.diagnostics = [{ id: "chat", status: "failed", detail: SECRET, testId: "8c6f6033-4340-4a64-b716-67bd7aaf318f", failureKind: "model_not_found", httpStatus: 404 }] as unknown as typeof value.diagnostics;
  const bundle = createSupportBundle(value);
  assert.equal(bundle.diagnostics[0]?.failureKind, "model_not_found");
  assert.equal(bundle.diagnostics[0]?.httpStatus, 404);
  assert.equal(bundle.diagnostics[0]?.testId, "8c6f6033-4340-4a64-b716-67bd7aaf318f");
  assert.doesNotMatch(serializeSupportBundle(bundle), new RegExp(SECRET));
  value.diagnostics = [{ id: "chat", status: "failed", failureKind: SECRET, testId: SECRET, httpStatus: 100034 }] as unknown as typeof value.diagnostics;
  const sanitized = createSupportBundle(value).diagnostics[0]!;
  assert.equal(sanitized.failureKind, undefined);
  assert.equal(sanitized.testId, undefined);
  assert.equal(sanitized.httpStatus, undefined);
});
