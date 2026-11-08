import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import * as path from "node:path";

const MAX_REVIEW_FILES = 50;
const MAX_REVIEW_FILE_BYTES = 1_500_000;
const MAX_REVIEW_SNAPSHOT_BYTES = 6_000_000;

export type TrackedFileChange = {
  id: string;
  path: string;
  absolutePath: string;
  workspaceRoot: string;
  kind: "created" | "modified" | "deleted";
  before: string | null;
  after: string | null;
};

export type TrackedChangeSet = {
  changes: TrackedFileChange[];
  omitted: number;
};

export class ChangeTracker {
  private readonly before = new Map<string, string | null>();
  private readonly after = new Map<string, string | null>();
  private readonly omittedPaths = new Set<string>();
  private beforeBytes = 0;
  private afterBytes = 0;

  public constructor(private readonly workspaceRoot: string) {}

  public async captureBefore(requestedPath: string): Promise<boolean> {
    const relative = this.relativePath(requestedPath);
    if (!relative) return false;
    if (this.before.has(relative)) return true;
    if (this.before.size >= MAX_REVIEW_FILES) {
      this.omittedPaths.add(relative);
      return false;
    }
    const snapshot = await this.snapshot(relative);
    if (snapshot === undefined) {
      this.omittedPaths.add(relative);
      return false;
    }
    const bytes = snapshot === null ? 0 : Buffer.byteLength(snapshot);
    if (this.beforeBytes + bytes > MAX_REVIEW_SNAPSHOT_BYTES) {
      this.omittedPaths.add(relative);
      return false;
    }
    this.before.set(relative, snapshot);
    this.beforeBytes += bytes;
    return true;
  }

  public async captureAfter(requestedPath: string): Promise<void> {
    const relative = this.relativePath(requestedPath);
    if (!relative || !this.before.has(relative)) return;
    const snapshot = await this.snapshot(relative);
    if (snapshot === undefined) {
      this.before.delete(relative);
      this.after.delete(relative);
      this.omittedPaths.add(relative);
      return;
    }
    const previous = this.after.get(relative);
    const previousBytes = previous === undefined || previous === null ? 0 : Buffer.byteLength(previous);
    const bytes = snapshot === null ? 0 : Buffer.byteLength(snapshot);
    if (this.afterBytes - previousBytes + bytes > MAX_REVIEW_SNAPSHOT_BYTES) {
      this.before.delete(relative);
      this.after.delete(relative);
      this.afterBytes -= previousBytes;
      this.omittedPaths.add(relative);
      return;
    }
    this.after.set(relative, snapshot);
    this.afterBytes = this.afterBytes - previousBytes + bytes;
  }

  public finalize(): TrackedChangeSet {
    const changes: TrackedFileChange[] = [];
    for (const [relative, before] of this.before) {
      if (!this.after.has(relative)) continue;
      const after = this.after.get(relative)!;
      if (before === after) continue;
      const kind = before === null ? "created" : after === null ? "deleted" : "modified";
      changes.push({
        id: randomUUID(),
        path: relative,
        absolutePath: path.join(this.workspaceRoot, relative),
        workspaceRoot: this.workspaceRoot,
        kind,
        before,
        after
      });
    }
    return { changes, omitted: this.omittedPaths.size };
  }

  private relativePath(requestedPath: string): string | undefined {
    if (!requestedPath || requestedPath.includes("\0")) return undefined;
    const normalized = requestedPath.replace(/\\/g, "/");
    const virtualRelative = normalized.startsWith("/workspace/")
      ? normalized.slice("/workspace/".length)
      : normalized.replace(/^\/+/, "");
    const candidate = path.resolve(this.workspaceRoot, virtualRelative);
    const relative = path.relative(path.resolve(this.workspaceRoot), candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return relative.split(path.sep).join("/");
  }

  private async snapshot(relative: string): Promise<string | null | undefined> {
    const absolute = path.join(this.workspaceRoot, relative);
    try {
      const [realRoot, realFile] = await Promise.all([
        realpath(this.workspaceRoot),
        realpath(absolute)
      ]);
      if (!isInside(realRoot, realFile)) return undefined;
      const metadata = await stat(realFile);
      if (!metadata.isFile() || metadata.size > MAX_REVIEW_FILE_BYTES) return undefined;
      return await readFile(realFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return await this.safeMissingPath(absolute) ? null : undefined;
      }
      return undefined;
    }
  }

  private async safeMissingPath(absolute: string): Promise<boolean> {
    const realRoot = await realpath(this.workspaceRoot);
    let ancestor = path.dirname(absolute);
    while (ancestor !== path.dirname(ancestor)) {
      try {
        return isInside(realRoot, await realpath(ancestor));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
        ancestor = path.dirname(ancestor);
      }
    }
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
