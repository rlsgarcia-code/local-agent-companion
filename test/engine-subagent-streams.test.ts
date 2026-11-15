import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { consumeAssistantMessageStreams } from "../packages/agent-core/src/assistant-stream";

test("Deep subagent stream failure/admission refusal cannot kill the process through an unobserved projection", async () => {
  for (const mode of ["stream-failure", "denied-admission"]) {
    const result = await promisify(execFile)(process.execPath, [path.resolve("dist-tests/test/subagent-failure-fixture.js"), mode], { timeout: 30_000 });
    const line = result.stdout.split("\n").find(line => line.startsWith('{"marker"')); assert.ok(line);
    const record = JSON.parse(line); assert.equal(record.marker, "SUBAGENT_OUTCOMES_SETTLED"); assert.equal(record.baseline, false);
    assert.equal(record.childRequests, mode === "stream-failure" ? 1 : 0);
    assert.ok(["root-handled", "root-failed"].includes(record.outcome));
  }
});

test("visible and hidden messages observe output rejection even when text fails first", async () => {
  for (const visible of [true, false]) {
    const failure = new Error("Synthetic text failure");
    const messages = (async function* () {
      yield { text: (async function* () { throw failure; yield "unreachable"; })(), output: Promise.reject(new Error("Synthetic sibling output failure")) };
    })();
    await assert.rejects(consumeAssistantMessageStreams(messages, async () => assert.fail("No text"), async () => {}, () => visible), error => error === failure);
    await new Promise(resolve => setImmediate(resolve));
  }
});
