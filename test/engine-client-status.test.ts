import test from "node:test";
import assert from "node:assert/strict";
import { AgentClient } from "../packages/client-ts/src/index";
import type { RunState } from "../packages/contracts/src/index";

test("run observation reports state transitions once while preserving every public delta", async () => {
  const client = new AgentClient({ address: "unused", certificate: "unused", credential: {
    registration: { id: "test", product: "companion-mac", profile: "test", workspace: "", providers: ["ollama"], hostTools: [] }, token: "test",
  } });
  const states: RunState[] = ["running", "running", "awaiting_host", "awaiting_host", "running", "cancelling", "cancelling", "cancelled", "cancelled"];
  let poll = 0;
  client.call = async <T>(method: string): Promise<T> => {
    assert.equal(method, "runs.get");
    return { id: "run", sessionId: "session", state: states[poll++] ?? "cancelled", createdAt: 1, updatedAt: 2 } as T;
  };
  client.readEvents = async (_sessionId, cursor = 0) => poll < states.length - 1 ? [{ id: String(poll), sequence: cursor + 1, runId: "run", sessionId: "session", timestamp: poll, type: "text.delta", data: { delta: String(poll) } }] : [];
  const observed: RunState[] = [], deltas: string[] = [];
  const result = await client.waitForRun("run", "session", event => deltas.push((event.data as { delta: string }).delta), undefined, undefined, { onState: state => observed.push(state) });
  assert.equal(result.state, "cancelled");
  assert.deepEqual(observed, ["running", "awaiting_host", "running", "cancelling", "cancelled"]);
  assert.deepEqual(deltas, ["0", "1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(poll, 9);
});
