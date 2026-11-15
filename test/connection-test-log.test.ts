import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConnectionTestLog, connectionFailure } from "../src/connection-test-log";

test("distinguishes Agent API timeouts, model 404s, generic routes and other failures", () => {
  assert.deepEqual(connectionFailure(new Error("Agent API timeout: models.assist")), { failureKind: "agent_api_timeout" });
  assert.deepEqual(connectionFailure(new Error("404 model not found")), { failureKind: "model_not_found", httpStatus: 404 });
  assert.deepEqual(connectionFailure(new Error("404 route not found")), { failureKind: "gateway_http", httpStatus: 404 });
  assert.deepEqual(connectionFailure(Object.assign(new Error("Unauthorized"), { status: 401 })), { failureKind: "authentication", httpStatus: 401 });
  assert.equal(connectionFailure(new Error("ENOTFOUND" )).failureKind, "dns");
  assert.equal(connectionFailure(new Error("certificate verification failed")).failureKind, "certificate");
  assert.equal(connectionFailure(new Error("Request timed out")).failureKind, "provider_timeout");
  assert.equal(connectionFailure(new Error("AbortError")).failureKind, "cancelled");
});

test("records correlated stage starts and sanitized outcomes, never raw errors or credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "connection-log-"));
  try {
    const log = new ConnectionTestLog(root, { provider: "litellm", model: "gpt-5.4" }, ["fixture-private-key"]);
    await log.record("started", "chat");
    await log.record("finished", "chat", {
      id: "chat", label: "Chat Completions", status: "failed", durationMs: 100034,
      detail: "raw error body fixture-private-key private prompt https://corporate.invalid",
      ...connectionFailure(new Error("Agent API timeout: models.assist")),
    });
    const raw = await readFile(path.join(root, ".local-agent/logs/agent.log"), "utf8");
    const events = raw.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(events.length, 2);
    assert.equal(events[0].phase, "started");
    assert.equal(events[1].durationMs, 100034);
    assert.equal(events[1].failureKind, "agent_api_timeout");
    assert.equal(events[1].testId, events[0].testId);
    assert.equal(events[1].operation, "models.assist");
    assert.equal(log.available, true);
    assert.doesNotMatch(raw, /fixture-private-key|private prompt|corporate.invalid|raw error body/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a log storage failure does not reject the connection result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "connection-log-unwritable-"));
  try {
    await writeFile(path.join(root, ".local-agent"), "A file cannot be used as the log directory");
    const log = new ConnectionTestLog(root, { provider: "litellm", model: "fixture" });
    await assert.doesNotReject(log.record("started", "chat"));
    assert.equal(log.available, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
