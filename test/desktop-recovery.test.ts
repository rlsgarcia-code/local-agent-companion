import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { needsDesktopRecovery } from "../desktop/recovery";
import { DesktopStateStore } from "../desktop/state-store";
import type { DesktopMessage } from "../desktop/contracts";

test("reopening preserves delivered failures, receipts, and execution steps without replay", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-recovery-"));
  const file = path.join(directory, "desktop-state.json");
  const terminal: DesktopMessage = {
    id: "failed-answer", role: "assistant", text: "Turn interrupted after reporting its evidence.",
    createdAt: 123, status: "failed",
    executionSteps: [{ id: "step-1", text: "Read-only inspection finished", createdAt: 122 }],
    outputs: { activityCount: 1, commandCount: 0, changeCount: 0, contextCount: 0, previewUrls: [], changes: [], commands: [], activities: [] },
  };
  try {
    const store = await DesktopStateStore.open(file);
    const thread = store.activeThread();
    await store.replaceMessage(thread.id, terminal);
    const reopened = await DesktopStateStore.open(file);
    const message = reopened.activeThread().messages.find((item) => item.id === terminal.id);
    assert.equal(needsDesktopRecovery(message), false);
    assert.deepEqual(message, terminal);
    // Opening twice must not substitute an older service error for the delivered failure.
    assert.equal(needsDesktopRecovery((await DesktopStateStore.open(file)).activeThread().messages[0]), false);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).threads[0].messages[0], terminal);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("only missing or streaming desktop projections need service replay", () => {
  const message: DesktopMessage = { id: "answer", role: "assistant", text: "A delivered legacy answer", createdAt: 1 };
  assert.equal(needsDesktopRecovery(undefined), true);
  assert.equal(needsDesktopRecovery({ ...message, status: "streaming" }), true);
  assert.equal(needsDesktopRecovery({ ...message, status: "complete" }), false);
  assert.equal(needsDesktopRecovery({ ...message, status: "failed" }), false);
  assert.equal(needsDesktopRecovery(message), false);
});
