import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ThreadJournal } from "../src/thread-journal";
import type { RunEvidenceSnapshot } from "../src/run-evidence";

const evidence: RunEvidenceSnapshot = {
  commands: [], diagnostics: [], browser: [], processes: [], filesRead: [],
  projectIndexInspected: false, playbooksRead: []
};

test("persists bounded per-thread execution records without file contents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-agent-journal-"));
  const journal = new ThreadJournal();
  await journal.append(root, {
    version: 1, runId: "run-1", threadId: "thread-1", startedAt: 1, completedAt: 2,
    status: "completed", request: "inspect the module", filesRead: [{ path: "src/a.ts", sha256: "abc123" }],
    changedFiles: [], evidence
  });
  const records = await journal.recent(root, "thread-1");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.filesRead[0]?.path, "src/a.ts");
  const raw = await readFile(path.join(root, ".local-agent/threads/thread-1/runs/run-1.json"), "utf8");
  assert.equal(raw.includes("file contents"), false);
  assert.equal(raw.includes("<secret"), false);
});
