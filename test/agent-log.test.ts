import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { appendAgentLog } from "../src/agent-log";

test("writes bounded diagnostic logs without request bodies or secrets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-agent-log-"));
  await appendAgentLog(root, {
    event: "connection-test",
    model: "gpt-6-luna",
    apiKey: "secret-key",
    input: "private prompt",
    detail: "HTTP 404 at /v1/responses"
  }, ["secret-key"]);
  const text = await readFile(path.join(root, ".local-agent", "logs", "agent.log"), "utf8");
  assert.match(text, /connection-test/);
  assert.match(text, /gpt-6-luna/);
  assert.match(text, /HTTP 404/);
  assert.doesNotMatch(text, /secret-key|private prompt|apiKey|input/);
});
