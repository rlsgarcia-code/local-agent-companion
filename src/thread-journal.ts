import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { RunEvidenceSnapshot } from "./run-evidence";

const MAX_RECORDS = 20;
const MAX_TEXT = 500;

export type ThreadJournalFile = {
  path: string;
  sha256: string;
  startLine?: number;
  endLine?: number;
};

export type ThreadJournalRecord = {
  version: 1;
  runId: string;
  threadId: string;
  startedAt: number;
  completedAt: number;
  status: "completed" | "failed" | "cancelled";
  request: string;
  filesRead: ThreadJournalFile[];
  changedFiles: Array<{ path: string; kind: "created" | "modified" | "deleted" }>;
  evidence: RunEvidenceSnapshot;
  outcome?: string;
};

/** Durable, bounded execution memory. It deliberately excludes chat and file contents. */
export class ThreadJournal {
  public async append(workspaceRoot: string, record: ThreadJournalRecord): Promise<void> {
    const directory = this.directory(workspaceRoot, record.threadId);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${safeId(record.runId)}.json`);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(sanitizeRecord(record), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    await this.prune(directory);
  }

  public relativePath(threadId: string, runId: string): string {
    return `.local-agent/threads/${safeId(threadId)}/runs/${safeId(runId)}.json`;
  }

  public async recent(workspaceRoot: string, threadId: string, limit = 6): Promise<ThreadJournalRecord[]> {
    const directory = this.directory(workspaceRoot, threadId);
    let names: string[];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort().slice(-Math.max(1, Math.min(MAX_RECORDS, limit)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      return [];
    }
    const records: ThreadJournalRecord[] = [];
    for (const name of names) {
      try {
        const parsed = JSON.parse(await readFile(path.join(directory, name), "utf8")) as ThreadJournalRecord;
        if (parsed?.version === 1 && parsed.threadId === threadId && typeof parsed.runId === "string") records.push(parsed);
      } catch {
        // An incomplete record is ignored; the next run will create a complete one.
      }
    }
    return records.sort((a, b) => a.completedAt - b.completedAt);
  }

  public static sha256(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  private directory(workspaceRoot: string, threadId: string): string {
    return path.join(workspaceRoot, ".local-agent", "threads", safeId(threadId), "runs");
  }

  private async prune(directory: string): Promise<void> {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    for (const name of names.slice(0, Math.max(0, names.length - MAX_RECORDS))) {
      // Keep the journal bounded without touching unrelated workspace files.
      try { await unlink(path.join(directory, name)); } catch { /* best effort */ }
    }
  }
}

function sanitizeRecord(record: ThreadJournalRecord): ThreadJournalRecord {
  return {
    ...record,
    request: record.request.slice(0, MAX_TEXT),
    outcome: record.outcome?.slice(0, MAX_TEXT),
    filesRead: record.filesRead.slice(-100),
    changedFiles: record.changedFiles.slice(-50),
    evidence: {
      commands: record.evidence.commands.slice(-30),
      diagnostics: record.evidence.diagnostics.slice(-20),
      browser: record.evidence.browser.slice(-20),
      processes: record.evidence.processes.slice(-20),
      diffs: record.evidence.diffs?.slice(-50),
      filesRead: record.evidence.filesRead.slice(-100),
      mcp: record.evidence.mcp?.slice(-30),
      projectIndexInspected: record.evidence.projectIndexInspected,
      playbooksRead: record.evidence.playbooksRead.slice(-20)
    }
  };
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}
